# Celular como Controle Remoto e Companion App - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar o pareamento do smartphone como controle remoto e segunda tela (Companion App) para navegar livremente no catálogo e controlar a reprodução do PC/Smart TV via WebSocket, com arquitetura baseada em Dependency Inversion (DIP).

**Architecture:** 
O backend disponibiliza um servidor WebSocket em `/ws/remote` acoplado ao contrato `IRemoteSessionHub`. A implementação em memória (`MemoryRemoteSessionHub`) gerencia salas de sessão, PINs de 6 dígitos e pub/sub de mensagens em tempo real, pronta para ser substituída ou estendida por Redis no futuro. O PC (Host) exibe um QR Code/PIN e despacha o estado da reprodução (Cast/Local). O Celular (Client) conecta à sala, exibe uma barra flutuante "Now Playing" com controles de playback, permite navegar pelo catálogo completo com a ação "Assistir na TV" e oferece uma aba de D-pad e digitação sincronizada.

**Tech Stack:** 
- Backend: Node.js, Express, `ws` (WebSocket), TypeScript
- Shared: `@homeiptv/shared-types`
- Frontend: React 19, Vite, TailwindCSS v4, Zustand 5, `qrcode`, `react-icons`, Vitest

## Global Constraints
- Princípio de Inversão de Dependência (DIP): O servidor WebSocket e rotas dependem exclusivamente de `IRemoteSessionHub`.
- Baixa Latência: Troca de mensagens via WebSocket bidirecional (< 20ms).
- Zero Friction: Pareamento direto por QR Code ou PIN de 6 dígitos sem login redundante.
- Reconexão Automática: Persistência do pareamento no `localStorage` e suporte ao evento `visibilitychange`.

---

### Task 1: Protocolo de Mensagens e Tipos Compartilhados (`shared-types`)

**Files:**
- Modify: `shared/types/src/index.ts`
- Create: `shared/types/src/remote.ts`

**Interfaces:**
- Produces: `RemoteNowPlayingState`, `RemoteSession`, `RemoteMessage`, `RemoteCommand`, `RemoteDpadKey`

- [ ] **Step 1: Criar o arquivo de tipos `shared/types/src/remote.ts`**

```typescript
export interface RemoteNowPlayingState {
  title: string;
  subtitle?: string;
  logo?: string;
  streamUrl?: string;
  isVod: boolean;
  isLive: boolean;
  isPaused: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  seriesContext?: {
    seriesId: string;
    season: number;
    episodeIndex: number;
    totalEpisodes?: number;
  };
  introDetection?: {
    canSkip: boolean;
    introEnd: number;
  };
}

export interface RemoteSession {
  sessionId: string;
  pinCode: string;
  hostDeviceId: string;
  createdAt: number;
  lastActiveAt: number;
  nowPlaying?: RemoteNowPlayingState;
}

export type RemoteDpadKey = 'up' | 'down' | 'left' | 'right' | 'select' | 'back' | 'menu';

export type RemoteMessage =
  | { type: 'SYNC_STATE'; payload: RemoteNowPlayingState }
  | { type: 'SESSION_PAIRED'; payload: { clientCount: number } }
  | { type: 'HOST_DISCONNECTED' }
  | { type: 'COMMAND_PLAY_PAUSE' }
  | { type: 'COMMAND_SEEK'; payload: { deltaSeconds?: number; positionSeconds?: number } }
  | { type: 'COMMAND_VOLUME'; payload: { delta?: number; setVolume?: number; toggleMute?: boolean } }
  | { type: 'COMMAND_PLAY_MEDIA'; payload: { id: string; name: string; url: string; logo?: string; isVod?: boolean; seriesContext?: any } }
  | { type: 'COMMAND_SKIP_INTRO' }
  | { type: 'COMMAND_NEXT_EPISODE' }
  | { type: 'COMMAND_DPAD'; payload: { key: RemoteDpadKey } }
  | { type: 'COMMAND_INPUT_TEXT'; payload: { text: string; submit?: boolean } }
  | { type: 'REQUEST_SYNC' }
  | { type: 'PING' }
  | { type: 'PONG' };
```

- [ ] **Step 2: Exportar os novos tipos em `shared/types/src/index.ts`**

