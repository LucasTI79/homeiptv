export interface SubtitleRequest {
  mediaUrl: string;
  targetId: string;
  // Whisper's transcription has two visible phases the frontend distinguishes
  // in its UI text (extracting_audio vs transcribing) -- this optional hook
  // lets a provider report that progress without the generic ProviderChain
  // or the job queue needing to know which provider is running.
  onProgress?: (phase: 'extracting_audio' | 'transcribing') => void;
}

export interface SubtitleResult {
  available: boolean;
  vttPath?: string;
}
