# Design: Celular como Controle Remoto e Companion App (Second Screen)

- **Data**: 2026-09-02
- **Status**: Proposto (Aprovado em Brainstorming)
- **Autor**: Andrea Ardovini / Antigravity

---

## 1. Visão Geral e Problema

Ao transmitir o ViniPlay do navegador do PC para uma Smart TV (via Google Cast / Chromecast ou cabo HDMI), o usuário muitas vezes deseja deitar na cama ou sentar no sofá e continuar tendo controle total da experiência. Atualmente, para pausar, trocar de episódio, ajustar volume ou escolher outro conteúdo no catálogo, é necessário levantar e interagir diretamente com o PC.

Além disso, em navegadores de celular (em especial iOS Safari), não há suporte nativo para atuar como emissor Google Cast direto. Manter o PC como o emissor estável do Cast na TV enquanto o celular atua como uma **segunda tela (Companion / Remote)** resolve essa dor perfeitamente.

### Objetivos Principais
1. **Navegação Livre no Catálogo**: O usuário pode navegar livremente pela lista de canais, categorias de VOD, séries e episódios na tela do celular sem interromper a reprodução na TV.
2. **Ação "Assistir na TV"**: Ao selecionar qualquer canal, filme ou episódio no celular, ele pode disparar a reprodução diretamente na TV/PC.
3. **Barra Fixa "Now Playing" & Controles de Reprodução**: Visualizar miniatura, título, tempo atual/total e controlar play/pause, seek (-10s / +30s), volume e botão de pular abertura (integrado com o Video Intelligence).
4. **Modo Híbrido com D-Pad & Teclado**: Aba dedicada com direcionais (cima/baixo/esq/dir/OK/voltar) e digitação rápida no celular para preencher buscas na tela grande.
5. **Pareamento Sem Atrito (Zero Friction)**: QR Code e PIN de 6 dígitos no player do PC; leitura com a câmera nativa do celular abre o app conectado imediatamente, com reconexão automática via `localStorage`.
6. **Dependency Inversion (DIP)**: Gerenciador de conexões e sessões desacoplado por interface (`IRemoteSessionHub`), rodando inicialmente em memória (`MemoryRemoteSessionHub`), com suporte pronto para plugue futuro de Redis (`RedisRemoteSessionHub`).

---

## 2. Arquitetura do Sistema

```
+-------------------------------------------------------------+
|                          BACKEND                            |
|                                                             |
|   +---------------------+        +-----------------------+  |
|   |  WebSocket Server   | <----> |  IRemoteSessionHub    |  |
|   |  (/ws/remote)       |        |  (Dependency Inversion|  |
|   +----------+----------+        +-----------+-----------+  |
+--------------|-------------------------------|--------------+
               | (WebSocket)                   |
       +-------+-------+             +---------+---------+
       |               |             |                   |
       v               v             v (Implementação)   v (Futuro)
+-------------+ +-------------+ +--------------------+ +--------------------+
|  PC (Host)  | | Celular     | | MemoryRemote-      | | RedisRemote-       |
|  - Cast     | | (Client)    | | SessionHub         | | SessionHub         |
|  - Player   | | - Catálogo  | | - Map em memória   | | - Redis Pub/Sub    |
|  - QR Code  | | - NowPlaying| | - TTL / Cleanup    | | - Clustered scale  |
|             | | - D-Pad     | +--------------------+ +--------------------+
+-------------+ +-------------+
```

---

## 3. Backend: Inversão de Dependência e Protocolo

### 3.1 Contrato da Abstração (`IRemoteSessionHub`)
Localizado em `backend/src/services/remote/IRemoteSessionHub.ts`:

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
  sessionId: string;       // UUID v4
  pinCode: string;         // 6 caracteres amigáveis (ex: "748-219")
  hostDeviceId: string;
  createdAt: number;
  lastActiveAt: number;
  nowPlaying?: RemoteNowPlayingState;
}

