// Pure ffmpeg argument builders — no runtime imports, so the exact argument
// lists the app sends to ffmpeg.wasm can also be executed against a native
// ffmpeg in a Node script to verify the filter graph and timing math.

export type MixOutputFormat = "mp4" | "mp3" | "wav";

export function audioCodecArgsFor(outputFormat: MixOutputFormat): string[] {
  switch (outputFormat) {
    case "mp4":
      return ["-c:a", "aac"];
    case "wav":
      return ["-c:a", "pcm_s16le"];
    case "mp3":
      return ["-c:a", "libmp3lame"];
  }
}

export interface PreTrimArgsOptions {
  inputName: string;
  inPoint: number;
  outPoint: number;
  outputName: string;
  reencode: boolean; // false = stream copy into a Matroska audio container
}

/**
 * Cuts a layer's source down to its audio-only [inPoint, outPoint] segment.
 *
 * `-ss` goes AFTER `-i` on purpose: as an input option combined with stream
 * copy, ffmpeg seeks the container by its video keyframes (even though we
 * drop video), lands early, and then counts `-t` from the requested point —
 * a 1s→4s cut of a video source came out as 0s→4s. Output-side seeking drops
 * audio packets exactly at the cut (AAC/MP3 frames are independently
 * decodable), so the segment is accurate to one audio frame, still with no
 * re-encode.
 */
export function buildPreTrimArgs(o: PreTrimArgsOptions): string[] {
  return [
    "-y",
    "-i", o.inputName,
    "-ss", o.inPoint.toFixed(3),
    "-t", (o.outPoint - o.inPoint).toFixed(3),
    "-vn",
    ...(o.reencode ? ["-c:a", "aac"] : ["-c:a", "copy"]),
    o.outputName,
  ];
}

export interface MixLayerSpec {
  inputName: string; // pre-trimmed audio segment already in ffmpeg's FS
  loop: boolean;
  span: number; // seconds occupied on the timeline
  startAt: number; // seconds
  volume: number; // 0..1
}

export interface BuildMixArgsOptions {
  mainInputName: string;
  layers: MixLayerSpec[]; // active layers only
  mainVolume: number;
  timelineEnd: number;
  outputFormat: MixOutputFormat;
  outputName: string;
  dropVideo: boolean;
  /** Use a generated silent track as the base instead of the main input's audio (main has no audio stream). */
  silentMain: boolean;
}

export function buildMixArgs(o: BuildMixArgsOptions): string[] {
  const inputs: string[] = ["-i", o.mainInputName];
  for (const layer of o.layers) {
    if (layer.loop) inputs.push("-stream_loop", "-1");
    inputs.push("-i", layer.inputName);
  }
  const silentIndex = 1 + o.layers.length;
  if (o.silentMain) {
    inputs.push("-f", "lavfi", "-t", o.timelineEnd.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo");
  }

  const baseSource = o.silentMain ? `[${silentIndex}:a]` : "[0:a]";
  const filters: string[] = [];

  if (o.layers.length === 0) {
    filters.push(`${baseSource}volume=${o.mainVolume}[aout]`);
  } else {
    filters.push(`${baseSource}volume=${o.mainVolume}[l0]`);
    o.layers.forEach((layer, i) => {
      const idx = i + 1;
      filters.push(
        `[${idx}:a]atrim=duration=${layer.span.toFixed(3)},asetpts=PTS-STARTPTS,` +
          `adelay=${Math.round(layer.startAt * 1000)}:all=1,volume=${layer.volume}[l${idx}]`
      );
    });
    const labels = o.layers.map((_, i) => `[l${i + 1}]`).join("");
    // normalize=0: amix's default divides every input by N, which would make
    // the per-layer volume sliders lie. duration=first: main audio defines length.
    filters.push(
      `[l0]${labels}amix=inputs=${o.layers.length + 1}:duration=first:normalize=0:dropout_transition=0[aout]`
    );
  }

  const output: string[] = ["-filter_complex", filters.join(";")];
  if (o.dropVideo) {
    output.push("-vn");
  } else {
    output.push("-map", "0:v?", "-c:v", "copy");
  }
  output.push("-map", "[aout]", ...audioCodecArgsFor(o.outputFormat), "-t", o.timelineEnd.toFixed(3), o.outputName);

  return ["-y", ...inputs, ...output];
}
