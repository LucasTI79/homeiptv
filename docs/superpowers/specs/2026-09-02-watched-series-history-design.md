# Design Doc — Controle e Exibição de Séries e Episódios Assistidos (Watched History)

## 1. Visão Geral
Atualmente, o ViniPlay armazena o progresso de reprodução em `playback_progress`. Quando um episódio atinge o limite de conclusão (`>= 90%`), ele é removido da lista de progresso ativo e apenas o próximo episódio é enfileirado no *Continue Watching*. Isso cria uma dependência estrita do Continue Watching: o usuário não tem visibilidade de quais episódios da temporada já assistiu, não pode marcar manualmente temporadas que assistiu fora da plataforma e não consegue filtrar séries já concluídas no catálogo VOD.

Este documento detalha o design para **Histórico e Marcação de Assistidos (Watched State)**, com persistência no IndexedDB v4, sincronização automática ao terminar episódios, ações manuais e filtros no catálogo.

---

## 2. Arquitetura de Dados

### 2.1 Banco de Dados Local (`viniplay_offline_db` v4)
Atualização do `DB_VERSION` de `3` para `4` em `frontend/src/services/db.ts`.

Nova Object Store: `watched_episodes`
- **Chave Primária (`keyPath`):** `id` (string)
  - Episódios de Séries: `${seriesId}_s${season}_e${episodeIndex}`
  - Filmes: `movie_${id}`
- **Índices:**
  - `by_seriesId`: indexa por `seriesId` para consulta rápida de todos os episódios assistidos de uma série específica.
  - `by_watchedAt`: indexa pela data em milissegundos para ordenação cronológica.

Estrutura da Entidade `WatchedEpisodeRecord`:
```typescript
export interface WatchedEpisodeRecord {
  id: string;             // ex: "${seriesId}_s1_e0" ou "movie_123"
  seriesId?: string;      // ID da série (se aplicável)
  seriesName?: string;    // Nome da série
  season?: string;        // Temporada (ex: "1")
  episodeIndex?: number;  // Índice do episódio (0-indexed)
  title: string;          // Título do episódio ou filme
  mediaType: 'series' | 'movie';
  watchedAt: number;      // timestamp em ms
  autoMarked: boolean;    // true se marcado automaticamente pelo player, false se marcado manualmente pelo usuário
}
```

Funções CRUD no `db.ts`:
- `getWatchedEpisodes(): Promise<WatchedEpisodeRecord[]>`
- `getWatchedEpisodesBySeries(seriesId: string): Promise<WatchedEpisodeRecord[]>`
- `isEpisodeWatched(id: string): Promise<boolean>`
- `saveWatchedEpisode(record: WatchedEpisodeRecord): Promise<void>`
- `saveWatchedEpisodesBatch(records: WatchedEpisodeRecord[]): Promise<void>`
- `removeWatchedEpisode(id: string): Promise<void>`
- `removeWatchedEpisodesBatch(ids: string[]): Promise<void>`

---

## 3. Lógica de Estado e Sincronização (`playbackStore.ts`)

O Zustand store `usePlaybackStore` será enriquecido para manter o estado reativo dos itens assistidos:

```typescript
interface PlaybackState {
  progress: Record<string, VodProgressItem>;
  watchedMap: Record<string, WatchedEpisodeRecord>; // id -> WatchedEpisodeRecord
  favorites: string[];
  isHydrated: boolean;

  // Novas Ações de Assistidos:
  markEpisodeWatched: (record: Omit<WatchedEpisodeRecord, 'watchedAt'>) => Promise<void>;
  unmarkEpisodeWatched: (id: string) => Promise<void>;
  markSeasonWatched: (
    series: { id: string; name: string },
    season: string,
    episodes: Array<{ name: string; url: string }>
  ) => Promise<void>;
  unmarkSeasonWatched: (
    seriesId: string,
    season: string,
    episodes: Array<{ name: string; url: string }>
  ) => Promise<void>;
  isWatched: (id: string) => boolean;
  getSeriesWatchedCount: (seriesId: string) => number;
}
```

### 3.1 Marcação Automática no Player
Em `saveProgress`:
Quando `isFinished === true` (isto é, `currentTime / duration >= 0.9` ou créditos atingidos):
1. Grava automaticamente o registro na store `watched_episodes` com `autoMarked: true` e `watchedAt: Date.now()`.
2. Mantém o avanço para o próximo episódio no Continue Watching (se existir próximo episódio).
3. Exibe toast discreto de sucesso: *"Episódio marcado como assistido!"*.

---

## 4. Interface do Usuário (UI/UX)

### 4.1 Modal de Detalhes da Série (`SeriesModal.tsx`)
1. **Cabeçalho da Temporada:**
   - Contador de progresso: `Assistidos: X/Y episódios`.
   - Botão de lote com alternância inteligente:
     - Se nem todos foram assistidos: Botão `"Marcar Temporada como Assistida"` com ícone `FiCheck`.
     - Se todos os episódios da temporada já estão assistidos: Botão `"Desmarcar Temporada"` com ícone `FiRotateCcw`.
2. **Lista de Episódios:**
   - Cada linha de episódio possui um botão de alternância manual de status assistido (ícone de checkmark interativo).
   - Se assistido:
     - Badge verde `✓ Assistido`.
     - Opacidade suave (dimming de 75%) no fundo do card para que episódios ainda não vistos se destaquem visualmente.
     - Botão de Play continua acessível (mudando texto de Play para "Reassistir" ou ícone replay).

### 4.2 Catálogo VOD (`VodPage.tsx`)
1. **Badges nos Cards de Série:**
   - Se a série possui episódios assistidos: badge `✓ X assistidos` ou `✓ Concluída` no topo do card.
2. **Novo Filtro de Visualização:**
   - Adicionada opção de filtro: `Assistidos` junto a `Todos`, `Filmes`, `Séries`, `Favoritos`.
   - Permite ao usuário filtrar rapidamente apenas o que já assistiu ou está em andamento.

---

## 5. Plano de Testes
1. **Testes Unitários no Banco (`db.test.ts`):**
   - Migração para v4 criando store `watched_episodes` e índices.
   - Salvar, buscar por série, deletar em lote e verificar idempotência.
2. **Testes do Store (`playbackStore.test.ts`):**
   - Marcação automática ao atingir completion threshold.
   - Marcação manual de episódio individual e desmarcação.
   - Marcação e desmarcação de temporada inteira em lote.
3. **Testes de Componentes:**
   - `SeriesModal`: Renderização de badges `Assistido`, alternância manual e contador de temporada.
   - `VodPage`: Filtro de assistidos e badges nos cards.
