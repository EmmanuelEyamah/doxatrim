import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import type { OutputFormat } from "@/types/project";

function audioCodecArgsFor(outputFormat: OutputFormat): string[] {
  switch (outputFormat) {
    case "mp4":
      return ["-c:a", "aac"];
    case "wav":
      return ["-c:a", "pcm_s16le"];
    case "mp3":
      return ["-c:a", "libmp3lame"];
  }
}

interface MixBackgroundAudioOptions {
  mainInputName: string;
  backgroundFile: File;
  bgInPoint: number;
  bgOutPoint: number;
  mainVolume: number; // 0-1
  bgVolume: number; // 0-1
  mainDuration: number; // seconds — background loops/pads to match this
  outputFormat: OutputFormat;
}

/**
 * Mixes a looped, trimmed background audio track under the main output's audio,
 * at independent volumes. Deletes `mainInputName` once done; returns the name
 * of the new mixed output (still in ffmpeg's virtual FS — read with
 * `readAndCleanup`).
 */
export async function mixBackgroundAudio(
  ffmpeg: FFmpeg,
  opts: MixBackgroundAudioOptions
): Promise<string> {
  const ext = opts.backgroundFile.name.split(".").pop()?.toLowerCase() || "mp3";
  const bgInputName = `bg-input.${ext}`;
  const bgTrimmedName = `bg-trimmed.${ext}`;
  const outputName = `mixed-output.${opts.outputFormat}`;

  await ffmpeg.writeFile(bgInputName, await fetchFile(opts.backgroundFile));

  const bgDuration = opts.bgOutPoint - opts.bgInPoint;
  let exitCode = await ffmpeg.exec([
    "-ss", opts.bgInPoint.toFixed(3),
    "-i", bgInputName,
    "-t", bgDuration.toFixed(3),
    "-c", "copy",
    bgTrimmedName,
  ]);
  if (exitCode !== 0) {
    throw new Error(`Failed to trim background audio (ffmpeg exit code ${exitCode})`);
  }
  await ffmpeg.deleteFile(bgInputName);

  exitCode = await ffmpeg.exec([
    "-i", opts.mainInputName,
    "-stream_loop", "-1",
    "-i", bgTrimmedName,
    "-filter_complex",
    `[0:a]volume=${opts.mainVolume}[a0];[1:a]volume=${opts.bgVolume}[a1];` +
      `[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[aout]`,
    "-map", "0:v?",
    "-map", "[aout]",
    "-c:v", "copy",
    ...audioCodecArgsFor(opts.outputFormat),
    "-t", opts.mainDuration.toFixed(3),
    outputName,
  ]);
  if (exitCode !== 0) {
    throw new Error(`Failed to mix background audio (ffmpeg exit code ${exitCode})`);
  }

  await ffmpeg.deleteFile(bgTrimmedName);
  await ffmpeg.deleteFile(opts.mainInputName);

  return outputName;
}
