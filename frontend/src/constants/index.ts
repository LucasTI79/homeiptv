/**
 * Constantes Globais e Configurações Unificadas da Aplicação ViniPlay
 * 
 * Centraliza 100% dos parâmetros de:
 * 1. Player de Vídeo e Áudio
 * 2. VOD e Continue Watching
 * 3. Multiview e Grades de Visualização
 * 4. Inteligência Audiovisual (Skip Intro, Detecção de Créditos e Próximo Episódio)
 */

// ==========================================
// 1. CONFIGURAÇÕES DO PLAYER PRINCIPAL
// ==========================================
export const PLAYER_CONFIG = {
  /** Volume inicial padrão (0.0 a 1.0) caso não haja preferência salva */
  defaultVolume: 0.5,
  /** Chave no localStorage para persistir o volume do player */
  volumeStorageKey: 'iptvPlayerVolume',
  /** Intervalo de amostragem e persistência periódica de progresso (em ms) */
  progressIntervalMs: 2000,
  /** Tempo mínimo de progresso salvo (em segundos) para sugerir retomada ao abrir o vídeo */
  minResumeThresholdSeconds: 10,
  /** Distância mínima antes do fim do vídeo (em segundos) para sugerir retomada */
  maxResumeThresholdBeforeEndSeconds: 30,
} as const;

// ==========================================
// 2. CONFIGURAÇÕES DE VOD E CONTINUE WATCHING
// ==========================================
export const PLAYBACK_CONFIG = {
  /** Percentual mínimo (0 a 1) para considerar um item assistido e avançar/remover (95%) */
  completionThreshold: 0.95,
  /** Quantidade máxima de itens exibidos no carrossel de Continue Watching */
  maxContinueWatchingItems: 12,
  /** Tempo de debounce (ms) para filtros e busca de conteúdo no catálogo VOD */
  searchDebounceMs: 200,
  /** Quantidade de itens exibidos por página no catálogo VOD */
  itemsPerPage: 48,
  /** Chaves de armazenamento persistente do VOD */
  storageKeys: {
    progress: 'viniplay_vod_progress',
    favorites: 'viniplay_vod_favorites',
  },
} as const;

// ==========================================
// 3. CONFIGURAÇÕES DO MULTIVIEW
// ==========================================
export const MULTIVIEW_CONFIG = {
  /** Quantidade máxima de players simultâneos permitidos no grid */
  maxPlayers: 9,
  /** Número total de colunas na grade responsiva (12 colunas padrão) */
  gridColumns: 12,
  /** Altura padrão de cada linha da grade em pixels */
  rowHeight: 80,
  /** Margens entre os widgets na grade [x, y] em pixels */
  gridMargin: [8, 8] as [number, number],
  /** Dimensões padrão de um novo player adicionado */
  defaultWidget: {
    w: 4,
    h: 4,
  },
  /** Chaves de armazenamento offline no localStorage */
  storageKeys: {
    widgets: 'viniplay_multiview_widgets',
    layout: 'viniplay_multiview_layout',
    activePlayer: 'viniplay_multiview_active',
  },
} as const;

// ==========================================
// 4. CONFIGURAÇÕES DE INTELIGÊNCIA AUDIOVISUAL
// ==========================================
export const VIDEO_INTELLIGENCE_CONFIG = {
  // --- Timing de Reprodução e Transição de Episódios ---
  playback: {
    /** Tempo mínimo de reprodução contínua (em segundos) para começar a persistir no histórico */
    minProgressRecordSeconds: 5,
    /** Duração da contagem regressiva exibida ao usuário antes de auto-iniciar o próximo episódio */
    nextEpisodeCountdownSeconds: 5,
    /** Fallback: segundos antes do fim do vídeo para disparar o próximo episódio se créditos não forem detectados */
    nextEpisodeFallbackTriggerBeforeEndSeconds: 25,
    /** Duração mínima do vídeo (em segundos) necessária para considerar que há um próximo episódio */
    minVideoDurationForNextEpisodeSeconds: 30,
  },

  // --- Detecção de Abertura / Skip Intro (Audio Fingerprinting) ---
  intro: {
    /** Janela inicial do vídeo analisada para captura e busca de intro (em segundos). Após esse tempo, o coletor desliga */
    maxAnalysisWindowSeconds: 180,
    /** Intervalo de amostragem acústica (em milissegundos). 250ms = 4 amostras por segundo */
    samplingIntervalMs: 250,
    /** Duração mínima para considerar um trecho sonoro repetido como abertura (em segundos) */
    minIntroDurationSeconds: 15,
    /** Duração máxima esperada para uma abertura (em segundos) */
    maxIntroDurationSeconds: 120,
    /** Tolerância máxima de erro de bits em 32 bits (distância de Hamming) para considerar som equivalente (~18%) */
    thresholdBitError: 6,
    /** Confiança mínima (0.0 a 1.0) para aceitar e persistir um segmento de abertura no banco local */
    minMatchConfidence: 0.85,
  },

  // --- Detecção de Créditos e Fim de Episódio (Ótica) ---
  credits: {
    /** Janela máxima antes do fim do vídeo (em segundos) onde créditos podem ocorrer. Ignora trechos anteriores */
    maxWindowSeconds: 75,
    /** Tempo de espera / cooldown (em milissegundos) após qualquer seek antes de voltar a analisar frames */
    seekCooldownMs: 2000,
    /** Limiar de luminância média máxima (0 a 255) para considerar que a tela está em fade-to-black */
    blackFrameLumaThreshold: 6,
    /** Quantidade mínima de frames pretos consecutivos (amostrados a 1 FPS) para confirmar a transição de créditos */
    minConsecutiveBlackFrames: 2,
    /** Confiança atribuída à detecção ótica de créditos */
    detectionConfidence: 0.9,
  },
} as const;

// ==========================================
// 5. OBJETO CONSOLIDADO GERAL (APP_CONFIG)
// ==========================================
export const APP_CONFIG = {
  player: PLAYER_CONFIG,
  playback: PLAYBACK_CONFIG,
  multiview: MULTIVIEW_CONFIG,
  intelligence: VIDEO_INTELLIGENCE_CONFIG,
} as const;
