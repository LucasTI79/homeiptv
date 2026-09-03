# Continue Watching — Persistência Offline no Cliente (IndexedDB) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar persistência offline no cliente para a funcionalidade de Continue Watching e Favoritos utilizando IndexedDB nativo e integração reativa com Zustand, permitindo retenção permanente mesmo com servidor reiniciado ou aplicativo fechado, além de enriquecimento de séries para transição automática de episódios.

**Architecture:** Módulo tipado `frontend/src/services/db.ts` gerenciando o banco `viniplay_offline_db` (v1) com índices de ordenação e busca por série. O `playbackStore.ts` (Zustand) hidrata seu estado a partir do IndexedDB com cache imediato e dispara persistência assíncrona não-bloqueante no disco do cliente. O `VodPage.tsx` cruza episódios retomados com a biblioteca VOD para restaurar o contexto de episódios subsequentes.

**Tech Stack:** React 19, TypeScript, Zustand, IndexedDB API nativa, Vitest, Testing Library, fake-indexeddb (devDependency para testes).

## Global Constraints

- Manter 100% de compatibilidade offline no navegador sem novas dependências de produção em runtime.
- Não introduzir dependências desnecessárias; utilizar a API nativa `indexedDB` encapsulada em Promises no helper `db.ts`.
- Preservar tipagem estrita com TypeScript (`npm run build` sem erros).
- Garantir que linter (`npm run lint`) passe com zero erros.
- TDD com cobertura de testes unitários para o banco de dados e store.

---

### Task 1: Camada de Banco de Dados Offline com IndexedDB (`frontend/src/services/db.ts`)

**Files:**
- Create: `frontend/src/services/db.ts`
- Create: `frontend/src/services/db.test.ts`
- Modify: `frontend/package.json` (adicionar `fake-indexeddb` em `devDependencies`)

**Interfaces:**
- Produces:
  ```typescript
  export interface OfflineProgressItem {
    id: string;
    seriesId?: string;
    seriesName?: string;
    season?: string;
    episodeIndex?: number;
    title: string;
    type: 'movie' | 'series';
    url: string;
    logo?: string;
    currentTime: number;
    duration: number;
    updatedAt: number;
  }
  export function openDb(): Promise<IDBDatabase>;
  export function getProgressList(): Promise<OfflineProgressItem[]>;
  export function saveProgress(item: OfflineProgressItem): Promise<void>;
  export function removeProgress(id: string): Promise<void>;
  export function clearProgress(): Promise<void>;
  export function getFavorites(): Promise<string[]>;
  export function saveFavorite(id: string): Promise<void>;
  export function removeFavorite(id: string): Promise<void>;
  export function migrateFromLocalStorage(): Promise<void>;
  ```

- [ ] **Step 1: Instalar fake-indexeddb como devDependency**

Run: `npm install -D fake-indexeddb` em `frontend/`

- [ ] **Step 2: Escrever o teste unitário inicial de falha para db.ts**

Criar `frontend/src/services/db.test.ts`:
```typescript
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  openDb,
  getProgressList,
  saveProgress,
  removeProgress,
  clearProgress,
  getFavorites,
  saveFavorite,
  removeFavorite,
  migrateFromLocalStorage,
  type OfflineProgressItem,
} from './db';

describe('Offline DB (IndexedDB)', () => {
  beforeEach(async () => {
    localStorage.clear();
    const db = await openDb();
    const tx = db.transaction(['vod_progress', 'vod_favorites'], 'readwrite');
    tx.objectStore('vod_progress').clear();
    tx.objectStore('vod_favorites').clear();
    await new Promise((resolve) => {
      tx.oncomplete = resolve;
    });
  });

  it('saves and retrieves progress items ordered by updatedAt desc', async () => {
    const item1: OfflineProgressItem = {
      id: 'movie_1',
      title: 'Movie 1',
      type: 'movie',
      url: 'http://example.com/1.mp4',
      currentTime: 100,
      duration: 1000,
      updatedAt: 1000,
    };
    const item2: OfflineProgressItem = {
      id: 'series_1_s1_e1',
      seriesId: 'series_1',
      season: '1',
      episodeIndex: 0,
      title: 'Series 1 Ep 1',
      type: 'series',
      url: 'http://example.com/s1e1.mp4',
      currentTime: 50,
      duration: 500,
      updatedAt: 2000,
    };

    await saveProgress(item1);
    await saveProgress(item2);

    const list = await getProgressList();
    expect(list.length).toBe(2);
    expect(list[0].id).toBe('series_1_s1_e1'); // Mais recente primeiro
    expect(list[1].id).toBe('movie_1');
  });

  it('removes a progress item', async () => {
    const item: OfflineProgressItem = {
      id: 'movie_to_remove',
      title: 'Movie',
      type: 'movie',
      url: 'http://example.com/m.mp4',
      currentTime: 100,
      duration: 1000,
      updatedAt: 1000,
    };
    await saveProgress(item);
    let list = await getProgressList();
    expect(list.length).toBe(1);

    await removeProgress('movie_to_remove');
    list = await getProgressList();
    expect(list.length).toBe(0);
  });

  it('manages favorites in indexedDB', async () => {
    await saveFavorite('vod_fav_1');
    await saveFavorite('vod_fav_2');

    let favs = await getFavorites();
    expect(favs).toContain('vod_fav_1');
    expect(favs).toContain('vod_fav_2');

    await removeFavorite('vod_fav_1');
    favs = await getFavorites();
    expect(favs).not.toContain('vod_fav_1');
    expect(favs).toContain('vod_fav_2');
  });

  it('migrates existing data from localStorage to indexedDB', async () => {
    localStorage.setItem(
      'viniplay_vod_progress',
      JSON.stringify({
        legacy_movie: {
          id: 'legacy_movie',
          title: 'Legacy Movie',
          type: 'movie',
          url: 'http://example.com/legacy.mp4',
          currentTime: 250,
          duration: 1200,
          updatedAt: 1500,
        },
      })
    );
    localStorage.setItem('viniplay_vod_favorites', JSON.stringify(['legacy_fav']));

    await migrateFromLocalStorage();

    const progressList = await getProgressList();
    expect(progressList.some((p) => p.id === 'legacy_movie')).toBe(true);

    const favs = await getFavorites();
    expect(favs).toContain('legacy_fav');
  });
});
```

