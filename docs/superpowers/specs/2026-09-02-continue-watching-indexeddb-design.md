# Continue Watching — Persistência Offline no Cliente (IndexedDB)

## 1. Visão Geral e Contexto
O ViniPlay conta com a funcionalidade de "Continue Watching" para VOD (Filmes e Séries), rastreando a posição de reprodução e percentual concluído.
Este documento especifica a transição da camada de armazenamento para **IndexedDB nativo no navegador do cliente**, garantindo que o histórico de reprodução e favoritos permaneçam persistidos de maneira resiliente mesmo se:
- A aplicação ou aba do navegador for fechada.
- O servidor backend for reiniciado ou estiver temporariamente indisponível.
- O dispositivo estiver operando em modo offline.

Adicionalmente, a arquitetura é desenhada com extensibilidade para futuras capacidades de **downloads locais de filmes e temporadas inteiras de séries** no cliente para consumo offline.

---

## 2. Arquitetura do Banco de Dados Offline (`viniplay_offline_db`)

### 2.1 Especificação do Banco
- **Nome da base:** `viniplay_offline_db`
- **Versão:** `1`
- **Driver:** API nativa `window.indexedDB` tipada em TypeScript (`frontend/src/services/db.ts`).

### 2.2 Object Stores (Versão 1)
1. **`vod_progress`**:
   - **KeyPath:** `id` (`string`, ex: `"movie_45"` ou `"${seriesId}_s${season}_e${episodeIndex}"`).
   - **Índices:**
     - `by_updatedAt`: indexado por `updatedAt` (`number`, timestamp em ms). Permite ordenação rápida decrescente para alimentar o carrossel "Continue Watching".
     - `by_seriesId`: indexado por `seriesId` (`string`, opcional). Permite listar todos os episódios assistidos de uma série específica (útil para marcar episódios vistos na modal e calcular downloads por temporada).
   - **Estrutura de dados (`VodProgressItem`):**
     ```typescript
     export interface VodProgressItem {
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
     ```

2. **`vod_favorites`**:
   - **KeyPath:** `id` (`string`).
   - Armazena os IDs de VODs marcados como favoritos pelo usuário.

### 2.3 Visão de Futuro: Suporte a Downloads Offline (v2+)
O esquema do IndexedDB é versionado. Futuramente, uma migração para versão `2` adicionará:
- Store `offline_media`: para armazenar `Blob` de vídeo, faixas de áudio e legendas baixadas.
- Store `download_tasks`: para controlar progresso de download e integridade de temporadas.

---

## 3. Camada de Integração Reativa (`playbackStore.ts`)

### 3.1 Inicialização e Hidratação
- O store Zustand mantém o estado reativo em memória (`progress` e `favorites`) para renderização instantânea a 60fps sem engasgos de I/O.
- No carregamento inicial:
  1. Carrega o estado síncrono inicial do `localStorage` (cache imediato).
  2. Executa `initOfflineDb()`: migra quaisquer dados remanescentes do `localStorage` para o IndexedDB se for a primeira execução.
  3. Carrega o mapa consolidado do IndexedDB e atualiza o store Zustand, marcando `isHydrated: true`.

### 3.2 Operações de Gravação e Remoção
- **`saveProgress(item)`**:
  - Se `duration > 0 && (currentTime / duration) >= 0.95`: o item é considerado concluído e é removido de `vod_progress` (tanto na memória quanto no IndexedDB).
  - Caso contrário: atualiza o item com `updatedAt = Date.now()` no estado Zustand e persiste assincronamente no IndexedDB via `db.saveProgress(...)`.
- **`removeProgress(id)`**:
  - Remove imediatamente do estado Zustand e apaga o registro no IndexedDB via `db.removeProgress(...)`.
- **`toggleFavorite(id)`**:
  - Alterna status no Zustand e salva/remove no IndexedDB via `db.saveFavorite(id)` / `db.removeFavorite(id)`.

---

## 4. Experiência de Retomada e Séries (`VodPage.tsx` e `PlayerPage.tsx`)

### 4.1 Enriquecimento de Contexto de Séries
- Ao clicar em "Resume" em um card de episódio no Continue Watching de `VodPage.tsx`:
  - Se `cw.seriesId` existir, a função busca a série correspondente na biblioteca VOD em memória (`library.series`).
  - Reconstrói a lista completa de episódios da temporada (`seriesContext.episodes`).
  - Preenche `selectedChannel.nextEpisode` com o episódio subsequente correto.
- **Resultado:** O usuário retoma de onde parou e, nos últimos 25 segundos do episódio, a contagem regressiva para o próximo episódio funciona sem falhas.

### 4.2 Detecção de Retomada no Player (`PlayerPage.tsx`)
- Se o canal foi aberto via Continue Watching, `initialTime` é respeitado diretamente.
- Se foi aberto pelo catálogo geral, o player consulta o store persistido e exibe o toast/banner elegante:
  `"Deseja continuar de MM:SS?" [Continuar] [Começar do Início]`.

---

## 5. Plano de Testes e Validação
1. **Verificação de Persistência:**
   - Reproduzir um filme/série por 15 segundos.
   - Fechar a aba do navegador e reabrir.
   - Verificar se o item permanece no topo do carrossel "Continue Watching" com a barra de progresso correta.
2. **Simulação de Servidor Reiniciado / Offline:**
   - Desligar conexão de dados / simular offline no DevTools.
   - Recarregar a página e confirmar que os dados do Continue Watching e Favoritos são recuperados instantaneamente do IndexedDB.
3. **Validação de Próximo Episódio:**
   - Retomar um episódio de série a partir do Continue Watching e avançar para o final.
   - Verificar se o card de contagem regressiva para o próximo episódio aparece e navega corretamente.
4. **Verificação de Linter e Build:**
   - Executar `npm run build` e `npm run lint` para garantir 0 erros de tipagem e linting.
