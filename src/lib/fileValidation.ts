import type { Clip, ClipType } from "@/types/clip";

const VIDEO_EXTENSIONS = ["mp4", "mov", "webm"];
const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a"];

export interface ValidationResult {
  accepted: File[];
  rejected: { file: File; reason: string }[];
}

function getExtension(file: File): string {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}

export function getClipType(file: File): ClipType | null {
  const ext = getExtension(file);
  if (VIDEO_EXTENSIONS.includes(ext)) return "video";
  if (AUDIO_EXTENSIONS.includes(ext)) return "audio";
  return null;
}

/**
 * Validates incoming files against supported extensions and the v1 rule that
 * video and audio-only clips can't coexist in the same project.
 */
export function validateFiles(files: File[], existingClips: Clip[]): ValidationResult {
  const accepted: File[] = [];
  const rejected: ValidationResult["rejected"] = [];

  const projectType: ClipType | null =
    existingClips[0]?.type ?? null;
  let pendingType = projectType;

  for (const file of files) {
    const type = getClipType(file);

    if (!type) {
      rejected.push({
        file,
        reason: `Unsupported file type (.${getExtension(file) || "unknown"})`,
      });
      continue;
    }

    if (pendingType && type !== pendingType) {
      rejected.push({
        file,
        reason: `Can't mix video and audio-only clips in one project (project is ${pendingType})`,
      });
      continue;
    }

    pendingType = type;
    accepted.push(file);
  }

  return { accepted, rejected };
}
