export type ClipType = "video" | "audio";

export interface Clip {
  id: string;
  file: File;
  type: ClipType;
  originalDuration: number; // seconds
  inPoint: number; // seconds
  outPoint: number; // seconds
  thumbnailUrl?: string;
  order: number;
}
