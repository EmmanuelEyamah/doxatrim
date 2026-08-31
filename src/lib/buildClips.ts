import { getClipType, validateFiles } from "@/lib/fileValidation";
import { generateVideoThumbnail, readMediaDuration } from "@/lib/media";
import type { Clip } from "@/types/clip";

export interface BuildClipsResult {
  clips: Clip[];
  rejected: { file: File; reason: string }[];
}

/**
 * Validates files against the project's existing clips, then reads duration
 * and (for video) a thumbnail for each accepted file, producing ready-to-add
 * Clip objects. Shared by ImportZone (local files) and UrlImport (downloaded
 * files) so both go through identical validation and metadata extraction.
 */
export async function buildClipsFromFiles(
  files: File[],
  existingClips: Clip[]
): Promise<BuildClipsResult> {
  const { accepted, rejected } = validateFiles(files, existingClips);

  const clips = await Promise.all(
    accepted.map(async (file, i): Promise<Clip> => {
      const type = getClipType(file)!;
      const duration = await readMediaDuration(file, type);
      const thumbnailUrl = type === "video" ? await generateVideoThumbnail(file) : undefined;
      return {
        id: crypto.randomUUID(),
        file,
        type,
        originalDuration: duration,
        inPoint: 0,
        outPoint: duration,
        thumbnailUrl,
        order: existingClips.length + i,
      };
    })
  );

  return { clips, rejected };
}
