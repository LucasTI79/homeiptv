import { describe, it, expect } from 'vitest';
import { parseDurationToSecs, parseTimeStringToSecs } from '../vodUtils';

describe('vodUtils - parseDurationToSecs', () => {
  it('parses numeric seconds correctly', () => {
    expect(parseDurationToSecs(2700)).toBe(2700);
    expect(parseDurationToSecs(3600.4)).toBe(3600);
  });

  it('parses numeric string seconds correctly', () => {
    expect(parseDurationToSecs('2700')).toBe(2700);
    expect(parseDurationToSecs('  1800  ')).toBe(1800);
  });

  it('parses time formatted strings (HH:MM:SS) correctly', () => {
    expect(parseDurationToSecs('00:45:00')).toBe(2700);
    expect(parseDurationToSecs('01:30:15')).toBe(5415);
  });

  it('parses time formatted strings (MM:SS) correctly', () => {
    expect(parseDurationToSecs('23:15')).toBe(1395);
  });

  it('uses fallback rawDurationStr if rawSecs is missing or empty', () => {
    expect(parseDurationToSecs(null, '00:45:00')).toBe(2700);
    expect(parseDurationToSecs(undefined, '1800')).toBe(1800);
  });

  it('returns null for invalid or negative values', () => {
    expect(parseDurationToSecs(null)).toBeNull();
    expect(parseDurationToSecs(undefined)).toBeNull();
    expect(parseDurationToSecs('')).toBeNull();
    expect(parseDurationToSecs(-10)).toBeNull();
    expect(parseDurationToSecs('invalid')).toBeNull();
  });
});
