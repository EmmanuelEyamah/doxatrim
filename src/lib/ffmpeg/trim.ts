import type { FFmpeg, ProgressEvent } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import type { OutputFormat } from "@/types/project";

export interface TrimmedSegment {
  name: string;
  /** Real length of the produced segment (keyframe snapping can make it longer than requested). */
  duration: number;
}

function extensionOf(file: File): string {
  return file.name.split(".").pop()?.toLowerCase() || "mp4";
}

function pickMeasured(lastTime: number, requested: number): number {
  // ffmpeg.wasm reports `time` in microseconds; pick whichever interpretation
  // lands near the requested length in case a core build reports seconds, and
  // fall back to the requested length if nothing plausible was reported.
  const candidates = [lastTime / 1e6, lastTime].filter((v) => v > 0 && v < requested * 3 + 30);
  return candidates.length > 0
    ? candidates.reduce((best, v) => (Math.abs(v - requested) < Math.abs(best - requested) ? v : best))
    : requested;
}

async function execMeasured(ffmpeg: FFmpeg, args: string[], requested: number): Promise<{ exitCode: number; duration: number }> {
  let lastTime = 0;
  const onProgress = ({ time }: ProgressEvent) => {
    if (Number.isFinite(time) && time > lastTime) lastTime = time;
  };
  ffmpeg.on("progress", onProgress);
  try {
    const exitCode = await ffmpeg.exec(args);
    return { exitCode, duration: pickMeasured(lastTime, requested) };
  } finally {
    ffmpeg.off("progress", onProgress);
  }
}

/**
 * Cuts [srcIn, srcOut] out of a source file via stream copy — fast and the
 * video stays untouched, at the cost of the head snapping to the previous
 * keyframe. The produced length is measured from ffmpeg's progress reports so
 * export timing can account for that.
 */
export async function trimSegment(
  ffmpeg: FFmpeg,
  file: File,
  srcIn: number,
  srcOut: number,
  index: number
): Promise<TrimmedSegment> {
  const ext = extensionOf(file);
  const inputName = `input-${index}.${ext}`;
  const outputName = `seg-${index}.${ext}`;
  const requested = srcOut - srcIn;

  await ffmpeg.writeFile(inputName, await fetchFile(file));
  const { exitCode, duration } = await execMeasured(
    ffmpeg,
    [
      "-y",
      "-ss", srcIn.toFixed(3),
      "-i", inputName,
      "-t", requested.toFixed(3),
      "-c", "copy",
      "-avoid_negative_ts", "make_zero",
      outputName,
    ],
    requested
  );
  await ffmpeg.deleteFile(inputName);

  if (exitCode !== 0) {
    throw new Error(`Failed to cut "${file.name}" (ffmpeg exit code ${exitCode})`);
  }
  return { name: outputName, duration };
}

export interface GapSpec {
  duration: number;
  /** Output container/format the gap must match. */
  format: OutputFormat;
  width: number;
  height: number;
}

/** Generates black + silence to fill empty timeline between placed clips. */
export async function makeGapSegment(ffmpeg: FFmpeg, index: number, spec: GapSpec): Promise<TrimmedSegment> {
  const d = spec.duration.toFixed(3);
  const outputName = `gap-${index}.${spec.format}`;
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

  const args =
    spec.format === "mp4"
      ? [
          "-y",
          "-f", "lavfi", "-t", d, "-i", `color=c=black:s=${even(spec.width)}x${even(spec.height)}:r=30`,
          "-f", "lavfi", "-t", d, "-i", "anullsrc=r=48000:cl=stereo",
          "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-shortest",
          outputName,
        ]
      : [
          "-y",
          "-f", "lavfi", "-t", d, "-i", "anullsrc=r=48000:cl=stereo",
          ...(spec.format === "wav" ? ["-c:a", "pcm_s16le"] : ["-c:a", "libmp3lame"]),
          outputName,
        ];

  const exitCode = await ffmpeg.exec(args);
  if (exitCode !== 0) throw new Error(`Failed to generate a ${d}s gap (ffmpeg exit code ${exitCode})`);
  return { name: outputName, duration: spec.duration };
}
