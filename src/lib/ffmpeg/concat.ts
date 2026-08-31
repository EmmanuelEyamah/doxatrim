import type { FFmpeg } from "@ffmpeg/ffmpeg";
import type { OutputFormat } from "@/types/project";

export function reencodeArgsFor(outputFormat: OutputFormat): string[] {
  switch (outputFormat) {
    case "mp4":
      return ["-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac"];
    case "wav":
      return ["-c:a", "pcm_s16le"];
    case "mp3":
      return ["-c:a", "libmp3lame"];
  }
}

/**
 * Concatenates trimmed segments in order. Tries stream copy first (fast, requires
 * matching codecs); falls back to re-encoding if the segments don't match.
 *
 * Leaves the output file in ffmpeg's virtual FS (and cleans up only the segment
 * inputs) rather than reading/deleting it — callers that need to chain further
 * processing (e.g. background audio mixing) can reference it by name; callers
 * that don't should use `readAndCleanup`.
 */
export async function concatClips(
  ffmpeg: FFmpeg,
  segmentNames: string[],
  outputFormat: OutputFormat
): Promise<string> {
  const listContent = segmentNames.map((name) => `file '${name}'`).join("\n");
  await ffmpeg.writeFile("concat-list.txt", listContent);

  const outputName = `concat-output.${outputFormat}`;
  const baseArgs = ["-f", "concat", "-safe", "0", "-i", "concat-list.txt"];

  let exitCode = await ffmpeg.exec([...baseArgs, "-c", "copy", outputName]);

  if (exitCode !== 0) {
    exitCode = await ffmpeg.exec([...baseArgs, ...reencodeArgsFor(outputFormat), outputName]);
  }

  if (exitCode !== 0) {
    throw new Error(`Failed to combine clips (ffmpeg exit code ${exitCode})`);
  }

  await ffmpeg.deleteFile("concat-list.txt");
  await Promise.all(segmentNames.map((name) => ffmpeg.deleteFile(name)));

  return outputName;
}

/**
 * Reads a file out of ffmpeg's virtual FS, deletes it, and returns a plain
 * ArrayBuffer-backed copy (ffmpeg's wasm memory may be backed by a
 * SharedArrayBuffer under cross-origin isolation, which Blob() rejects).
 */
export async function readAndCleanup(ffmpeg: FFmpeg, name: string): Promise<Uint8Array<ArrayBuffer>> {
  const data = await ffmpeg.readFile(name);
  await ffmpeg.deleteFile(name);
  return (data as Uint8Array).slice();
}
