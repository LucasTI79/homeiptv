# Offline Downloads — Download e Reprodução Local de Filmes e Temporadas (OPFS + IndexedDB)

## 1. Visão Geral e Objetivos

O ViniPlay conta com suporte a streaming de TV ao vivo e catálogo VOD (Filmes e Séries), além de persistência local de progresso de reprodução via IndexedDB (*Continue Watching*).

Este documento especifica a arquitetura e implementação da funcionalidade de **Download e Reprodução Offline Local**, permitindo ao usuário:
1. Baixar filmes avulsos diretamente para o armazenamento do navegador/dispositivo.
2. Baixar episódios individuais ou temporadas inteiras de séries em lote (com enfileiramento sequencial inteligente).
3. Gerenciar downloads ativos, pausados e concluídos através de uma página dedicada `/downloads` com indicador em tempo real de uso de espaço em disco e velocidade.
4. Reproduzir qualquer filme ou episódio baixado instantaneamente no `PlayerPage.tsx`, com suporte a saltos de tempo (*seek*) e salvamento de progresso no *Continue Watching*, mesmo estando 100% desconectado da internet.

---

## 2. Arquitetura de Armazenamento e Streaming

### 2.1 Camada de Disco: Origin Private File System (OPFS)
Para suportar arquivos de vídeo de grande porte (filmes em 1080p/4K e múltiplos episódios de séries, variando de 1 GB a dezenas de gigabytes) sem sobrecarregar a memória RAM do navegador, a solução utiliza o **OPFS** (`navigator.storage.getDirectory()`).

- **Diretório Raiz de Downloads:**
  Obtido via `navigator.storage.getDirectory()`, acessando o subdiretório `downloads/`.
- **Nomenclatura de Arquivos:**
  - Filmes: `movie_{movieId}.mp4`
  - Episódios de Séries: `series_{seriesId}_s{season}_e{episodeIndex}.mp4`
- **Gravação em Stream com Baixo Consumo de RAM:**
  O download consome o stream de dados vindo de `/api/media-proxy?url=...` chunk a chunk (buffers de 64 KB a 1 MB) usando `ReadableStreamDefaultReader` e canaliza os bytes diretamente para o `FileSystemWritableFileStream` com `{ keepExistingData: true }`. Isso garante que apenas um pequeno buffer resida na memória RAM a cada instante.
- **Suporte a Pausa e Retomada (HTTP Range Requests):**
  Se o download for pausado pelo usuário ou interrompido por oscilação de rede:
  - O número de bytes já gravados em disco (`downloadedBytes`) é retido na tarefa.
  - Ao retomar, a requisição HTTP envia o cabeçalho `Range: bytes=${downloadedBytes}-`.
  - O stream retoma e o `FileSystemWritableFileStream.seek(downloadedBytes)` continua a gravação exatamente a partir do ponto salvo, sem perda de dados e sem reiniciar o arquivo do zero.

---

## 3. Esquema do Banco de Dados Local (`viniplay_offline_db` v3)