Adicionar `export * from './remote';` em `shared/types/src/index.ts`.

- [ ] **Step 3: Compilar e verificar tipos**

Run: `npm run build --workspace=@homeiptv/shared-types`
Expected: Success sem erros de compilação TypeScript.

- [ ] **Step 4: Commit**

```bash
git add shared/types/src/remote.ts shared/types/src/index.ts
git commit -m "feat(types): add remote companion and control protocol types"
```

---

### Task 2: Backend - Inversão de Dependência e `MemoryRemoteSessionHub`

**Files:**
- Create: `backend/src/services/remote/IRemoteSessionHub.ts`
- Create: `backend/src/services/remote/MemoryRemoteSessionHub.ts`
- Create: `backend/src/services/remote/__tests__/MemoryRemoteSessionHub.test.ts`

**Interfaces:**
- Produces: `IRemoteSessionHub`, `MemoryRemoteSessionHub`

- [ ] **Step 1: Criar a interface abstrata `IRemoteSessionHub.ts`**

```typescript
import { RemoteSession, RemoteNowPlayingState, RemoteMessage } from '@homeiptv/shared-types';

export interface IRemoteSessionHub {
  createSession(hostDeviceId: string): Promise<RemoteSession>;
  getSession(sessionId: string): Promise<RemoteSession | null>;
  getSessionByPin(pin: string): Promise<RemoteSession | null>;
  touchSession(sessionId: string): Promise<void>;
  updateNowPlaying(sessionId: string, state: RemoteNowPlayingState): Promise<void>;
  closeSession(sessionId: string): Promise<void>;

  publishToSession(sessionId: string, message: RemoteMessage, senderSocketId?: string): Promise<void>;
  subscribeToSession(sessionId: string, socketId: string, onMessage: (msg: RemoteMessage) => void): () => void;
  removeSocket(socketId: string): Promise<void>;
  getClientCount(sessionId: string): number;
}
```

- [ ] **Step 2: Escrever teste unitário falho para `MemoryRemoteSessionHub`**

Criar `backend/src/services/remote/__tests__/MemoryRemoteSessionHub.test.ts` testando:
- Geração de sessão com PIN de 6 dígitos formatado.
- Busca por PIN e por sessionId.
- Pub/Sub de mensagens entre sockets inscritos (excluindo sender se informado).
- Atualização e recuperação do `nowPlaying`.
- Remoção e limpeza de sessões.

- [ ] **Step 3: Executar teste para confirmar falha**

Run: `npx vitest run src/services/remote/__tests__/MemoryRemoteSessionHub.test.ts` (ou via vitest)
Expected: FAIL (módulo não implementado).

- [ ] **Step 4: Implementar `MemoryRemoteSessionHub.ts`**

Implementar o hub usando `Map<string, RemoteSession>`, `Map<string, string>` para pins e `Map<string, Map<string, Function>>` para subscribers, com rotina de sweep com TTL de 3 horas.

- [ ] **Step 5: Executar teste e validar sucesso**

