import type { ClipType } from "@/types/clip";

export const VIDEO_EXTENSIONS = ["mp4", "mov", "webm"];
export const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a"];
export const ACCEPT_MEDIA = [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS].map((e) => `.${e}`).join(",");

export function getExtension(file: File): string {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}

export function getClipType(file: File): ClipType | null {
  const ext = getExtension(file);
  if (VIDEO_EXTENSIONS.includes(ext)) return "video";
  if (AUDIO_EXTENSIONS.includes(ext)) return "audio";
  return null;
}

/**
 * v1 rule: the main sequence is either all video or all audio-only clips.
 * Returns a rejection reason, or null if the type fits the project.
 */
export function timelineTypeConflict(projectType: ClipType | null, type: ClipType): string | null {
  if (projectType && type !== projectType) {
    return `Can't mix video and audio-only clips in one sequence (project is ${projectType})`;
  }
  return null;
}