export type RemoteMessage =
  // Host ➔ Clients
  | { type: 'SYNC_STATE'; payload: RemoteNowPlayingState }
  | { type: 'SESSION_PAIRED'; payload: { clientCount: number } }
  | { type: 'HOST_DISCONNECTED' }
  // Client ➔ Host
  | { type: 'COMMAND_PLAY_PAUSE' }
  | { type: 'COMMAND_SEEK'; payload: { deltaSeconds?: number; positionSeconds?: number } }
  | { type: 'COMMAND_VOLUME'; payload: { delta?: number; setVolume?: number; toggleMute?: boolean } }
  | { type: 'COMMAND_PLAY_MEDIA'; payload: { id: string; name: string; url: string; logo?: string; isVod?: boolean; seriesContext?: any } }
  | { type: 'COMMAND_SKIP_INTRO' }
  | { type: 'COMMAND_NEXT_EPISODE' }
  | { type: 'COMMAND_DPAD'; payload: { key: 'up' | 'down' | 'left' | 'right' | 'select' | 'back' | 'menu' } }
  | { type: 'COMMAND_INPUT_TEXT'; payload: { text: string; submit?: boolean } }
  // Bidirecional
  | { type: 'REQUEST_SYNC' }
  | { type: 'PING' }
  | { type: 'PONG' };

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
}
```

### 3.2 Implementação em Memória (`MemoryRemoteSessionHub`)
- Mantém mapas em memória:
  - `sessionsById: Map<string, RemoteSession>`
  - `sessionIdByPin: Map<string, string>`
  - `subscribers: Map<string, Map<string, (msg: RemoteMessage) => void>>`
- Rotina de limpeza periódica (`setInterval` a cada 15 minutos): encerra sessões inativas há mais de 3 horas.
- Desacoplada e facilmente testável via testes unitários isolados.

### 3.3 Servidor WebSocket (`backend/src/services/remote/remoteWsServer.ts`)
- Utiliza a biblioteca nativa e leve `ws` no Node.js.
- Conectado ao servidor HTTP existente do Express no endpoint `/ws/remote`.
- Handshake suporta autenticação via query params:
  - Host: `ws://host:port/ws/remote?role=host&sessionId=...`
  - Cliente: `ws://host:port/ws/remote?role=client&sessionId=...` (ou via PIN).

---

## 4. Frontend: Experiência do Usuário (UX) & Interface

### 4.1 Fluxo de Pareamento (Host - PC)
1. No player (`PlayerPage.tsx`), ao lado do botão de Cast, adiciona-se o botão **"Parear Celular"** (`FiSmartphone`).
2. Abre-se o modal `RemotePairingModal`:
   - Exibe **QR Code** apontando para: `${window.location.origin}/?remote_session=${sessionId}&pin=${pinCode}`.
   - Exibe o **PIN formatado** (`123 456`) e instrução simples caso o usuário prefira digitar.
   - Badge animado: *"Aguardando conexão..."* ➔ ao conectar o celular, muda para verde *"1 celular conectado"*.

### 4.2 Fluxo do Celular (Cliente)
1. O usuário escaneia o QR Code com a câmera do celular.
2. O ViniPlay abre e identifica os parâmetros `remote_session` / `pin` na URL.
3. O `remoteStore` salva o ID da sessão no `localStorage` e conecta ao WebSocket `/ws/remote`.
4. Um toast elegante surge: *"Conectado à TV! Use o celular para navegar e controlar."*

### 4.3 Barra Fixa "Now Playing" no Celular (`RemoteNowPlayingBar.tsx`)
- Uma barra flutuante posicionada na base da tela (sobreposta, com backdrop blur):
  - **Lado Esquerdo**: Miniatura / poster do canal ou filme + Título / Episódio.
  - **Centro**: Barra de progresso com tempo decorrido / total.
  - **Lado Direito**: Botões de ação rápida (Play/Pause, Pular Intro se disponível, Expandir).