O banco de dados IndexedDB [db.ts](file:///home/lalvesdev/Documents/projects/personal/ViniPlay/frontend/src/services/db.ts) tem sua versão elevada de `2` para `3`, criando a nova object store:

### 3.1 Object Store: `download_tasks`
- **KeyPath:** `id` (`string`, ex: `"movie_123"` ou `"series_456_s01_e02"`)
- **Índices:**
  - `by_status`: indexado por `status` (`'queued' | 'downloading' | 'paused' | 'completed' | 'error'`)
  - `by_seriesId`: indexado por `seriesId` (`string`, opcional)
  - `by_createdAt`: indexado por `createdAt` (`number`, timestamp em ms)

### 3.2 Tipagem TypeScript (`DownloadTask`)
```typescript
export type DownloadStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'error';

export interface DownloadTask {
  id: string;                      // Identificador único (ex: 'movie_12' ou '${seriesId}_s${season}_e${ep}')
  mediaType: 'movie' | 'series';
  seriesId?: string;
  seriesName?: string;
  season?: string;
  episodeIndex?: number;
  title: string;
  remoteUrl: string;               // URL original do VOD
  logo?: string;                   // Poster / Imagem de capa
  totalBytes: number;              // Tamanho total do arquivo (ou estimado via Content-Length)
  downloadedBytes: number;         // Bytes já gravados no OPFS
  status: DownloadStatus;
  speedBytesPerSec?: number;       // Velocidade calculada em tempo real
  errorMessage?: string;
  createdAt: number;
  completedAt?: number;
  fileName: string;                // Nome do arquivo físico no OPFS
}
```

---

## 4. Gerenciador de Download & Fila (`DownloadManager`)

O `DownloadManager` é um serviço singleton responsável pelo ciclo de vida de downloads e controle de concorrência.

### 4.1 Controle de Concorrência
- Limite padrão: **1 download ativo por vez** (evita saturação de banda IPTV e gargalos de I/O em disco).
- Os demais itens permanecem com status `'queued'` ordenados por `createdAt`.
- Ao concluir ou pausar um download, o próximo item da fila em estado `'queued'` é iniciado automaticamente.

### 4.2 Download em Lote (Temporadas e Séries)
- **Download de Temporada:**
  Ao clicar em *"Baixar Temporada Completa"*:
  1. O gerenciador consulta os episódios da temporada (`library.series` ou `SeriesDetails`).
  2. Cria uma lista de `DownloadTask` para cada episódio que ainda não esteja baixado nem em fila.
  3. Adiciona todos à fila em ordem sequencial (E01, E02, E03...).
  4. O primeiro episódio inicia imediatamente; os subsequentes aguardam na fila.
- **Download de Série Completa:**
  Mesmo comportamento, enfileirando todas as temporadas de forma estruturada.

### 4.3 Gestão de Quota de Armazenamento
- Antes de iniciar o download de itens individuais ou em lote, é invocada a API `navigator.storage.estimate()`.
- Se o espaço disponível no disco for menor que o tamanho necessário mais uma margem de segurança de 500 MB, a operação é bloqueada com notificação explicativa.
- O serviço invoca `navigator.storage.persist?.()` para solicitar armazenamento persistente ao navegador.

---

## 5. Interface do Usuário (UI/UX)

### 5.1 Nova Página: `/downloads` (`DownloadsPage.tsx`)
Acesso através do menu de navegação ou atalho rápido.
- **Painel de Quota de Disco:**
  Exibe o gráfico visual de uso de espaço:
  - Espaço consumido pelos downloads do ViniPlay (em GB).
  - Espaço livre disponível no dispositivo.
- **Abas de Visualização:**
  1. **Prontos para Assistir (Baixados):**
     - Filmes baixados: card com poster, título, tamanho em MB/GB, botão de **Play** direto e botão de **Excluir**.
     - Séries baixadas: agrupadas por série, com contagem de episódios disponíveis offline (ex: *"Breaking Bad — 8 episódios baixados"*), permitindo abrir a lista de episódios offline.
  2. **Fila de Downloads:**
     - Barra de progresso contínua com percentual.
     - Velocidade em tempo real (ex: *"5.2 MB/s"*).
     - Controles de ação: **Pausar**, **Retomar**, **Cancelar** e **Tentar Novamente**.

### 5.2 Botões de Download no Catálogo VOD
- **Cards de Filmes (`VodPage.tsx`):**
  - Botão de download no card/hover.
  - Indicador visual se o filme já estiver baixado localmente (ícone de concluído).
- **Modal de Episódios de Séries (`SeriesModal.tsx`):**
  - Cabeçalho de cada temporada: Botão *"Baixar Temporada"* com contador de episódios.
  - Lista de episódios: Botão de download individual com feedback visual do status (na fila, baixando com spinner percentual ou concluído).

---

## 6. Integração com o Player (`PlayerPage.tsx`)

### 6.1 Detecção e Reprodução Local
Ao abrir um filme ou episódio no player:
1. O player consulta o `download_tasks` no IndexedDB para verificar se o identificador do item possui status `'completed'`.
2. **Se estiver baixado:**
   - Abre o arquivo diretamente do OPFS (`downloadsDirectory.getFileHandle(task.fileName)` -> `fileHandle.getFile()`).
   - Gera um `blobUrl = URL.createObjectURL(file)`.
   - Atribui ao `<video src={blobUrl}>`.
   - Exibe toast/badge informativo: *"Reproduzindo do armazenamento local (Offline)"*.
3. **Se não estiver baixado:**
   - Segue com o fluxo padrão de streaming via rede (`/api/media-proxy` ou stream direto).

### 6.2 Continuidade e Rastreamento (*Continue Watching*)
- O player continua emitindo os eventos normais de `timeupdate` e gravando no `playbackStore.ts`.
- Como o `playbackStore` persiste no IndexedDB (`viniplay_offline_db`), o histórico de onde o usuário parou é 100% funcional sem conexão de rede.

---

## 7. Tratamento de Erros e Casos de Borda

1. **Queda de Conexão durante Download:**
   - A tarefa é marcada como `'paused'` com `errorMessage = "Conexão perdida"`.
   - Um botão "Retomar" permite continuar exatamente do ponto em que parou via Range Request.
2. **Fechamento da Aba durante Download:**
   - No carregamento inicial do `DownloadManager`, tarefas encontradas em estado `'downloading'` são ajustadas para `'paused'`, prontas para retomada pelo usuário.
3. **Exclusão de Arquivo:**
   - Ao excluir um item, o arquivo físico no OPFS é removido via `directoryHandle.removeEntry(task.fileName)` e a tarefa é deletada do IndexedDB.
4. **Navegador sem Suporte a OPFS:**
   - O `DownloadManager` verifica a compatibilidade (`typeof navigator.storage?.getDirectory === 'function'`). Caso o navegador não suporte, exibe aviso informativo e desabilita os botões de download.

---

## 8. Plano de Testes e Validação

### 8.1 Testes Automatizados (Vitest)
- **`frontend/src/services/db.test.ts`**:
  - Testar upgrade do IndexedDB para versão 3.
  - Testar criação, leitura, atualização e exclusão de `DownloadTask`.
  - Testar índices `by_status` e `by_seriesId`.
- **`frontend/src/services/downloadManager.test.ts`**:
  - Testar enfileiramento de filme avulso.
  - Testar enfileiramento em lote de episódios de uma temporada.
  - Testar controle de concorrência (apenas 1 download ativo por vez).
  - Testar pausa e retomada com offset de bytes.
- **`frontend/src/store/downloadStore.test.ts`**:
  - Testar sincronização do estado reativo do Zustand com o IndexedDB e atualizações de progresso.

### 8.2 Validação Manual e Fluxo de Uso
1. **Download de Filme:**
   - Acessar o catálogo VOD, clicar em baixar filme.
   - Observar barra de progresso, velocidade e conclusão em `/downloads`.
2. **Download de Temporada:**
   - Abrir uma série no `SeriesModal.tsx`, clicar em "Baixar Temporada".
   - Confirmar que todos os episódios entram na fila e são baixados sequencialmente.
3. **Validação de Pausa e Retomada:**
   - Pausar o download na metade, retomar e verificar que o percentual não zera.
4. **Teste 100% Offline:**
   - Simular offline no navegador (DevTools Network -> Offline).
   - Navegar para `/downloads`, dar Play em um filme/episódio.
   - Verificar reprodução, seek pela barra de tempo e persistência da posição no Continue Watching.