- [ ] **Step 3: Rodar o teste para verificar falha**

Run: `npx vitest run src/services/db.test.ts`
Expected: FAIL com módulo ou funções não encontradas.

- [ ] **Step 4: Implementar frontend/src/services/db.ts**

Criar `frontend/src/services/db.ts` com suporte nativo ao IndexedDB:
- Banco `viniplay_offline_db`, versão 1.
- Criação dos stores `vod_progress` (`keyPath: 'id'`, índices `by_updatedAt` e `by_seriesId`) e `vod_favorites` (`keyPath: 'id'`).
- Métodos com tratamento seguro de erros e encapsulamento em Promises.
- Método `migrateFromLocalStorage()`.

- [ ] **Step 5: Rodar o teste para verificar sucesso**

Run: `npx vitest run src/services/db.test.ts`
Expected: PASS com 100% de sucesso.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/services/db.ts frontend/src/services/db.test.ts
git commit -m "feat(frontend): implement offline IndexedDB storage layer for Continue Watching and favorites"
```

---

### Task 2: Integração Reativa no `playbackStore.ts` com Hidratação Assíncrona

**Files:**
- Modify: `frontend/src/store/playbackStore.ts`
- Create: `frontend/src/store/playbackStore.test.ts`

**Interfaces:**
- Consumes: `frontend/src/services/db.ts` (`saveProgress`, `removeProgress`, `clearProgress`, `saveFavorite`, `removeFavorite`, `getProgressList`, `getFavorites`, `migrateFromLocalStorage`)
- Produces:
  ```typescript
  interface PlaybackState {
    progress: Record<string, VodProgressItem>;
    favorites: string[];
    isHydrated: boolean;
    init: () => Promise<void>;
    saveProgress: (item: Omit<VodProgressItem, 'updatedAt'>) => void;
    removeProgress: (id: string) => void;
    clearProgress: () => void;
    setProgressMap: (map: Record<string, VodProgressItem>) => void;
    toggleFavorite: (id: string) => void;
    setFavorites: (favorites: string[]) => void;
    isFavorite: (id: string) => boolean;
  }
  ```

- [ ] **Step 1: Escrever teste de falha para hidratação e sincronização do playbackStore**

Criar `frontend/src/store/playbackStore.test.ts`:
```typescript
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { usePlaybackStore } from './playbackStore';
import * as db from '../services/db';

