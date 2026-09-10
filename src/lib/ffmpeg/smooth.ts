import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import type { Clip } from "@/types/clip";
import type { EdlSegment } from "@/lib/timeline";
import { buildPreTrimArgs, buildSmoothArgs, type CrossfadeInput, type MixOutputFormat } from "@/lib/ffmpeg/mixArgs";

export interface AudioPiecesOptions {
  segments: EdlSegment[];
  /** Real length of each segment (see trimSegment) — audio is cut to match. */
  measured: number[];
  clips: Clip[];
  /** Crossfade length in seconds; half is taken from each side of a cut. 0 = hard cuts. */
  crossfade: number;
  /** Unique file-name prefix inside ffmpeg's FS. */
  prefix: string;
}

export interface AudioPieces {
  inputs: CrossfadeInput[];
  cleanup: () => Promise<void>;
}

function extensionOf(file: File): string {
  return file.name.split(".").pop()?.toLowerCase() || "mp4";
}

/**
 * Cuts the audio of every EDL segment (silence for gaps), with handle media on
 * each side of a clip→clip join so the pieces can be crossfaded without
 * changing the total length.
 */
export async function prepareAudioPieces(ffmpeg: FFmpeg, o: AudioPiecesOptions): Promise<AudioPieces> {
  const half = o.crossfade / 2;
  const temp: string[] = [];
  const sources = new Map<File, string>();
  const inputs: CrossfadeInput[] = [];
  const lengths: number[] = [];

  const sourceName = async (file: File) => {
    let name = sources.get(file);
    if (!name) {
      name = `${o.prefix}-src-${sources.size}.${extensionOf(file)}`;
      await ffmpeg.writeFile(name, await fetchFile(file));
      sources.set(file, name);
    }
    return name;
  };

  const handles = o.segments.map((seg, k) => {
    if (!seg.clipId) return { hIn: 0, hOut: 0, cutStart: 0, cutEnd: 0 };
    const clip = o.clips.find((c) => c.id === seg.clipId)!;
    const ideal = seg.end - seg.start;
    const head = Math.max(0, (o.measured[k] ?? ideal) - ideal);
    const cutStart = Math.max(0, seg.srcIn - head);
    const cutEnd = seg.srcIn + ideal;
    const prevIsClip = k > 0 && !!o.segments[k - 1].clipId;
    const nextIsClip = k < o.segments.length - 1 && !!o.segments[k + 1].clipId;
    return {
      hIn: prevIsClip ? Math.min(half, cutStart) : 0,
      hOut: nextIsClip ? Math.min(half, Math.max(0, clip.originalDuration - cutEnd)) : 0,
      cutStart,
      cutEnd,
    };
  });

  for (let k = 0; k < o.segments.length; k++) {
    const seg = o.segments[k];
    const ideal = seg.end - seg.start;
    const measured = o.measured[k] ?? ideal;
    const h = handles[k];

    if (!seg.clipId) {
      const name = `${o.prefix}-gap-${k}.m4a`;
      const code = await ffmpeg.exec(["-y", "-f", "lavfi", "-t", measured.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo", "-c:a", "aac", name]);
      if (code !== 0) throw new Error(`Failed to generate silence for a gap (ffmpeg exit code ${code})`);
      temp.push(name);
      inputs.push({ name, overlapWithNext: 0 });
      lengths.push(measured);
      continue;
    }

    const clip = o.clips.find((c) => c.id === seg.clipId)!;
    const src = await sourceName(clip.file);
    const from = h.cutStart - h.hIn;
    const to = h.cutEnd + h.hOut;
    let name = `${o.prefix}-${k}.mka`;
    let code = await ffmpeg.exec(buildPreTrimArgs({ inputName: src, inPoint: from, outPoint: to, outputName: name, reencode: false }));
    if (code !== 0) {
      name = `${o.prefix}-${k}.m4a`;
      code = await ffmpeg.exec(buildPreTrimArgs({ inputName: src, inPoint: from, outPoint: to, outputName: name, reencode: true }));
    }
    if (code !== 0) throw new Error(`Failed to cut audio for "${clip.file.name}" (ffmpeg exit code ${code})`);
    temp.push(name);
    inputs.push({ name, overlapWithNext: 0 });
    lengths.push(to - from);
  }

  // Overlap at each join = this piece's tail handle + the next piece's head
  // handle, capped so it never exceeds either piece.
  for (let k = 0; k < inputs.length - 1; k++) {
    const d = handles[k].hOut + handles[k + 1].hIn;
    const cap = Math.min(lengths[k], lengths[k + 1]) - 0.02;
    inputs[k].overlapWithNext = d > 0.01 && cap > 0.01 ? Math.min(d, cap) : 0;
  }

  return {
    inputs,
    cleanup: async () => {
      await Promise.all([...temp, ...sources.values()].map((f) => ffmpeg.deleteFile(f).catch(() => {})));
    },
  };
}

export interface SmoothJoinsOptions {
  segments: EdlSegment[];
  measured: number[];
  clips: Clip[];
  /** The joined output whose audio gets replaced (video copied through unless `audioOnly`). */
  concatOutputName: string;
  crossfade: number;
  outputFormat: MixOutputFormat;
  /** True for audio-only projects: the smoothed audio is the whole result. */
  audioOnly: boolean;
}

/**
 * Replaces the hard audio cuts of a joined sequence with crossfades built
 * from handle media, so joins stop clicking/jumping while every piece keeps
 * its exact length and the video is never touched. Returns the new output.
 */
export async function smoothJoins(ffmpeg: FFmpeg, o: SmoothJoinsOptions): Promise<string> {
  const pieces = await prepareAudioPieces(ffmpeg, {
    segments: o.segments,
    measured: o.measured,
    clips: o.clips,
    crossfade: o.crossfade,
    prefix: "smooth",
  });
  const outputName = `smoothed-output.${o.outputFormat}`;
  const code = await ffmpeg.exec(
    buildSmoothArgs({
      audioInputs: pieces.inputs,
      videoInputName: o.audioOnly ? null : o.concatOutputName,
      outputFormat: o.outputFormat,
      outputName,
    })
  );
  await pieces.cleanup();
  if (code !== 0) throw new Error(`Failed to smooth joins (ffmpeg exit code ${code})`);
  await ffmpeg.deleteFile(o.concatOutputName);
  return outputName;
}
