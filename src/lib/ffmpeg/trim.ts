import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import type { Clip } from "@/types/clip";

function extensionOf(file: File): string {
  return file.name.split(".").pop()?.toLowerCase() || "mp4";
}

/** Trims one clip to its [inPoint, outPoint] range via stream copy (fast, no re-encode). */
export async function trimClip(ffmpeg: FFmpeg, clip: Clip, index: number): Promise<string> {
  const ext = extensionOf(clip.file);
  const inputName = `input-${index}.${ext}`;
  const outputName = `trimmed-${index}.${ext}`;
  const duration = clip.outPoint - clip.inPoint;

  await ffmpeg.writeFile(inputName, await fetchFile(clip.file));

  const exitCode = await ffmpeg.exec([
    "-ss", clip.inPoint.toFixed(3),
    "-i", inputName,
    "-t", duration.toFixed(3),
    "-c", "copy",
    "-avoid_negative_ts", "make_zero",
    outputName,
  ]);

  await ffmpeg.deleteFile(inputName);

  if (exitCode !== 0) {
    throw new Error(`Failed to trim "${clip.file.name}" (ffmpeg exit code ${exitCode})`);
  }

  return outputName;
}
