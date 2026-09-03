import { RemoteSession, RemoteNowPlayingState, RemoteMessage } from '@homeiptv/shared-types';

export interface IRemoteSessionHub {
  createSession(hostDeviceId: string): Promise<RemoteSession>;
  getSession(sessionId: string): Promise<RemoteSession | null>;
  getSessionByPin(pin: string): Promise<RemoteSession | null>;
  touchSession(sessionId: string): Promise<void>;
  updateNowPlaying(sessionId: string, state: RemoteNowPlayingState): Promise<void>;
  closeSession(sessionId: string): Promise<void>;

  publishToSession(sessionId: string, message: RemoteMessage, senderSocketId?: string): Promise<void>;
  subscribeToSession(sessionId: string, socketId: string, onMessage: (msg: RemoteMessage) => void): () => void;
  removeSocket(socketId: string): Promise<void>;
  getClientCount(sessionId: string): number;
}
