# Design: Custom Cast Receiver & Resiliência de Transmissão (Inactivity Lifetime)

- **Data**: 2026-10-14
- **Status**: Proposto (Aprovado em Brainstorming)
- **Autor**: Antigravity / Pair Programming com o Usuário

---

## 1. Visão Geral e Problema

Ao transmitir conteúdo do ViniPlay para uma Smart TV / Chromecast, a transmissão é frequentemente interrompida de forma involuntária quando a reprodução fica pausada ou ociosa por alguns minutos.

As causas raízes identificadas foram:
1. **Google Default Media Receiver (`CC1AD845`)**: Possui um timer de inatividade de fábrica (`maxInactivity`) fixo em **300 segundos (5 minutos)**. Se a sessão for iniciada sem mídia em reprodução (ou permanecer pausada/idle), o próprio Chromecast fecha a aplicação para evitar *burn-in* e economizar energia.
2. **Janitor de Inatividade do Backend**: Mata processos do `ffmpeg` com `references <= 0` após apenas **60 segundos** (`STREAM_INACTIVITY_TIMEOUT = 60000`). Se a conexão HTTP cair ou pausar por mais de 1 minuto, a stream é morta com `SIGKILL`.
3. **Suspensão da Aba do Navegador (Memory Saver / Sleeping Tabs)**: O navegador remetente congela abas inativas, interrompendo os pings de *Heartbeat* do Cast SDK para a TV.

### Objetivos Principais
1. **Custom Web Receiver Autônomo**: Criar uma aplicação web receptora leve e dedicada (`cast-receiver/`) com CAF (Cast Application Framework) configurada com `maxInactivity: 3600` (1 hora) e identidade visual ViniPlay.
2. **Configuração Dinâmica de App ID**: Permitir configurar `castReceiverAppId` nas configurações do ViniPlay com fallback automático para o Default Media Receiver (`CC1AD845`).
3. **Janitor Resiliente com Timeout Configurável**: Substituir os 60s hardcoded por `streamInactivityTimeoutSeconds` (padrão de 15 minutos = 900s).
4. **Mecanismo de Keep-Alive**: Implementar `POST /api/stream/keep-alive` e heartbeat periódico no `CastProvider` para garantir que o backend mantenha streams vivas enquanto a sessão de Cast estiver conectada.

---

## 2. Arquitetura do Sistema

```
+-----------------------------------------------------------------------------------------+
|                                    GOOGLE CAST ECOSYSTEM                                |
|                                                                                         |
|   +-----------------------+              (App ID lookup)              +-------------+   |
|   | Google Cast Dev Portal| <---------------------------------------- | Chromecast  |   |
|   | (Custom App ID)       | ----------------------------------------> | (Smart TV)  |   |
|   +-----------------------+   URL: https://...github.io/cast-receiver/ +------+------+   |
+-------------------------------------------------------------------------------|---------+
                                                                                |
                                            Carrega o Custom Web Receiver (CAF) |
                                            maxInactivity: 3600s                |
                                            Keep-Alive & fMP4 / HLS Player      v
+-------------------------------+                     +-----------------------------------+
|     FRONTEND (ViniPlay Web)   |                     |     CUSTOM RECEIVER (Static App)  |
|                               |                     |     (cast-receiver/index.html)    |
|   +-----------------------+   |                     |                                   |
|   | CastProvider          |   |                     |   - cast_receiver_framework.js    |
|   | - settings.appId      | --+-- Cast WebRTC/WS -> |   - <cast-media-player>           |
|   | - 30s Heartbeat loop  |   |   Session Control   |   - ViniPlay Splash & Metadata    |
|   +-----------+-----------+   |                     +-----------------------------------+
+---------------|---------------+                                       |
                |                                                       |
                | POST /api/stream/keep-alive                           | GET /stream ou
                v                                                       | GET /api/media-proxy
+-----------------------------------------------------------------------v-----------------+
|                                    BACKEND (ViniPlay Node.js)                           |
|                                                                                         |
|   +-------------------------+      +-----------------------+      +-----------------+   |
|   | streamRouter            |      | streamState           |      | proxyRouter     |   |
|   | - /api/stream/keep-alive| ---> | - updateActiveStream  |      | - /media-proxy  |   |
|   | - /stream (fMP4 / HLS)  |      | - lastAccess = now    |      |   (60s timeout) |   |
|   +-------------------------+      +-----------+-----------+      +-----------------+   |
|                                                |                                        |
|                                                v                                        |
|                                    +-----------------------+                            |
|                                    | Janitor (15s loop)    |                            |
|                                    | Timeout: 900s (15 min)|                            |
|                                    +-----------------------+                            |
+-----------------------------------------------------------------------------------------+
```

---

## 3. O Custom Web Receiver (`cast-receiver/`)

### 3.1 Estrutura de Arquivos
Criado na raiz do repositório como um pacote estático independente:
```text
cast-receiver/
├── index.html        # Estrutura HTML do receiver com <cast-media-player> e splash ViniPlay
├── receiver.js       # Inicialização do CastReceiverContext, interceptor de LOAD e eventos
├── style.css         # Dark theme com gradientes azuis/grafite e animação suave de respiração
├── assets/
│   ├── logo.svg      # Logo vetorial do ViniPlay para exibição na TV
│   └── favicon.ico
└── README.md         # Manual para hospedar no GitHub Pages e registrar no Cast Console
```

### 3.2 Lógica do Receiver (`receiver.js`)
* **Framework**: Importa `//www.gstatic.com/cast/sdk/libs/caf_receiver/v1.0/cast_receiver_framework.js`.
* **Configuração de Inatividade**:
  ```javascript
  const context = cast.framework.CastReceiverContext.getInstance();
  const playerManager = context.getPlayerManager();

  const options = new cast.framework.CastReceiverOptions();
  options.maxInactivity = 3600; // 1 hora de tolerância a inatividade (em vez de 300s)
  ```
