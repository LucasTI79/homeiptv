export function parseDurationToSecs(rawSecs: unknown, rawDurationStr?: unknown): number | null {
  if (typeof rawSecs === 'number' && !isNaN(rawSecs) && rawSecs > 0) {
    return Math.round(rawSecs);
  }
  if (typeof rawSecs === 'string' && rawSecs.trim().length > 0) {
    const trimmed = rawSecs.trim();
    if (!trimmed.includes(':')) {
      const parsedNum = Number(trimmed);
      if (!isNaN(parsedNum) && parsedNum > 0) {
        return Math.round(parsedNum);
      }
    } else {
      return parseTimeStringToSecs(trimmed);
    }
  }
  if (typeof rawDurationStr === 'string' && rawDurationStr.trim().length > 0) {
    const trimmed = rawDurationStr.trim();
    if (!trimmed.includes(':')) {
      const parsedNum = Number(trimmed);
      if (!isNaN(parsedNum) && parsedNum > 0) {
        return Math.round(parsedNum);
      }
    } else {
      return parseTimeStringToSecs(trimmed);
    }
  }
  return null;
}

export function parseTimeStringToSecs(timeStr: string): number | null {
  const parts = timeStr.split(':').map((p) => parseFloat(p));
  if (parts.length === 3 && parts.every((p) => !isNaN(p))) {
    return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]);
  }
  if (parts.length === 2 && parts.every((p) => !isNaN(p))) {
    return Math.round(parts[0] * 60 + parts[1]);
  }
  return null;
}
