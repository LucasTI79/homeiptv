import crypto from 'crypto';
import { RemoteMessage, RemoteNowPlayingState, RemoteSession } from '@homeiptv/shared-types';
import { IRemoteSessionHub } from './IRemoteSessionHub';

type SubscriberCallback = (msg: RemoteMessage) => void;

export class MemoryRemoteSessionHub implements IRemoteSessionHub {
  private sessionsById = new Map<string, RemoteSession>();
  private sessionIdByPin = new Map<string, string>();
  private subscribers = new Map<string, Map<string, SubscriberCallback>>();
  private socketToSession = new Map<string, string>();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly sessionTtlSeconds: number;

  constructor(sessionTtlSeconds = 3 * 3600) {
    this.sessionTtlSeconds = sessionTtlSeconds;
    // Sweep every 10 minutes
    this.cleanupTimer = setInterval(() => {
      this.sweepExpiredSessions();
    }, 10 * 60 * 1000);
  }

  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.sessionsById.clear();
    this.sessionIdByPin.clear();
    this.subscribers.clear();
    this.socketToSession.clear();
  }

  private generatePinCode(): string {
    let pin = '';
    for (let attempts = 0; attempts < 100; attempts++) {
      const num = crypto.randomInt(100000, 1000000); // 6 digits
      const formatted = `${String(num).slice(0, 3)}-${String(num).slice(3)}`;
      const clean = String(num);
      if (!this.sessionIdByPin.has(formatted) && !this.sessionIdByPin.has(clean)) {
        return formatted;
      }
    }
    // Fallback
    const fallbackNum = Date.now() % 1000000;
    return `${String(fallbackNum).padStart(6, '0').slice(0, 3)}-${String(fallbackNum).padStart(6, '0').slice(3)}`;
  }

  public async createSession(hostDeviceId: string): Promise<RemoteSession> {
    const sessionId = crypto.randomUUID();
    const pinCode = this.generatePinCode();
    const now = Date.now();

    const session: RemoteSession = {
      sessionId,
      pinCode,
      hostDeviceId,
      createdAt: now,
      lastActiveAt: now,
    };

    this.sessionsById.set(sessionId, session);
    this.sessionIdByPin.set(pinCode, sessionId);
    this.sessionIdByPin.set(pinCode.replace('-', ''), sessionId);

    return session;
  }

  public async getSession(sessionId: string): Promise<RemoteSession | null> {
    const session = this.sessionsById.get(sessionId);
    if (!session) return null;
    this.touchSessionInternal(session);
    return session;
  }

  public async getSessionByPin(pin: string): Promise<RemoteSession | null> {
    const cleanPin = pin.replace(/\s+/g, '').replace('-', '');
    const formattedPin = cleanPin.length === 6 ? `${cleanPin.slice(0, 3)}-${cleanPin.slice(3)}` : pin;

    const sessionId = this.sessionIdByPin.get(formattedPin) || this.sessionIdByPin.get(cleanPin);
    if (!sessionId) return null;

    return this.getSession(sessionId);
  }

  public async touchSession(sessionId: string): Promise<void> {
    const session = this.sessionsById.get(sessionId);
    if (session) {
      this.touchSessionInternal(session);
    }
  }

  private touchSessionInternal(session: RemoteSession): void {
    session.lastActiveAt = Date.now();
  }

  public async updateNowPlaying(sessionId: string, state: RemoteNowPlayingState): Promise<void> {
    const session = this.sessionsById.get(sessionId);
    if (session) {
      session.nowPlaying = state;
      session.lastActiveAt = Date.now();
    }
  }

  public async closeSession(sessionId: string): Promise<void> {
    const session = this.sessionsById.get(sessionId);
    if (session) {
      this.sessionIdByPin.delete(session.pinCode);
      this.sessionIdByPin.delete(session.pinCode.replace('-', ''));
      this.sessionsById.delete(sessionId);
    }

    const sessionSubs = this.subscribers.get(sessionId);
    if (sessionSubs) {
      for (const socketId of sessionSubs.keys()) {
        this.socketToSession.delete(socketId);
      }
      this.subscribers.delete(sessionId);
    }
  }

  public async publishToSession(
    sessionId: string,
    message: RemoteMessage,
    senderSocketId?: string
  ): Promise<void> {
    const sessionSubs = this.subscribers.get(sessionId);
    if (!sessionSubs) return;

    for (const [socketId, callback] of sessionSubs.entries()) {
      if (senderSocketId && socketId === senderSocketId) {
        continue;
      }
      try {
        callback(message);
      } catch (err) {
        console.error(`[MemoryRemoteSessionHub] Error delivering message to socket ${socketId}:`, err);
      }
    }
  }

  public subscribeToSession(
    sessionId: string,
    socketId: string,
    onMessage: SubscriberCallback
  ): () => void {
    let sessionSubs = this.subscribers.get(sessionId);
    if (!sessionSubs) {
      sessionSubs = new Map<string, SubscriberCallback>();
      this.subscribers.set(sessionId, sessionSubs);
    }

    sessionSubs.set(socketId, onMessage);
    this.socketToSession.set(socketId, sessionId);

    return () => {
      const subs = this.subscribers.get(sessionId);
      if (subs) {
        subs.delete(socketId);
        if (subs.size === 0) {
          this.subscribers.delete(sessionId);
        }
      }
      this.socketToSession.delete(socketId);
    };
  }

  public async removeSocket(socketId: string): Promise<void> {
    const sessionId = this.socketToSession.get(socketId);
    if (sessionId) {
      const subs = this.subscribers.get(sessionId);
      if (subs) {
        subs.delete(socketId);
        if (subs.size === 0) {
          this.subscribers.delete(sessionId);
        }
      }
      this.socketToSession.delete(socketId);
    }
  }

  public getClientCount(sessionId: string): number {
    return this.subscribers.get(sessionId)?.size || 0;
  }

  private sweepExpiredSessions(): void {
    const now = Date.now();
    const ttlMs = this.sessionTtlSeconds * 1000;

    for (const [sessionId, session] of this.sessionsById.entries()) {
      if (now - session.lastActiveAt > ttlMs) {
        this.closeSession(sessionId).catch(() => {});
      }
    }
  }
}