* **Interceptor de `LOAD`**:
  * Ajusta buffers de reprodução do Shaka Player interno para reduzir congelamentos em redes lentas.
  * Formata e valida `media.metadata` (Título, Imagem de Logo, Informações de Canal/Série).
* **Gestão de Estados Visuais**:
  * **Ocioso (Pronto para Transmitir)**: Exibe a tela de splash elegante do ViniPlay com o status *"Conectado e aguardando reprodução"*.
  * **Carregando (Buffering)**: Spinner moderno estilizado com a paleta do ViniPlay.
  * **Reproduzindo / Pausado**: Controles e barra de progresso nativos integrados ao CAF.

---

## 4. Backend: Resiliência de Streams e Configurações

### 4.1 Schema de Configurações (`shared/types/settings.ts` e `backend/src/services/settings.ts`)
Adição de duas propriedades na interface `Settings`:
```typescript
export interface Settings {
  // ... campos existentes ...
  castReceiverAppId?: string; // ID da aplicação no Google Cast (padrão: CC1AD845)
  streamInactivityTimeoutSeconds?: number; // Tolerância do janitor (padrão: 900)
}
```
Valores padrão garantidos em `backend/src/services/settings.ts`:
* `castReceiverAppId`: `'CC1AD845'`
* `streamInactivityTimeoutSeconds`: `900`

### 4.2 Janitor Resiliente (`backend/src/state/streamState.ts`)
Substituição da constante estática `STREAM_INACTIVITY_TIMEOUT` por uma resolução dinâmica:
```typescript
export function getStreamInactivityTimeoutMs(): number {
  const settings = getSettings();
  const seconds = settings.streamInactivityTimeoutSeconds ?? 900;
  return Math.max(60, seconds) * 1000;
}

export function cleanupInactiveStreams(): void {
  const now = Date.now();
  const timeoutMs = getStreamInactivityTimeoutMs();

  activeStreamProcesses.forEach((streamInfo, streamKey) => {
    if (streamInfo.references <= 0 && now - streamInfo.lastAccess > timeoutMs) {
      console.log(`[JANITOR] Finalizando stream inativa: ${streamKey} (sem conexões há > ${timeoutMs / 1000}s)`);
      // SIGKILL no ffmpeg e atualização do histórico de reprodução
      // ...
    }
  });
}
```

### 4.3 Endpoint de Keep-Alive (`backend/src/routes/stream.ts`)
```typescript
// POST /api/stream/keep-alive
streamRouter.post('/api/stream/keep-alive', allowLocalOrAuth(activeCastTokens), async (req, res) => {
  const { streamKey, streamUrl } = req.body;
  const now = Date.now();

  let touched = false;
  activeStreamProcesses.forEach((info, key) => {
    if ((streamKey && key === streamKey) || (streamUrl && key.includes(streamUrl))) {
      info.lastAccess = now;
      touched = true;
    }
  });

  res.json({ success: true, touched, timestamp: now });
});
```

### 4.4 Ajuste no Proxy de Mídia VOD (`backend/src/routes/proxy.ts`)
* Aumento do timeout de upstream de 30s para 60s.
* Garante que pausas prolongadas do player em arquivos VOD não encerrem imediatamente os descritores de arquivo/sockets upstream de forma abrupta.

---

## 5. Frontend: CastProvider e Interface de Configurações

### 5.1 `CastProvider.tsx`
* **Leitura do App ID**:
  ```typescript
  const activeAppId = settings?.castReceiverAppId?.trim() || 'CC1AD845';
  castContext.setOptions({
    receiverApplicationId: activeAppId,
    autoJoinPolicy: chromeCast?.AutoJoinPolicy?.ORIGIN_SCOPED || 1,
  });
  ```
* **Heartbeat Automático**:
  * Enquanto `isCasting && isConnected` for verdadeiro, um `setInterval` dispara a cada 30 segundos uma chamada para `/api/stream/keep-alive` enviando a URL do canal/VOD ativo.
  * O timer é desmontado no `handleSessionEnd`.

### 5.2 UI em `ProfilesTab.tsx`
No card de configurações de Streaming & Cast:
* Campo para **Google Cast Application ID**:
  * Input com placeholder `CC1AD845 (Default Media Receiver)`.
  * Dica explicativa com link/referência para o Custom Receiver.
* Seletor para **Tempo Limite de Inatividade (Janitor)**:
  * Opções: 5 minutos (300s), 10 minutos (600s), 15 minutos (900s - Padrão), 30 minutos (1800s).

---

## 6. Estratégia de Testes

1. **Testes Unitários no Backend**:
   * `backend/src/state/__tests__/streamState.test.ts`: Validar que o janitor respeita o timeout dinâmico definido em `settings.streamInactivityTimeoutSeconds`.
   * `backend/src/routes/__tests__/stream.keep-alive.test.ts`: Validar que o endpoint de keep-alive renova o `lastAccess` das streams ativas correspondentes.
2. **Testes Unitários no Frontend**:
   * Testar que o `CastProvider` usa o `castReceiverAppId` das configurações quando fornecido, ou faz fallback para `CC1AD845`.
3. **Verificação Manual & Integração**:
   * Lançar stream no Cast, pausar por 3 minutos e verificar nos logs do servidor que o processo do ffmpeg permanece vivo (`references: 0`, mas com `lastAccess` renovado ou aguardando dentro dos 15 minutos).
   * Despausar após 3 minutos e confirmar retomada imediata do vídeo na TV.
