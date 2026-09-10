export type ClipType = "video" | "audio";

export interface TranscriptCue {
  start: number; // seconds
  text: string;
}

export interface Clip {
  id: string;
  file: File;
  type: ClipType;
  originalDuration: number; // seconds
  inPoint: number; // seconds, within the source
  outPoint: number; // seconds, within the source
  startAt: number; // seconds on the project timeline
  track: number; // 0 = V1; higher tracks render on top where clips overlap
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  order: number;
  assetId?: string; // media-bin asset this clip was placed from
  transcript?: TranscriptCue[]; // only populated for URL-imported clips with captions available
}
