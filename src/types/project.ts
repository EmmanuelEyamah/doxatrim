import type { Clip } from "@/types/clip";

export type OutputFormat = "mp4" | "mp3" | "wav";

export interface Project {
  clips: Clip[];
  outputFormat: OutputFormat;
}
