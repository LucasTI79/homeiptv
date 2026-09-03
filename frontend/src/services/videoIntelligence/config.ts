/**
 * Configurações e constantes do sistema de Inteligência Audiovisual e Reprodução
 */

export const VIDEO_INTELLIGENCE_CONFIG = {
  // --- Timing de Reprodução e Progresso ---
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

  // --- Detecção de Introdução (Audio Fingerprinting) ---
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

  // --- Detecção de Créditos e Fim de Episódio ---
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
