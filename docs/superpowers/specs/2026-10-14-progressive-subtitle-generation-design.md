# Geração progressiva de legendas com worker pool e suporte a Cast

Data: 2026-10-14

## Contexto

O projeto já possui geração de legenda via Whisper local (`backend/src/services/subtitles/`), com uma fila FIFO in-process (`transcriptionQueue.ts`) que processa o arquivo inteiro de uma vez e expõe status via polling HTTP (3s) no frontend (`useTranscriptionController.ts`). Não há seleção de idioma, não há tradução, não há suporte a Cast, e o processamento roda inteiramente na main thread do Node (via `child_process` para ffmpeg/whisper, mas orquestração e I/O síncronos competem com o event loop principal).

Este documento especifica a evolução dessa feature para:
1. Gerar legenda em chunks, processados em um pool de `worker_threads` isolado da thread principal.
2. Entregar legenda progressivamente enquanto o usuário assiste, priorizando os trechos próximos à posição atual de playback (com reprioridade em seek).
3. Permitir ao usuário escolher o idioma falado (com autodetecção sugerida) e o idioma de saída da legenda, incluindo tradução quando os dois divergem.
4. Suportar um modo "forced" — legenda aparece somente em trechos cujo idioma destoa do idioma principal do vídeo (ex: música em inglês num filme dublado em português).
5. Funcionar também quando a sessão está em Cast, assumindo o custom Cast receiver especificado em `docs/superpowers/specs/2026-10-14-custom-cast-receiver-and-stream-resilience-design.md`.
6. Retry automático (servidor) e manual (frontend) em qualquer falha de transcrição/tradução.

## Arquitetura

### Componentes (backend, `backend/src/services/subtitles/`)

- **ChunkPlanner**: dado a duração do vídeo e um tamanho de chunk (default 75s, configurável via `SUBTITLE_CHUNK_SECONDS`), gera a lista de chunks `{index, startSec, endSec}` de um job.
- **SubtitleJobManager**: substitui o `TranscriptionQueue` atual. Cria/mantém jobs por `(targetId, outputLanguage, mode)`, guarda estado por chunk (`pending|processing|done|failed`), expõe `getStatus(jobId)`, `reprioritize(jobId, positionSec)`, `retryChunk(jobId, chunkIndex)`.
- **WorkerPool**: pool fixo de `worker_threads` (default 2, `SUBTITLE_WORKER_POOL_SIZE`), cada worker persistente roda `subtitleChunkWorker.ts` e processa um chunk por vez, retirado de uma fila de prioridade compartilhada entre todos os jobs ativos.
- **PriorityQueue**: fila de chunks de todos os jobs ativos, ordenada por distância até a posição de playback reportada por cada job. Reprioridade não descarta chunks já `done` (ficam cacheados em disco).
- **TranslationService**: interface `translate(text, sourceLang, targetLang): Promise<string>`, implementação local baseada em modelo leve de tradução (ex: `@xenova/transformers` com modelo opus-mt), chamada dentro do worker.
- **VttStore**: grava cada chunk como `.vtt` parcial em `backend/data/subtitles/<jobId>/chunk-<n>.vtt`. Endpoint concatena chunks `done` em ordem, serve VTT único.

### Pipeline por chunk (dentro do worker)

1. **Extração** (ffmpeg) do trecho de áudio `[startSec, endSec]`.
2. **Transcrição + detecção de idioma** (Whisper, autodetect por chunk).
3. **Decisão por modo**:
   - `full`: todo chunk vira legenda. Se idioma detectado ≠ `outputLanguage`, texto passa por `TranslationService`.
   - `forced`: compara idioma detectado do chunk com `spokenLanguage` (confirmado pelo usuário). Se igual, chunk não gera cue (silencioso). Se diferente, traduz para `outputLanguage` e gera cue.
4. Grava VTT do chunk (vazio se `forced` sem diferença).

Job carrega `{spokenLanguage, outputLanguage, mode: 'full'|'forced'}`.

### Autodetecção inicial

