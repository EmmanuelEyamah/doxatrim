import type { FFmpeg, ProgressEvent } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import type { Clip } from "@/types/clip";

export interface TrimmedSegment {
  name: string;
  /** Real length of the produced segment (keyframe snapping can make it longer than requested). */
  duration: number;
}

function extensionOf(file: File): string {
  return file.name.split(".").pop()?.toLowerCase() || "mp4";
}

/**
 * Trims one clip to its [inPoint, outPoint] range via stream copy — fast and
 * the video stays untouched, at the cost of the head snapping to the previous
 * keyframe. The produced length is measured from ffmpeg's progress reports so
 * export timing can account for that.
 */
export async function trimClip(ffmpeg: FFmpeg, clip: Clip, index: number): Promise<TrimmedSegment> {
  const ext = extensionOf(clip.file);
  const inputName = `input-${index}.${ext}`;
  const outputName = `trimmed-${index}.${ext}`;
  const requested = clip.outPoint - clip.inPoint;

  await ffmpeg.writeFile(inputName, await fetchFile(clip.file));

  let lastTime = 0;
  const onProgress = ({ time }: ProgressEvent) => {
    if (Number.isFinite(time) && time > lastTime) lastTime = time;
  };
  ffmpeg.on("progress", onProgress);
  let exitCode: number;
  try {
    exitCode = await ffmpeg.exec([
      "-ss", clip.inPoint.toFixed(3),
      "-i", inputName,
      "-t", requested.toFixed(3),
      "-c", "copy",
      "-avoid_negative_ts", "make_zero",
      outputName,
    ]);
  } finally {
    ffmpeg.off("progress", onProgress);
  }

  await ffmpeg.deleteFile(inputName);

  if (exitCode !== 0) {
    throw new Error(`Failed to trim "${clip.file.name}" (ffmpeg exit code ${exitCode})`);
  }

  // ffmpeg.wasm reports `time` in microseconds; pick whichever interpretation
  // lands near the requested length in case a core build reports seconds, and
  // fall back to the requested length if nothing plausible was reported.
  const candidates = [lastTime / 1e6, lastTime].filter((v) => v > 0 && v < requested * 3 + 30);
  const duration =
    candidates.length > 0
      ? candidates.reduce((best, v) => (Math.abs(v - requested) < Math.abs(best - requested) ? v : best))
      : requested;

  return { name: outputName, duration };
}