describe('usePlaybackStore with IndexedDB integration', () => {
  beforeEach(async () => {
    localStorage.clear();
    const database = await db.openDb();
    const tx = database.transaction(['vod_progress', 'vod_favorites'], 'readwrite');
    tx.objectStore('vod_progress').clear();
    tx.objectStore('vod_favorites').clear();
    await new Promise((resolve) => {
      tx.oncomplete = resolve;
    });
    usePlaybackStore.setState({ progress: {}, favorites: [], isHydrated: false });
  });

  it('hydrates store from indexedDB', async () => {
    await db.saveProgress({
      id: 'item_preexisting',
      title: 'Preexisting',
      type: 'movie',
      url: 'http://test.com/vid.mp4',
      currentTime: 50,
      duration: 200,
      updatedAt: 5000,
    });
    await db.saveFavorite('fav_1');

    await usePlaybackStore.getState().init();

    const state = usePlaybackStore.getState();
    expect(state.isHydrated).toBe(true);
    expect(state.progress['item_preexisting']).toBeDefined();
    expect(state.progress['item_preexisting'].currentTime).toBe(50);
    expect(state.favorites).toContain('fav_1');
  });

  it('persists saveProgress to indexedDB asynchronously', async () => {
    await usePlaybackStore.getState().init();

    usePlaybackStore.getState().saveProgress({
      id: 'item_active',
      title: 'Active Movie',
      type: 'movie',
      url: 'http://test.com/active.mp4',
      currentTime: 120,
      duration: 1000,
    });

    // In-memory state is instant
    expect(usePlaybackStore.getState().progress['item_active'].currentTime).toBe(120);

    // IndexedDB should be persisted
    const dbList = await db.getProgressList();
    expect(dbList.some((i) => i.id === 'item_active')).toBe(true);
  });

  it('removes finished item (>= 95%) from both state and indexedDB', async () => {
    await usePlaybackStore.getState().init();

    usePlaybackStore.getState().saveProgress({
      id: 'item_finished',
      title: 'Finished Movie',
      type: 'movie',
      url: 'http://test.com/finished.mp4',
      currentTime: 960,
      duration: 1000,
    });

    expect(usePlaybackStore.getState().progress['item_finished']).toBeUndefined();
    const dbList = await db.getProgressList();
    expect(dbList.some((i) => i.id === 'item_finished')).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar teste para verificar falha**

Run: `npx vitest run src/store/playbackStore.test.ts`
Expected: FAIL porque `init()` não existe ou comportamento do store ainda não foi adaptado.

- [ ] **Step 3: Atualizar frontend/src/store/playbackStore.ts**

Implementar:
- `isHydrated: boolean`.
- `init: () => Promise<void>`: invoca `migrateFromLocalStorage()`, lê `getProgressList()` e `getFavorites()` do IndexedDB e popula o estado. Auto-executa `init()` na inicialização do store para hidratação transparente.
- Atualizar `saveProgress`, `removeProgress`, `clearProgress`, `toggleFavorite`, `setFavorites` para invocar os métodos correspondentes de `db.ts` em background mantendo sincronia com o estado do Zustand e o fallback do localStorage.

- [ ] **Step 4: Rodar teste para verificar aprovação**

Run: `npx vitest run src/store/playbackStore.test.ts`
Expected: PASS com 100% de sucesso.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/playbackStore.ts frontend/src/store/playbackStore.test.ts
git commit -m "feat(frontend): connect playbackStore to IndexedDB with reactive hydration and offline persistence"
```

---

### Task 3: Enriquecimento de Contexto de Séries e Resumo no `VodPage.tsx` e `PlayerPage.tsx`

**Files:**
- Modify: `frontend/src/pages/vod/VodPage.tsx:129-155`
- Modify: `frontend/src/pages/vod/VodPage.test.tsx`

**Interfaces:**
- Consumes: `library.series` de `useVodLibrary()`, `usePlaybackStore`, `setSelectedChannel` de `useUiStore`
- Produces: `seriesContext` com `episodes` completos e `nextEpisode` válido passado para `setSelectedChannel`.

- [ ] **Step 1: Escrever teste cobrindo a retomada de série com contexto de episódios**

Adicionar teste em `frontend/src/pages/vod/VodPage.test.tsx`:
- Renderizar `VodPage` com dados de série no mock de `useVodLibrary`.
- Configurar um item de progresso no `usePlaybackStore` apontando para a série.
- Simular clique no botão Resume do Continue Watching.
- Verificar se `setSelectedChannel` recebeu `seriesContext.episodes` preenchido e `nextEpisode` calculado para o episódio subsequente.

- [ ] **Step 2: Rodar o teste para verificar falha**

Run: `npx vitest run src/pages/vod/VodPage.test.tsx`
Expected: FAIL ao verificar o enriquecimento de episódios.

- [ ] **Step 3: Atualizar VodPage.tsx**

Em `frontend/src/pages/vod/VodPage.tsx`:
- No `handleResumeContinueWatching`:
  - Se `cw.seriesId` existir:
    - Buscar a série correspondente em `library.series.find(s => s.id === cw.seriesId)`.
    - Localizar os episódios da temporada (`cw.season`).
    - Enriquecer `seriesContext` com a lista completa `episodes`.
    - Calcular `nextEpisode` se houver episódio seguinte (`cw.episodeIndex + 1 < episodes.length`).

- [ ] **Step 4: Rodar o teste para verificar aprovação**

Run: `npx vitest run src/pages/vod/VodPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/vod/VodPage.tsx frontend/src/pages/vod/VodPage.test.tsx
git commit -m "feat(frontend): enrich series context and episodes when resuming from Continue Watching"
```

---

### Task 4: Validação End-to-End, Linter e Build

**Files:**
- Todas as modificações anteriores

- [ ] **Step 1: Executar build do TypeScript e Vite**

Run: `npm run build` em `frontend/`
Expected: 0 erros de compilação TypeScript e bundle Vite gerado com sucesso.

- [ ] **Step 2: Executar Linter**

Run: `npm run lint` em `frontend/`
Expected: 0 erros e 0 avisos.

- [ ] **Step 3: Executar a suíte de testes unitários relevante**

Run: `npx vitest run src/services/db.test.ts src/store/playbackStore.test.ts src/pages/vod/VodPage.test.tsx src/test/components/PlayerPage.test.tsx`
Expected: Todos os testes passando com sucesso.

- [ ] **Step 4: Commit de finalização da Wave/Task**

```bash
git commit --allow-empty -m "chore(frontend): verify full build, linting and test coverage for offline Continue Watching"
```
