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
  inPoint: number; // seconds
  outPoint: number; // seconds
  thumbnailUrl?: string;
  order: number;
  transcript?: TranscriptCue[]; // only populated for URL-imported clips with captions available
}
