import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import type { AudioLayer } from "@/types/audioLayer";
import type { OutputFormat } from "@/types/project";
import { isLayerActive, layerSpan } from "@/lib/timeline";
import { buildMixArgs, buildPreTrimArgs, type MixLayerSpec } from "@/lib/ffmpeg/mixArgs";

export interface MixAudioLayersOptions {
  mainInputName: string;
  layers: AudioLayer[];
  mainVolume: number;
  timelineEnd: number;
  outputFormat: OutputFormat;
  dropVideo: boolean;
}

function extensionOf(file: File): string {
  return file.name.split(".").pop()?.toLowerCase() || "mp3";
}

/**
 * Mixes every active audio layer (delayed to its start point, trimmed, looped
 * if asked, at its own volume) under the main output's audio. Video is stream-
 * copied, never re-encoded. Deletes `mainInputName` when done; returns the
 * mixed output's name (still in ffmpeg's FS — read with `readAndCleanup`).
 */
export async function mixAudioLayers(ffmpeg: FFmpeg, opts: MixAudioLayersOptions): Promise<string> {
  const active = opts.layers.filter((l) => isLayerActive(l, opts.timelineEnd));
  const specs: MixLayerSpec[] = [];
  const tempFiles: string[] = [];

  for (let i = 0; i < active.length; i++) {
    const layer = active[i];
    const srcName = `layer-src-${i}.${extensionOf(layer.file)}`;
    await ffmpeg.writeFile(srcName, await fetchFile(layer.file));

    // Stream copy into Matroska (holds any audio codec); re-encode only if that fails.
    let segmentName = `layer-${i}.mka`;
    let exitCode = await ffmpeg.exec(
      buildPreTrimArgs({
        inputName: srcName,
        inPoint: layer.inPoint,
        outPoint: layer.outPoint,
        outputName: segmentName,
        reencode: false,
      })
    );
    if (exitCode !== 0) {
      segmentName = `layer-${i}.m4a`;
      exitCode = await ffmpeg.exec(
        buildPreTrimArgs({
          inputName: srcName,
          inPoint: layer.inPoint,
          outPoint: layer.outPoint,
          outputName: segmentName,
          reencode: true,
        })
      );
    }
    await ffmpeg.deleteFile(srcName);
    if (exitCode !== 0) {
      await Promise.all(tempFiles.map((f) => ffmpeg.deleteFile(f).catch(() => {})));
      throw new Error(`Failed to prepare audio layer "${layer.name}" (ffmpeg exit code ${exitCode})`);
    }

    tempFiles.push(segmentName);
    specs.push({
      inputName: segmentName,
      loop: layer.loop,
      span: layerSpan(layer, opts.timelineEnd),
      startAt: layer.startAt,
      volume: layer.volume,
    });
  }

  const outputName = `mixed-output.${opts.outputFormat}`;
  const base = {
    mainInputName: opts.mainInputName,
    layers: specs,
    mainVolume: opts.mainVolume,
    timelineEnd: opts.timelineEnd,
    outputFormat: opts.outputFormat,
    outputName,
    dropVideo: opts.dropVideo,
  };

  let exitCode = await ffmpeg.exec(buildMixArgs({ ...base, silentMain: false }));
  if (exitCode !== 0) {
    // Main clip has no audio stream (screen recordings, some downloads) — mix
    // over a generated silent base instead.
    exitCode = await ffmpeg.exec(buildMixArgs({ ...base, silentMain: true }));
  }

  await Promise.all(tempFiles.map((f) => ffmpeg.deleteFile(f).catch(() => {})));
  if (exitCode !== 0) {
    throw new Error(`Failed to mix audio (ffmpeg exit code ${exitCode})`);
  }

  await ffmpeg.deleteFile(opts.mainInputName);
  return outputName;
}