Antes de confirmar o job, um chunk curto (~10s) roda autodetect do Whisper e retorna `detectedLanguage`, usado para pré-popular o idioma falado na UI (editável pelo usuário antes de confirmar).

### Retry

- **Servidor**: cada chunk tenta até 3x com backoff (1s, 3s, 9s) antes de marcar `failed`. Falha isolada de tradução não derruba o chunk inteiro — cue fica no idioma original com `translationFailed: true`, chunk ainda marca `done`.
- **Frontend**: chunk `failed` após retries emite `chunk-failed {chunkIndex}` via SSE; UI oferece retry manual desse chunk (`POST /jobs/:jobId/chunks/:chunkIndex/retry`, reenfileira com prioridade alta). Falha de job inteiro (ex: sem stream de áudio) emite `job-failed` com retry completo.

## API

Rotas em `backend/src/routes/vod.ts`:

- `POST /api/vod/subtitles/detect-language` `{targetId}` → `{detectedLanguage}`.
- `POST /api/vod/subtitles/jobs` `{targetId, spokenLanguage, outputLanguage, mode}` → `{jobId}`.
- `GET /api/vod/subtitles/jobs/:jobId/stream` (SSE via `sseRouter` existente) → eventos `chunk-ready {chunkIndex, cueCount}`, `chunk-failed {chunkIndex}`, `job-complete`, `job-failed {error}`.
- `POST /api/vod/subtitles/jobs/:jobId/position` `{positionSec}` → reprioriza fila.
- `POST /api/vod/subtitles/jobs/:jobId/chunks/:chunkIndex/retry` → reenfileira chunk com prioridade alta.
- `GET /api/vod/subtitles/jobs/:jobId/vtt` → VTT concatenado dos chunks `done` (cache-control curto).

## Frontend

`useTranscriptionController.ts` (reescrito):

- Modal "Gerar legenda": idioma detectado (pré-preenchido, editável), idioma de saída, toggle modo completa/forced.
- Conecta `EventSource` no SSE ao criar job; a cada `chunk-ready`, força reload do `<track src>` (troca query string).
- Listener de `timeupdate` do player reporta posição a cada ~10s via `/position`.
- `chunk-failed`/`job-failed` mostram botão de retry correspondente.

## Cast

Assume o custom Cast receiver (spec de stream resilience) como base:

- Sender (`CastProvider.tsx`) não reimplementa o pipeline: reusa o mesmo job/VTT do player local. Repassa eventos SSE (`chunk-ready`, etc.) para o receiver via canal de mensagens customizado (`urn:x-cast:com.viniplay.subtitles`), já que o receiver não acessa o SSE do backend diretamente.
- Receiver atualiza seu `TextTrackType.SUBTITLES` a cada `chunk-ready`, buscando o VTT atualizado em `/jobs/:jobId/vtt`.
- Heartbeat de 30s existente do `CastProvider` cobre também a atividade de geração de legenda (evita timeout do Janitor durante geração).

## Storage / dados

- `backend/data/subtitles/<jobId>/chunk-<n>.vtt` — cues já traduzidas/filtradas por modo.
- `backend/data/subtitles/<jobId>/job.json` — metadata: `targetId, spokenLanguage, outputLanguage, mode, chunks[]{status, retries, translationFailed}`.
- Tabela `subtitle_jobs` (knex) para histórico/listagem (evita regerar do zero um idioma já processado); chunks continuam em disco.

## Testes

- Unit: `ChunkPlanner`, `SubtitleJobManager` (fila/reprioridade/retry), `TranslationService` (mock).
- Integração backend: worker pool com ffmpeg/whisper mockados, valida pipeline completo e modo `forced` (chunk no idioma principal não gera cue).
- Frontend: `useTranscriptionController` com SSE mockado (chunks incrementais), seek disparando `/position`.
- Cast: teste cobrindo sessão de Cast com job de legenda ativo — receiver atualiza track a cada `chunk-ready` e sobrevive ao heartbeat. Obrigatório por regra do `CLAUDE.md` do projeto para qualquer feature de playback.
