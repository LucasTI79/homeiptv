import type { IConnectionHub } from './IConnectionHub';

interface Entry<T> {
  value: T;
  expiresAt: number | null;
}

const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

export class InMemoryConnectionHub<T> implements IConnectionHub<T> {
  private entries = new Map<string, Entry<T>>();
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(sweepIntervalMs: number = DEFAULT_SWEEP_INTERVAL_MS) {
    if (sweepIntervalMs > 0) {
      this.sweepTimer = setInterval(() => this.sweepExpired(), sweepIntervalMs);
      this.sweepTimer.unref();
    }
  }

  destroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.entries.clear();
  }

  async get(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.isExpired(entry)) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async set(key: string, value: T, ttlMs?: number): Promise<void> {
    const expiresAt = ttlMs !== undefined ? Date.now() + ttlMs : null;
    this.entries.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }

  async size(): Promise<number> {
    return this.entries.size;
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }

  private isExpired(entry: Entry<T>): boolean {
    return entry.expiresAt !== null && entry.expiresAt < Date.now();
  }

  private sweepExpired(): void {
    for (const [key, entry] of this.entries.entries()) {
      if (this.isExpired(entry)) {
        this.entries.delete(key);
      }
    }
  }
}