- Ao tocar na barra, abre-se a **Folha de Controle Expandida (BottomSheet / Full Modal)**:
  - Scrub slider com busca milimétrica.
  - Botões -10s, Play/Pause, +30s.
  - Botão **"Pular Abertura"** em destaque quando o detector de áudio/vídeo sinalizar abertura na TV.
  - Botão **"Próximo Episódio"** quando estiver em reprodução de série.
  - Controle deslizante de Volume e Mute.

### 4.4 Navegação do Catálogo e Ação "Assistir na TV"
- O usuário navega normalmente em:
  - Lista de Canais ao Vivo.
  - Guia EPG.
  - VOD (Filmes, Séries, Detalhes de Temporadas).
- Quando o celular estiver pareado:
  - Clicar em um canal ou episódio exibe um diálogo/bottom sheet:
    - **▶ Assistir na TV** *(Botão primário em destaque)*.
    - **Assistir neste Celular** *(Botão secundário)*.
  - Ao clicar em "Assistir na TV", o celular emite `COMMAND_PLAY_MEDIA`.
  - O PC recebe a mensagem e imediatamente chama `loadMedia` na sessão de Cast da TV!

### 4.5 Aba Híbrida "Controle Remoto (D-Pad)" (`RemoteDpadView.tsx`)
- Disponível no menu inferior ou no modal expandido:
  - D-Pad direcional (Cima, Baixo, Esquerda, Direita, OK central).
  - Botões de Voltar, Home, Menu e Volume (+ / - / Mute).
  - Feedback háptico (`navigator.vibrate(20)`) a cada toque de botão.
  - Input de busca: permite digitar no teclado do celular e enviar o texto para os campos de pesquisa na tela grande.

---

## 5. Tolerância a Falhas e Resiliência

1. **Suspensão de Aba no Celular**:
   - Celulares desligam conexões ativas quando a tela bloqueia.
   - O frontend monitora o evento `visibilitychange`. Ao reabrir a tela, valida a conexão WebSocket e dispara `REQUEST_SYNC` para atualizar tempo e status da TV em menos de 100ms.
2. **Reconexão Automática com Backoff**:
   - Em oscilações de rede Wi-Fi, reconexão automática nos intervalos de 1s, 2s, 5s.
   - Exibição de indicador discreto *"Reconectando à TV..."* na barra inferior.
3. **Persistência de Sessão**:
   - `localStorage.setItem('viniplay_remote_session', ...)` permite que recarregar a página no celular não perca o pareamento.
   - Botão discreto "Desconectar da TV" permite voltar ao modo individual a qualquer momento.

---

## 6. Plano de Verificação e Testes

### 6.1 Testes Automatizados (Unit & Integration)
1. **Backend `MemoryRemoteSessionHub.test.ts`**:
   - Criação de sessão com geração de PIN único.
   - Atualização de estado `nowPlaying` e recuperação por PIN/SessionId.
   - Pub/sub de mensagens entre host e clientes.
   - Expiração de sessões antigas no sweep periódico.
2. **Backend WebSocket Handler `remoteWsServer.test.ts`**:
   - Conexão e autenticação de Host e Client via WebSocket.
   - Roteamento de comandos `COMMAND_PLAY_PAUSE`, `COMMAND_SEEK`, `COMMAND_PLAY_MEDIA`.
3. **Frontend `remoteStore.test.ts`**:
   - Gerenciamento de estado de conexão e processamento de mensagens `SYNC_STATE`.
   - Disparo correto de comandos para a TV.
4. **Frontend Component Tests**:
   - Renderização do modal de pareamento com QR Code no PC.
   - Renderização da barra "Now Playing" mobile ao parear.

### 6.2 Validação Manual
- Iniciar o ViniPlay no PC, abrir um vídeo ou canal e ativar o Cast para a Smart TV.
- No PC, clicar no ícone de parear celular e exibir o QR Code.
- No celular conectado na mesma rede Wi-Fi, escanear o QR Code.
- Validar sincronização imediata do título, capa e tempo na barra inferior do celular.
- No celular, navegar pelas categorias de filmes/séries, escolher outro episódio e clicar em "Assistir na TV".
- Confirmar que a TV troca imediatamente de episódio sem que o usuário precise sair da cama.
