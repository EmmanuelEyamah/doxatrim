import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  AudioLines,
  AudioWaveform,
  Copy,
  Download,
  FileText,
  Layers,
  Repeat,
  Scissors,
  SlidersHorizontal,
  Trash2,
  Video,
  Volume2,
  VolumeX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTime, parseTime } from "@/lib/formatTime";
import { downloadFile } from "@/lib/download";
import { getClipType } from "@/lib/fileValidation";
import { clipEnd, clipLength, layerSpan, projectEnd, timelineToClipLocal, trackCount } from "@/lib/timeline";
import { bounceClipsToAudioLayer } from "@/lib/bounce";
import toast from "react-hot-toast";
import { EMPTY_SELECTION, only, selectionCount, singleItem, type Selection } from "@/lib/selection";
import { removeSelection, repeatSelection, selectionSpan } from "@/lib/groupOps";
import { useAudioLayerStore } from "@/stores/useAudioLayerStore";
import { useClipStore } from "@/stores/useClipStore";
import type { SequencePlayer } from "@/hooks/useSequencePlayer";
import { MediaPlayer } from "@/components/MediaPlayer";
import { Switch } from "@/components/Switch";
import { TrimEditor } from "@/components/TrimEditor";
import { LANE_COLORS } from "@/components/timeline/LayerBlock";
import type { AudioLayer } from "@/types/audioLayer";
import type { Clip } from "@/types/clip";

interface InspectorProps {
  selection: Selection;
  player: SequencePlayer;
  onSelect: (selection: Selection) => void;
  onOpenTranscript: () => void;
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="border-b border-sidebar-border px-3 py-3">
    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
    <div className="flex flex-col gap-2">{children}</div>
  </div>
);

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid grid-cols-[4.5rem_1fr] items-center gap-2 text-xs">
    <span className="text-muted-foreground">{label}</span>
    <div className="flex min-w-0 items-center gap-2">{children}</div>
  </div>
);

const Readout = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between text-xs">
    <span className="text-muted-foreground">{label}</span>
    <span className="font-mono">{value}</span>
  </div>
);

const fieldClass = "h-7 w-24 rounded-md border border-border bg-background px-2 font-mono text-xs outline-none focus:border-primary";
const chipClass =
  "flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40";
const iconChip = "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground";

const TimeField = ({ value, placeholder, onCommit }: { value: number | null; placeholder?: string; onCommit: (v: number | null) => void }) => (
  <input
    key={value ?? "none"}
    type="text"
    placeholder={placeholder}
    defaultValue={value == null ? "" : formatTime(value)}
    onBlur={(e) => {
      const raw = e.target.value.trim();
      if (raw === "" && placeholder) {
        onCommit(null);
        return;
      }
      const parsed = parseTime(raw);
      if (parsed !== null) onCommit(parsed);
      else e.target.value = value == null ? "" : formatTime(value);
    }}
    className={fieldClass}
  />
);

