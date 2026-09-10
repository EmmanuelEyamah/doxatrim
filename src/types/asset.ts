import type { ClipType, TranscriptCue } from "@/types/clip";

/** A source file in the media bin. Timeline clips and audio layers are instances of assets. */
export interface Asset {
  id: string;
  file: File;
  name: string;
  type: ClipType;
  duration: number; // seconds
  width?: number;
  height?: number;
  thumbnailUrl?: string;
  origin: "local" | "url";
  sourceUrl?: string;
  transcript?: TranscriptCue[];
}