Run: `npx vitest run src/services/remote/__tests__/MemoryRemoteSessionHub.test.ts`
Expected: PASS (todos os testes verdes).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/remote/
git commit -m "feat(backend): implement MemoryRemoteSessionHub with DIP"
```

---

### Task 3: Backend - Servidor WebSocket (`ws`) e Rotas de Sessão

**Files:**
- Modify: `backend/package.json` (adicionar dependência `ws` e `@types/ws`)
- Create: `backend/src/services/remote/remoteWsServer.ts`
- Create: `backend/src/routes/remote.ts`
- Modify: `backend/src/index.ts` (plugar WebSocket no HTTP server e registrar `remoteRouter`)

- [ ] **Step 1: Instalar `ws` e `@types/ws` no backend**

Run: `npm i ws --workspace=@homeiptv/backend && npm i -D @types/ws --workspace=@homeiptv/backend`

- [ ] **Step 2: Criar rotas REST `backend/src/routes/remote.ts`**
  - `POST /api/remote/sessions`: Cria sessão para o Host autenticado, retorna `{ sessionId, pinCode }`.
  - `GET /api/remote/sessions/by-pin/:pin`: Retorna `{ sessionId }` válido ou 404 se inexistente/expirado.

- [ ] **Step 3: Implementar `backend/src/services/remote/remoteWsServer.ts`**
  - Criar `setupRemoteWebSocketServer(httpServer: http.Server, hub: IRemoteSessionHub)`
  - Endpoint: `/ws/remote`
  - Validar query params (`sessionId`, `role: 'host' | 'client'`)
  - Ao receber mensagem JSON, despachar via `hub.publishToSession(...)`
  - Manter heartbeat ping/pong a cada 15 segundos para evitar timeouts de proxies

- [ ] **Step 4: Atualizar `backend/src/index.ts`**
  - Importar `http.createServer(app)`
  - Instanciar `const remoteHub = new MemoryRemoteSessionHub();`
  - Chamar `setupRemoteWebSocketServer(server, remoteHub);`
  - Registrar `app.use('/api/remote', createRemoteRouter(remoteHub));`

- [ ] **Step 5: Validar compilação e teste do backend**

Run: `npm run build --workspace=@homeiptv/backend`
Expected: Build concluído com sucesso sem erros TypeScript.

- [ ] **Step 6: Commit**

```bash
git add backend/
git commit -m "feat(backend): add WebSocket server and remote session API"
```

---

### Task 4: Frontend - Store Zustand (`remoteStore.ts`)

**Files:**
- Create: `frontend/src/store/remoteStore.ts`
- Create: `frontend/src/store/remoteStore.test.ts`

**Interfaces:**
- Produces: `useRemoteStore` com métodos `startHostSession`, `connectAsClient`, `sendCommand`, `syncHostPlayback`, `disconnect`.

- [ ] **Step 1: Escrever teste unitário falho para `remoteStore.test.ts`**
  - Testa transição de estado ao conectar como cliente.
  - Testa armazenamento e recuperação de sessão no `localStorage`.
  - Testa despacho de comandos via WebSocket simulado.

- [ ] **Step 2: Implementar `remoteStore.ts`**
  - Implementar conexão WebSocket com reconexão automática e backoff exponencial.
  - Listener para `visibilitychange` (revalida e dispara `REQUEST_SYNC` ao desbloquear tela).
  - Estado `remoteNowPlaying` atualizado em tempo real.

- [ ] **Step 3: Rodar testes do frontend**

Run: `npm run test --workspace=@homeiptv/frontend -- remoteStore.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/store/remoteStore.ts frontend/src/store/remoteStore.test.ts
git commit -m "feat(frontend): create remoteStore with auto-reconnect and state sync"
```

---

### Task 5: Frontend - Interface Host (PC / PlayerPage e Modal de Pareamento)

**Files:**
- Modify: `frontend/package.json` (instalar `qrcode` e `@types/qrcode`)
- Create: `frontend/src/components/remote/RemotePairingModal.tsx`
- Modify: `frontend/src/pages/PlayerPage.tsx` (adicionar botão de parear e listener de comandos)

- [ ] **Step 1: Instalar biblioteca `qrcode` no frontend**

Run: `npm i qrcode --workspace=@homeiptv/frontend && npm i -D @types/qrcode --workspace=@homeiptv/frontend`

- [ ] **Step 2: Criar `RemotePairingModal.tsx`**
  - Gera visualização em SVG/Canvas do QR Code apontando para `/?remote_session=UUID&pin=123-456`.
  - Mostra PIN destacado e formatado.
  - Badge em tempo real: "Aguardando celular..." ➔ "Celular conectado ✓".

- [ ] **Step 3: Integrar em `PlayerPage.tsx`**
  - Adicionar botão `FiSmartphone` ao lado do botão de Cast.
  - Sincronizar estado do player local e do Cast com `remoteStore.syncHostPlayback`:
    - `title`, `isPaused`, `currentTime`, `duration`, `isVod`, `seriesContext`, `introDetection`.
  - Adicionar listener para executar comandos recebidos:
    - `COMMAND_PLAY_PAUSE` -> `togglePlayPause()`
    - `COMMAND_SEEK` -> `seekMedia()`
    - `COMMAND_PLAY_MEDIA` -> carrega o novo canal/filme
    - `COMMAND_SKIP_INTRO` -> executa pulo de introdução
    - `COMMAND_DPAD` -> despacha evento `KeyboardEvent` correspondente.

- [ ] **Step 4: Teste de componentes**

Criar teste unitário para `RemotePairingModal.tsx` validando renderização de QR Code e PIN.
Run: `npm run test --workspace=@homeiptv/frontend -- RemotePairingModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/remote/ frontend/src/pages/PlayerPage.tsx
git commit -m "feat(frontend): add remote pairing modal and host command execution"
```

---

### Task 6: Frontend - UX Mobile Companion ("Now Playing", BottomSheet e D-Pad)

**Files:**
- Create: `frontend/src/components/remote/RemoteNowPlayingBar.tsx`
- Create: `frontend/src/components/remote/RemoteExpandedSheet.tsx`
- Create: `frontend/src/components/remote/RemoteDpadView.tsx`
- Modify: `frontend/src/App.tsx` (detectar query params de pareamento na inicialização e renderizar `RemoteNowPlayingBar`)

- [ ] **Step 1: Criar `RemoteNowPlayingBar.tsx`**
  - Barra flutuante inferior elegante com glassmorphism/backdrop blur.
  - Miniatura do vídeo, título, botão Play/Pause rápido e barra de progresso.
  - Toque na barra abre `RemoteExpandedSheet`.

- [ ] **Step 2: Criar `RemoteExpandedSheet.tsx`**
  - Slider interativo de seek.
  - Botões -10s, +30s, Play/Pause, Próximo Episódio.
  - Botão de destaque **"Pular Abertura"** quando detectada intro.
  - Slider de volume e botão de Mute.
  - Abas: [Controles de Mídia] | [D-Pad & Busca].

- [ ] **Step 3: Criar `RemoteDpadView.tsx`**
  - D-Pad direcional (Cima, Baixo, Esquerda, Direita, OK central, Voltar, Home).
  - Feedback háptico via `if (navigator.vibrate) navigator.vibrate(20)`.
  - Campo de texto para digitar busca na tela do PC em tempo real.

- [ ] **Step 4: Integrar no `App.tsx`**
  - Verificar se a URL possui `?remote_session=...&pin=...`. Se possuir, acionar `connectAsClient`.
  - Renderizar `<RemoteNowPlayingBar />` globalmente no app quando `isPaired && role === 'client'`.

- [ ] **Step 5: Testes do componente `RemoteNowPlayingBar`**

Run: `npm run test --workspace=@homeiptv/frontend -- RemoteNowPlayingBar.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/remote/ frontend/src/App.tsx
git commit -m "feat(frontend): implement mobile Now Playing bar, expanded sheet and D-Pad"
```

---

### Task 7: Ação "Assistir na TV" na Navegação do Catálogo

**Files:**
- Modify: `frontend/src/pages/vod/VodPage.tsx`
- Modify: `frontend/src/pages/vod/MovieDetailsModal.tsx` (ou componente de detalhes de mídia)
- Modify: `frontend/src/components/channel/ChannelItem.tsx` (ou lista de canais)

- [ ] **Step 1: Integrar a ação "Assistir na TV" nos cliques de conteúdo**
  - Quando o usuário no celular clica em um canal ou episódio:
    - Se o celular estiver pareado com a TV (`isPaired`), exibe opção direta ou modal de confirmação: **"▶ Assistir na TV"** (ação principal) ou "Assistir neste Celular".
    - Ao selecionar "Assistir na TV", emite `COMMAND_PLAY_MEDIA` com os dados do canal/filme.
    - Exibe toast: *"Enviado para a TV!"*.

- [ ] **Step 2: Teste de integração de disparo de mídia**

Run: `npm run test --workspace=@homeiptv/frontend`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/
git commit -m "feat(frontend): integrate Play on TV action across catalog views"
```

---

### Task 8: Verificação Final e Build

- [ ] **Step 1: Rodar suíte completa de testes do frontend e backend**

Run: `npm run test --workspace=@homeiptv/frontend`
Run: `npm run build --workspaces`
Expected: Todos os testes passando e builds de produção concluídos sem erro.

- [ ] **Step 2: Teste manual de ponta a ponta**
  - Abrir player no PC e iniciar streaming.
  - Clicar no botão do controle e ler QR Code no celular.
  - Testar Play/Pause, Seek e navegação no catálogo com troca de canal/episódio na TV.
