export interface ThumbnailRequest {
  mediaUrl: string;
  targetId: string;
  outputPath: string;
}

export interface ThumbnailResult {
  available: boolean;
  thumbnailPath?: string;
}