const ConvertToAudio = ({ clipIds, onSelect }: { clipIds: string[]; onSelect: (s: Selection) => void }) => {
  const [removeClips, setRemoveClips] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const id = toast.loading("Rendering audio…");
    try {
      const layerId = await bounceClipsToAudioLayer(clipIds, { removeClips });
      toast.success("Audio layer created — repeat or loop it from its lane", { id });
      onSelect(only("layer", layerId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not convert to audio", { id });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Convert">
      <p className="text-[11px] text-muted-foreground">
        Render {clipIds.length > 1 ? "these clips" : "this clip"} — cuts, stacking and smooth joins included — into one
        audio file placed on the timeline as a layer. Repeat or loop that as audio without the video getting longer.
      </p>
      <Row label="Then">
        <Switch checked={removeClips} onChange={setRemoveClips} label="Remove the video clips afterwards" />
        <span className="text-muted-foreground">remove the video clip{clipIds.length > 1 ? "s" : ""}</span>
      </Row>
      <button type="button" disabled={busy} onClick={() => void run()} className={cn(chipClass, "w-fit")}>
        <AudioWaveform size={12} /> {busy ? "Rendering…" : "Convert to audio layer"}
      </button>
    </Section>
  );
};

const RepeatRow = ({ onRepeat }: { onRepeat: (count: number) => void }) => {
  const [count, setCount] = useState(2);
  return (
    <Row label="Repeat">
      <input
        type="number"
        min={1}
        max={500}
        value={count}
        onChange={(e) => setCount(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
        className={cn(fieldClass, "w-16")}
      />
      <button type="button" onClick={() => onRepeat(count)} className={chipClass}>
        <Repeat size={12} /> ×{count}
      </button>
    </Row>
  );
};

const ClipInspector = ({
  clip,
  player,
  onSelect,
  onOpenTranscript,
}: {
  clip: Clip;
  player: SequencePlayer;
  onSelect: (s: Selection) => void;
  onOpenTranscript: () => void;
}) => {
  const clips = useClipStore((s) => s.clips);
  const updateTrim = useClipStore((s) => s.updateTrim);
  const updateClip = useClipStore((s) => s.updateClip);
  const splitClip = useClipStore((s) => s.splitClip);
  const duplicateClip = useClipStore((s) => s.duplicateClip);
  const addLayer = useAudioLayerStore((s) => s.addLayer);

  const hit = timelineToClipLocal(clips, player.timelineTime);
  const canSplit = hit?.clipId === clip.id && hit.localTime > clip.inPoint + 0.05 && hit.localTime < clip.outPoint - 0.05;
  const tracks = trackCount(clips);

  return (
    <>
      <Section title="Clip">
        <p className="truncate text-xs" title={clip.file.name}>
          {clip.file.name}
        </p>
        <Readout label="Type" value={clip.type} />
        <Readout label="Source" value={formatTime(clip.originalDuration)} />
        <Readout label="Length" value={formatTime(clipLength(clip))} />
      </Section>

      <Section title="Placement">
        <Row label="Start">
          <TimeField value={clip.startAt} onCommit={(v) => v != null && updateClip(clip.id, { startAt: Math.max(0, v) })} />
          <button type="button" onClick={() => updateClip(clip.id, { startAt: player.timelineTime })} className={chipClass}>
            Start here
          </button>
        </Row>
        <Row label="Track">
          <select
            value={clip.track}
            onChange={(e) => updateClip(clip.id, { track: Number(e.target.value) })}
            className={cn(fieldClass, "w-20")}
          >
            {Array.from({ length: tracks + 1 }, (_, t) => (
              <option key={t} value={t}>
                V{t + 1}{t === tracks ? " (new)" : ""}
              </option>
            ))}
          </select>
          <span className="text-muted-foreground">higher tracks play on top</span>
        </Row>
        <Readout label="Ends" value={formatTime(clipEnd(clip))} />
      </Section>

      <Section title="Trim">
        <TrimEditor
          bare
          duration={clip.originalDuration}
          inPoint={clip.inPoint}
          outPoint={clip.outPoint}
          onTrimChange={(inPoint, outPoint) => updateTrim(clip.id, inPoint, outPoint)}
          getPlayheadTime={() => player.localTimeFor(clip.id)}
          constrainPlayback={false}
        />
        <p className="text-[10px] text-muted-foreground">
          <kbd className="rounded border border-border px-1">I</kbd> / <kbd className="rounded border border-border px-1">O</kbd> mark in/out at the playhead ·{" "}
          <kbd className="rounded border border-border px-1">S</kbd> splits
        </p>
      </Section>

      <Section title="Edit">
        <div className="flex flex-wrap gap-1.5">
          <button type="button" disabled={!canSplit} onClick={() => hit && splitClip(clip.id, hit.localTime)} className={chipClass} title="Cut this clip in two at the playhead">
            <Scissors size={12} /> Split at playhead
          </button>
          <button type="button" onClick={() => duplicateClip(clip.id)} className={chipClass}>
            <Copy size={12} /> Duplicate
          </button>
        </div>
        <RepeatRow onRepeat={(n) => duplicateClip(clip.id, n)} />
      </Section>

      <ConvertToAudio clipIds={[clip.id]} onSelect={onSelect} />

      <Section title="Actions">
        <div className="flex flex-wrap gap-1.5">
          {clip.transcript && clip.transcript.length > 0 && (
            <button type="button" onClick={onOpenTranscript} className={chipClass}>
              <FileText size={12} /> Transcript
            </button>
          )}
          <button type="button" onClick={() => onSelect(only("layer", addLayer(clip.file, clip.originalDuration).id))} className={chipClass}>
            <AudioLines size={12} /> Use as audio layer
          </button>
          <button type="button" onClick={() => downloadFile(clip.file, clip.file.name)} className={chipClass}>
            <Download size={12} /> Save source
          </button>
          <button
            type="button"
            onClick={() => {
              removeSelection(only("clip", clip.id));
              onSelect(EMPTY_SELECTION);
            }}
            className={cn(chipClass, "hover:text-destructive")}
          >
            <Trash2 size={12} /> Remove
          </button>
        </div>
      </Section>
    </>
  );
};

const LayerInspector = ({ layer, player }: { layer: AudioLayer; player: SequencePlayer }) => {
  const clips = useClipStore((s) => s.clips);
  const updateLayer = useAudioLayerStore((s) => s.updateLayer);
  const removeLayer = useAudioLayerStore((s) => s.removeLayer);
  const splitLayer = useAudioLayerStore((s) => s.splitLayer);
  const duplicateLayer = useAudioLayerStore((s) => s.duplicateLayer);
  const [src, setSrc] = useState<string | null>(null);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);

  // Create and revoke in the same effect so a StrictMode re-run regenerates a valid URL.
  useEffect(() => {
    const url = URL.createObjectURL(layer.file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [layer.file]);

  const layers = useAudioLayerStore((s) => s.layers);
  const end = projectEnd(clips, layers);
  const span = layerSpan(layer, end);
  const segment = layer.outPoint - layer.inPoint;
  const repeats = layer.loop && segment > 0 ? Math.ceil(span / segment) : 1;
  const playhead = player.timelineTime;
  const local = playhead - layer.startAt;
  const canSplit = local > 0.05 && local < span - 0.05;
  const color = LANE_COLORS[layer.colorIndex % LANE_COLORS.length];

  const setStartAt = (v: number) => updateLayer(layer.id, { startAt: Math.min(Math.max(0, v), Math.max(0, end - 0.05)) });
  const setEndAt = (v: number | null) => updateLayer(layer.id, { endAt: v == null ? null : Math.min(Math.max(v, layer.startAt + 0.05), end) });

  return (
    <>
      <Section title="Audio layer">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
          {getClipType(layer.file) === "video" ? <Video size={13} className="shrink-0 text-muted-foreground" /> : <AudioLines size={13} className="shrink-0 text-muted-foreground" />}
          <span className="min-w-0 flex-1 truncate text-xs" title={layer.name}>
            {layer.name}
          </span>
          <button type="button" onClick={() => updateLayer(layer.id, { muted: !layer.muted })} className={cn(iconChip, layer.muted && "text-destructive")} title={layer.muted ? "Unmute" : "Mute"}>
            {layer.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          <button type="button" onClick={() => removeLayer(layer.id)} className={cn(iconChip, "hover:text-destructive")} title="Remove layer">
            <Trash2 size={14} />
          </button>
        </div>
        {getClipType(layer.file) === "video" && <p className="text-[10px] text-muted-foreground">Using the audio track of this video.</p>}
        {src && <MediaPlayer ref={mediaRef} src={src} type="audio" trimRange={{ inPoint: layer.inPoint, outPoint: layer.outPoint }} className="border-0 bg-transparent p-0" />}
      </Section>

      <Section title="Trim source">
        <TrimEditor
          bare
          duration={layer.sourceDuration}
          inPoint={layer.inPoint}
          outPoint={layer.outPoint}
          onTrimChange={(inPoint, outPoint) => updateLayer(layer.id, { inPoint, outPoint })}
          mediaRef={mediaRef}
        />
      </Section>

      <Section title="Placement">
        <Row label="Start">
          <TimeField value={layer.startAt} onCommit={(v) => v != null && setStartAt(v)} />
          <button type="button" onClick={() => setStartAt(playhead)} className={chipClass}>
            Start here
          </button>
        </Row>
        <Row label="End">
          <TimeField value={layer.endAt} placeholder="auto" onCommit={setEndAt} />
          <button type="button" disabled={playhead <= layer.startAt + 0.05} onClick={() => setEndAt(playhead)} className={chipClass}>
            End here
          </button>
        </Row>
        <Row label="Loop">
          <Switch checked={layer.loop} onChange={(loop) => updateLayer(layer.id, { loop })} label="Loop to fill" />
          <span className="text-muted-foreground">{layer.loop ? "repeats until End (or the timeline end)" : "plays once"}</span>
        </Row>
        <Readout
          label="Plays"
          value={span > 0 ? `${formatTime(layer.startAt).slice(0, 5)} → ${formatTime(layer.startAt + span).slice(0, 5)}${layer.loop && repeats > 1 ? ` · ×${repeats}` : ""}` : "after the timeline ends"}
        />
      </Section>

      <Section title="Mix">
        <Row label="Volume">
          <input type="range" min={0} max={1} step={0.01} value={layer.volume} onChange={(e) => updateLayer(layer.id, { volume: Number(e.target.value) })} className="min-w-0 flex-1 accent-primary" />
          <span className="w-10 text-right font-mono">{Math.round(layer.volume * 100)}%</span>
        </Row>
      </Section>

      <Section title="Edit">
        <div className="flex flex-wrap gap-1.5">
          <button type="button" disabled={!canSplit} onClick={() => splitLayer(layer.id, playhead, end)} className={chipClass} title="Cut this layer in two at the playhead">
            <Scissors size={12} /> Split at playhead
          </button>
          <button type="button" onClick={() => duplicateLayer(layer.id, 1, end)} className={chipClass}>
            <Copy size={12} /> Duplicate
          </button>
        </div>
        <RepeatRow onRepeat={(n) => duplicateLayer(layer.id, n, end)} />
      </Section>
    </>
  );
};

const MultiInspector = ({ selection, onSelect }: { selection: Selection; onSelect: (s: Selection) => void }) => {
  const span = selectionSpan(selection);
  return (
    <>
      <Section title="Selection">
        <Readout label="Clips" value={String(selection.clips.length)} />
        <Readout label="Audio layers" value={String(selection.layers.length)} />
        {span && <Readout label="Spans" value={`${formatTime(span.start).slice(0, 5)} → ${formatTime(span.end).slice(0, 5)}`} />}
        {span && <Readout label="Length" value={formatTime(span.end - span.start)} />}
      </Section>
      <Section title="As one unit">
        <p className="text-[11px] text-muted-foreground">
          Repeat lays the whole arrangement down again after itself, tracks and lanes kept. Export always renders the
          entire timeline — choose "Audio only" there to get the combined result as an mp3.
        </p>
        <RepeatRow onRepeat={(n) => repeatSelection(selection, n)} />
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => repeatSelection(selection, 1)} className={chipClass}>
            <Copy size={12} /> Duplicate
          </button>
          <button
            type="button"
            onClick={() => {
              removeSelection(selection);
              onSelect(EMPTY_SELECTION);
            }}
            className={cn(chipClass, "hover:text-destructive")}
          >
            <Trash2 size={12} /> Remove all
          </button>
        </div>
      </Section>
      {selection.clips.length > 0 && <ConvertToAudio clipIds={selection.clips} onSelect={onSelect} />}
    </>
  );
};

export const Inspector = ({ selection, player, onSelect, onOpenTranscript }: InspectorProps) => {
  const clips = useClipStore((s) => s.clips);
  const joinCrossfade = useClipStore((s) => s.joinCrossfade);
  const setJoinCrossfade = useClipStore((s) => s.setJoinCrossfade);
  const layers = useAudioLayerStore((s) => s.layers);
  const end = projectEnd(clips, layers);
  const single = singleItem(selection);
  const count = selectionCount(selection);

  const clip = single?.kind === "clip" ? clips.find((c) => c.id === single.id) : undefined;
  const layer = single?.kind === "layer" ? layers.find((l) => l.id === single.id) : undefined;
  const title = clip ? "Clip" : layer ? "Audio layer" : count > 1 ? `${count} selected` : "Project";

  return (
    <aside className="flex min-h-0 flex-col bg-sidebar">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-sidebar-border px-3 text-xs font-semibold">
        <SlidersHorizontal size={13} className="text-primary" />
        {title}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {clip && (
          <motion.div key={clip.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
            <ClipInspector clip={clip} player={player} onSelect={onSelect} onOpenTranscript={onOpenTranscript} />
          </motion.div>
        )}
        {layer && (
          <motion.div key={layer.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
            <LayerInspector layer={layer} player={player} />
          </motion.div>
        )}
        {!clip && !layer && count > 1 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
            <MultiInspector selection={selection} onSelect={onSelect} />
          </motion.div>
        )}
        {!clip && !layer && count <= 1 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
            <Section title="Project">
              <Readout label="Duration" value={formatTime(end)} />
              <Readout label="Clips" value={String(clips.length)} />
              <Readout label="Video tracks" value={String(trackCount(clips))} />
              <Readout label="Audio layers" value={String(layers.length)} />
            </Section>
            <Section title="Smooth joins">
              <Row label="Crossfade">
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={joinCrossfade}
                  onChange={(e) => setJoinCrossfade(Number(e.target.value))}
                  className="min-w-0 flex-1 accent-primary"
                />
                <span className="w-12 text-right font-mono">{joinCrossfade === 0 ? "off" : `${joinCrossfade.toFixed(1)}s`}</span>
              </Row>
              <p className="text-[11px] text-muted-foreground">
                Blends the audio across every cut between clips so joins aren't heard, using the trimmed-away
                sound on each side. Applied on export — the video itself is never re-encoded.
              </p>
            </Section>
            <div className="flex items-start gap-2 px-3 py-3 text-[11px] text-muted-foreground">
              <Layers size={13} className="mt-0.5 shrink-0 text-primary" />
              <p>
                Drag clips anywhere on the timeline, or up onto a new track to stack them — the upper track plays on top.
                Shift-click, drag a box, or ⌘A to select several; right-click for split, duplicate and repeat.
              </p>
            </div>
          </motion.div>
        )}
      </div>
    </aside>
  );
};
