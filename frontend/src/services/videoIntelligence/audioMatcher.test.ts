import { describe, it, expect } from 'vitest';
import { hammingDistance, findIntroSegment } from './audioMatcher';

describe('audioMatcher', () => {
  it('correctly calculates Hamming Distance between numbers', () => {
    // 0b1010 vs 0b1000 = 1 bit difference
    expect(hammingDistance(0b1010, 0b1000)).toBe(1);
    // 0b1111 vs 0b0000 = 4 bits difference
    expect(hammingDistance(0b1111, 0b0000)).toBe(4);
    // identical numbers
    expect(hammingDistance(0xABCD1234, 0xABCD1234)).toBe(0);
  });

  it('detects a matching 20-second intro segment embedded at different offsets', () => {
    // 4 samples per second
    // 20s intro = 80 samples
    const introSamples: number[] = [];
    for (let i = 0; i < 80; i++) {
      introSamples.push(0xA5A5A5A5 ^ (i * 7));
    }

    // Episode A: 10s of random audio (40 samples), then 20s intro, then 20s audio
    const randomA = Array.from({ length: 40 }, (_, i) => Math.imul(i + 1, 0x5bd1e995) >>> 0);
    const postA = Array.from({ length: 40 }, (_, i) => Math.imul(i + 1, 0x1b873593) >>> 0);
    const epA = [...randomA, ...introSamples, ...postA];

    // Episode B: 15s of random audio (60 samples), then 20s intro with slight bit noise (1 bit flip per sample), then 20s audio
    const randomB = Array.from({ length: 60 }, (_, i) => Math.imul(i + 1, 0xcc9e2d51) >>> 0);
    const noisyIntro = introSamples.map((hash) => (hash ^ 0x01) >>> 0); // 1-bit perturbation
    const postB = Array.from({ length: 40 }, (_, i) => Math.imul(i + 1, 0x85ebca6b) >>> 0);
    const epB = [...randomB, ...noisyIntro, ...postB];

    const result = findIntroSegment(epA, epB, 15, 60);

    expect(result.found).toBe(true);
    // Episode B intro starts at sample 60 = 15 seconds!
    expect(result.startSec).toBe(15);
    expect(result.durationSec).toBeGreaterThanOrEqual(20);
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('returns found: false when fingerprints do not have matching intro', () => {
    const epA = Array.from({ length: 120 }, (_, i) => 0xAAAAAAAA + i);
    const epB = Array.from({ length: 120 }, (_, i) => 0x55555555 + i);

    const result = findIntroSegment(epA, epB, 15, 60);
    expect(result.found).toBe(false);
  });
});
