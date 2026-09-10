import type { FFmpeg } from "@ffmpeg/ffmpeg";
import type { Clip } from "@/types/clip";
import { getFFmpeg } from "@/lib/ffmpeg/instance";
import { buildSmoothArgs } from "@/lib/ffmpeg/mixArgs";
import { prepareAudioPieces } from "@/lib/ffmpeg/smooth";
import { readAndCleanup } from "@/lib/ffmpeg/concat";
import { clipEnd, computeEdl } from "@/lib/timeline";
import { useAudioLayerStore } from "@/stores/useAudioLayerStore";
import { useClipStore } from "@/stores/useClipStore";

export interface BounceOptions {
  /** Remove the source video clips once the audio layer exists. */
  removeClips: boolean;
}

export interface RenderedAudio {
  data: Uint8Array<ArrayBuffer>;
  /** Timeline position of the first selected clip — where the layer goes. */
  start: number;
  /** Length of the rendered audio in timeline seconds. */
  length: number;
}

function baseName(filename: string): string {
  return filename.replace(/\.[^./]+$/, "");
}

/**
 * Renders a set of clips — with their cuts, stacking, gaps and the
 * smooth-joins crossfade — into one AAC audio file. Pure ffmpeg work, no
 * store access, so it can be verified natively.
 */
export async function renderClipsToAudio(ffmpeg: FFmpeg, clips: Clip[], crossfade: number): Promise<RenderedAudio> {
  if (clips.length === 0) throw new Error("Select at least one clip");
  const start = Math.min(...clips.map((c) => c.startAt));
  const end = Math.max(...clips.map(clipEnd));
  // Work in a local timeline that begins at the selection's start.
  const local = clips.map((c) => ({ ...c, startAt: c.startAt - start }));
  const segments = computeEdl(local);
  const measured = segments.map((s) => s.end - s.start);

  const pieces = await prepareAudioPieces(ffmpeg, { segments, measured, clips: local, crossfade, prefix: "bounce" });
  const outputName = "bounce-output.m4a";
  const code = await ffmpeg.exec(
    buildSmoothArgs({ audioInputs: pieces.inputs, videoInputName: null, outputFormat: "m4a", outputName })
  );
  await pieces.cleanup();
  if (code !== 0) throw new Error(`Failed to render audio (ffmpeg exit code ${code})`);

  return { data: await readAndCleanup(ffmpeg, outputName), start, length: end - start };
}

/**
 * Converts the selected clips into one audio layer placed at the same
 * position on the timeline. From there it can be repeated or looped like any
 * other layer while the video stays exactly as it was. Returns the layer id.
 */
export async function bounceClipsToAudioLayer(clipIds: string[], opts: BounceOptions): Promise<string> {
  const clipStore = useClipStore.getState();
  const clips = clipStore.clips.filter((c) => clipIds.includes(c.id));
  const rendered = await renderClipsToAudio(await getFFmpeg(), clips, clipStore.joinCrossfade);

  const name = `${baseName(clips[0].file.name)}${clips.length > 1 ? ` +${clips.length - 1}` : ""} (audio).m4a`;
  const file = new File([rendered.data], name, { type: "audio/mp4" });

  const layerStore = useAudioLayerStore.getState();
  const layer = layerStore.addLayer(file, rendered.length, name);
  layerStore.updateLayer(layer.id, { startAt: rendered.start, volume: 1 });
  if (opts.removeClips) clipStore.removeClips(clipIds);
  return layer.id;
}
