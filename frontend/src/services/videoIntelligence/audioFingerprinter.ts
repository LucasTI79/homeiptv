import { VIDEO_INTELLIGENCE_CONFIG } from './config';

export class AudioFingerprintCollector {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private timer: number | null = null;
  public fingerprints: number[] = [];

  // 33 frequency band edges from 300Hz to 11650Hz (log scale)
  private readonly BANDS = [
    300, 330, 370, 415, 465, 520, 585, 655, 735, 825,
    925, 1040, 1165, 1310, 1470, 1650, 1855, 2080, 2335, 2620,
    2940, 3300, 3700, 4150, 4650, 5200, 5850, 6550, 7350, 8250,
    9250, 10400, 11650
  ];

  /**
   * Starts collecting fingerprints from an active HTMLVideoElement.
   * Automatically stops after maxDurationSec to keep CPU at 0%.
   */
  start(
    videoElement: HTMLVideoElement,
    maxDurationSec = VIDEO_INTELLIGENCE_CONFIG.intro.maxAnalysisWindowSeconds,
    onSample?: (sampleIndex: number, currentHash: number) => void
  ): boolean {
    if (this.audioCtx) return true;

    try {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtxClass) return false;

      this.audioCtx = new AudioCtxClass();
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.2;

      this.source = this.audioCtx.createMediaElementSource(videoElement);
      this.source.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);

      const sampleRate = this.audioCtx.sampleRate;
      const binCount = this.analyser.frequencyBinCount; // 1024
      const freqData = new Uint8Array(binCount);

      // Collect 4 samples per second (every 250ms)
      this.timer = window.setInterval(() => {
        if (!this.analyser || videoElement.paused || videoElement.ended) return;

        // Auto-stop after window of interest
        if (videoElement.currentTime > maxDurationSec) {
          this.stop();
          return;
        }

        this.analyser.getByteFrequencyData(freqData);
        const hash = this.computeSubbandHash(freqData, sampleRate, binCount);
        this.fingerprints.push(hash);
        if (onSample) {
          onSample(this.fingerprints.length - 1, hash);
        }
      }, 250);

      return true;
    } catch (e) {
      console.warn('AudioFingerprintCollector could not start (likely CORS or audio permissions):', e);
      this.cleanUp();
      return false;
    }
  }

  public computeSubbandHash(freqData: Uint8Array, sampleRate: number, binCount: number): number {
    const energies: number[] = [];
    const hzPerBin = sampleRate / (binCount * 2);

    for (let i = 0; i < 33; i++) {
      const startBin = Math.floor(this.BANDS[i] / hzPerBin);
      const endBin = Math.min(Math.floor((this.BANDS[i + 1] || 12000) / hzPerBin), binCount - 1);

      let sum = 0;
      for (let b = startBin; b <= endBin; b++) {
        sum += freqData[b];
      }
      energies.push(sum / Math.max(1, endBin - startBin + 1));
    }

    let hash = 0;
    for (let i = 0; i < 32; i++) {
      if (energies[i] > energies[i + 1]) {
        hash |= (1 << i);
      }
    }
    return hash >>> 0;
  }

  stop(): number[] {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return this.fingerprints;
  }

  private cleanUp() {
    this.stop();
    if (this.source) {
      try { this.source.disconnect(); } catch { /* ignore */ }
      this.source = null;
    }
    if (this.analyser) {
      try { this.analyser.disconnect(); } catch { /* ignore */ }
      this.analyser = null;
    }
    if (this.audioCtx) {
      try { this.audioCtx.close(); } catch { /* ignore */ }
      this.audioCtx = null;
    }
  }

  destroy() {
    this.cleanUp();
    this.fingerprints = [];
  }
}
