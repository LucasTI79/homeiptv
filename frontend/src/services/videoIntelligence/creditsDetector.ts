import { VIDEO_INTELLIGENCE_CONFIG } from './config';

export const MAX_CREDITS_WINDOW_SECONDS = VIDEO_INTELLIGENCE_CONFIG.credits.maxWindowSeconds;

export class CreditsDetector {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private timer: number | null = null;
  private consecutiveBlackFrames = 0;
  private lastSeekTimestamp = 0;
  private boundOnSeek: (() => void) | null = null;
  private videoEl: HTMLVideoElement | null = null;

  /**
   * Starts monitoring for black-frame transitions in the final window of the video.
   * Runs at only 1 FPS on a tiny 64x36 canvas (< 0.5% CPU).
   *
   * @param videoElement Active HTMLVideoElement
   * @param onCreditsDetected Callback fired when genuine credits transition is found
   */
  start(
    videoElement: HTMLVideoElement,
    onCreditsDetected: (creditsStartSec: number) => void
  ) {
    if (this.timer) return;

    this.videoEl = videoElement;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 64;
    this.canvas.height = 36;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.consecutiveBlackFrames = 0;
    this.lastSeekTimestamp = Date.now();

    // Track user seeks so we never trigger during a seek black screen
    this.boundOnSeek = () => {
      this.lastSeekTimestamp = Date.now();
      this.consecutiveBlackFrames = 0;
    };
    videoElement.addEventListener('seeking', this.boundOnSeek);
    videoElement.addEventListener('seeked', this.boundOnSeek);

    // Check once per second
    this.timer = window.setInterval(() => {
      if (!this.ctx || !this.canvas || videoElement.paused || videoElement.ended) return;

      // 1. Ignore if video is actively seeking or still buffering after a seek
      if (videoElement.seeking || Date.now() - this.lastSeekTimestamp < VIDEO_INTELLIGENCE_CONFIG.credits.seekCooldownMs) {
        this.consecutiveBlackFrames = 0;
        return;
      }

      // 2. Ignore if video does not have enough buffer data decoded yet
      if (videoElement.readyState < 3) {
        this.consecutiveBlackFrames = 0;
        return;
      }

      const dur = videoElement.duration;
      const curr = videoElement.currentTime;

      if (!dur || isNaN(dur) || dur < 60) return;

      // 3. Only monitor in the last window of the video
      if (curr < dur - VIDEO_INTELLIGENCE_CONFIG.credits.maxWindowSeconds) {
        this.consecutiveBlackFrames = 0;
        return;
      }

      try {
        this.ctx.drawImage(videoElement, 0, 0, 64, 36);
        const imgData = this.ctx.getImageData(0, 0, 64, 36);
        const data = imgData.data;

        let totalLuma = 0;
        const totalPixels = 64 * 36;

        // Sample pixel luminance (ITU-R BT.601)
        for (let i = 0; i < data.length; i += 4) {
          const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          totalLuma += luma;
        }

        const avgLuma = totalLuma / totalPixels;

        // A genuine fade-to-black transition before credits has an average luminance below threshold
        if (avgLuma < VIDEO_INTELLIGENCE_CONFIG.credits.blackFrameLumaThreshold) {
          this.consecutiveBlackFrames++;
          // Require consecutive frames of sustained transition to avoid seek/cut glitches
          if (this.consecutiveBlackFrames >= VIDEO_INTELLIGENCE_CONFIG.credits.minConsecutiveBlackFrames) {
            onCreditsDetected(Math.floor(curr));
            this.stop();
          }
        } else {
          this.consecutiveBlackFrames = 0;
        }
      } catch {
        // Cross-origin canvas security restriction fallback
        this.stop();
      }
    }, 1000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.videoEl && this.boundOnSeek) {
      this.videoEl.removeEventListener('seeking', this.boundOnSeek);
      this.videoEl.removeEventListener('seeked', this.boundOnSeek);
      this.boundOnSeek = null;
      this.videoEl = null;
    }
    this.canvas = null;
    this.ctx = null;
    this.consecutiveBlackFrames = 0;
  }
}
