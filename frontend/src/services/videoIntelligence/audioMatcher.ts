import { VIDEO_INTELLIGENCE_CONFIG } from './config';

// audioMatcher.ts
// Cross-correlates two audio fingerprint series via sliding Hamming distance

export function hammingDistance(a: number, b: number): number {
  let diff = (a ^ b) >>> 0;
  let count = 0;
  while (diff) {
    diff &= diff - 1;
    count++;
  }
  return count;
}

export interface MatchResult {
  found: boolean;
  startSec: number;
  endSec: number;
  durationSec: number;
  confidence: number;
}

/**
 * Finds repeated intro/outro audio segment between two episodes.
 * Assumes 4 samples per second (250ms interval).
 *
 * @param fpA Reference fingerprint (e.g. Episode 1)
 * @param fpB Target fingerprint (e.g. Episode 2)
 * @param minDurationSec Minimum duration in seconds to consider an intro
 * @param maxDurationSec Maximum duration in seconds for intro
 */
export function findIntroSegment(
  fpA: number[],
  fpB: number[],
  minDurationSec: number = VIDEO_INTELLIGENCE_CONFIG.intro.minIntroDurationSeconds,
  maxDurationSec: number = VIDEO_INTELLIGENCE_CONFIG.intro.maxIntroDurationSeconds
): MatchResult {
  const SAMPLES_PER_SEC = 1000 / VIDEO_INTELLIGENCE_CONFIG.intro.samplingIntervalMs;
  const minSamples = minDurationSec * SAMPLES_PER_SEC;
  const maxSamples = maxDurationSec * SAMPLES_PER_SEC;

  let bestMatch: MatchResult = {
    found: false,
    startSec: 0,
    endSec: 0,
    durationSec: 0,
    confidence: 0
  };

  const lenA = fpA.length;
  const lenB = fpB.length;
  if (lenA < minSamples || lenB < minSamples) {
    return bestMatch;
  }

  const THRESHOLD_BIT_ERROR = VIDEO_INTELLIGENCE_CONFIG.intro.thresholdBitError;

  for (let offsetB = 0; offsetB <= lenB - minSamples; offsetB += 2) {
    for (let offsetA = 0; offsetA <= lenA - minSamples; offsetA += 2) {
      let consecutiveMatches = 0;
      let totalBitErrors = 0;
      let matchStartK = 0;

      for (let k = 0; k < maxSamples && (offsetA + k < lenA) && (offsetB + k < lenB); k++) {
        const dist = hammingDistance(fpA[offsetA + k], fpB[offsetB + k]);
        if (dist <= THRESHOLD_BIT_ERROR) {
          if (consecutiveMatches === 0) {
            matchStartK = k;
          }
          consecutiveMatches++;
          totalBitErrors += dist;
        } else {
          // If we already reached minSamples, stop at first divergence
          if (consecutiveMatches >= minSamples) {
            break;
          }
          consecutiveMatches = 0;
          totalBitErrors = 0;
        }
      }

      if (consecutiveMatches >= minSamples) {
        const durationSec = consecutiveMatches / SAMPLES_PER_SEC;
        const avgBitError = totalBitErrors / consecutiveMatches;
        const confidence = Math.max(0, 1 - (avgBitError / 32));

        if (confidence > bestMatch.confidence) {
          bestMatch = {
            found: true,
            startSec: (offsetB + matchStartK) / SAMPLES_PER_SEC,
            endSec: (offsetB + matchStartK + consecutiveMatches) / SAMPLES_PER_SEC,
            durationSec,
            confidence: Number(confidence.toFixed(3))
          };
        }
      }
    }
  }

  return bestMatch;
}
