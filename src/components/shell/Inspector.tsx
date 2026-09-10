import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  AudioLines,
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
import { layerSpan, timelineEnd, timelineToClipLocal } from "@/lib/timeline";
import { useAudioLayerStore } from "@/stores/useAudioLayerStore";
import { useClipStore } from "@/stores/useClipStore";
import type { SequencePlayer } from "@/hooks/useSequencePlayer";
import { MediaPlayer } from "@/components/MediaPlayer";
import { Switch } from "@/components/Switch";
import { TrimEditor } from "@/components/TrimEditor";
import { LANE_COLORS } from "@/components/timeline/LayerBlock";
import type { Selection } from "@/components/timeline/MixTimeline";
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

const fieldClass =
  "h-7 w-24 rounded-md border border-border bg-background px-2 font-mono text-xs outline-none focus:border-primary";
const chipClass =
  "flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40";
const iconChip = "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground";

const TimeField = ({
  value,
  placeholder,
  onCommit,
}: {
  value: number | null;
  placeholder?: string;
  onCommit: (v: number | null) => void;
}) => (
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
  const removeClip = useClipStore((s) => s.removeClip);
  const splitClip = useClipStore((s) => s.splitClip);
  const duplicateClip = useClipStore((s) => s.duplicateClip);
  const addLayer = useAudioLayerStore((s) => s.addLayer);
  const [repeat, setRepeat] = useState(2);

  const hit = timelineToClipLocal(clips, player.timelineTime);
  const canSplit = hit?.clipId === clip.id && hit.localTime > clip.inPoint + 0.05 && hit.localTime < clip.outPoint - 0.05;

  return (
    <>
      <Section title="Clip">
        <Readout label="File" value="" />
        <p className="-mt-2 truncate text-xs" title={clip.file.name}>
          {clip.file.name}
        </p>
        <Readout label="Type" value={clip.type} />
        <Readout label="Source" value={formatTime(clip.originalDuration)} />
        <Readout label="Trimmed" value={formatTime(clip.outPoint - clip.inPoint)} />
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
          <kbd className="rounded border border-border px-1">I</kbd> / <kbd className="rounded border border-border px-1">O</kbd> mark
          in/out at the playhead · <kbd className="rounded border border-border px-1">S</kbd> splits at the playhead
        </p>
      </Section>

      <Section title="Edit">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={!canSplit}
            onClick={() => hit && splitClip(clip.id, hit.localTime)}
            className={chipClass}
            title="Cut this clip in two at the playhead"
          >
            <Scissors size={12} /> Split at playhead
          </button>
          <button type="button" onClick={() => duplicateClip(clip.id)} className={chipClass}>
            <Copy size={12} /> Duplicate
          </button>
        </div>
        <Row label="Repeat">
          <input
            type="number"
            min={1}
            max={500}
            value={repeat}
            onChange={(e) => setRepeat(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
            className={cn(fieldClass, "w-16")}
          />
          <button type="button" onClick={() => duplicateClip(clip.id, repeat)} className={chipClass}>
            <Repeat size={12} /> ×{repeat}
          </button>
        </Row>
        <p className="text-[10px] text-muted-foreground">
          Copies are inserted right after this clip — repeat a trimmed section to extend it, then export as
          video or audio.
        </p>
      </Section>

      <Section title="Actions">
        <div className="flex flex-wrap gap-1.5">
          {clip.transcript && clip.transcript.length > 0 && (
            <button type="button" onClick={onOpenTranscript} className={chipClass}>
              <FileText size={12} /> Transcript
            </button>
          )}
          <button
            type="button"
            onClick={() => onSelect({ kind: "layer", id: addLayer(clip.file, clip.originalDuration).id })}
            className={chipClass}
          >
            <AudioLines size={12} /> Use as audio layer
          </button>
          <button type="button" onClick={() => downloadFile(clip.file, clip.file.name)} className={chipClass}>
            <Download size={12} /> Save source
          </button>
          <button
            type="button"
            onClick={() => {
              removeClip(clip.id);
              onSelect(null);
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
  const [repeat, setRepeat] = useState(2);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);

  // Create and revoke in the same effect so a StrictMode re-run regenerates a valid URL.
  useEffect(() => {
    const url = URL.createObjectURL(layer.file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [layer.file]);

  const end = timelineEnd(clips);
  const span = layerSpan(layer, end);
  const segment = layer.outPoint - layer.inPoint;
  const repeats = layer.loop && segment > 0 ? Math.ceil(span / segment) : 1;
  const playhead = player.timelineTime;
  const local = playhead - layer.startAt;
  const canSplit = local > 0.05 && local < span - 0.05;
  const color = LANE_COLORS[layer.colorIndex % LANE_COLORS.length];

  const setStartAt = (v: number) => updateLayer(layer.id, { startAt: Math.min(Math.max(0, v), Math.max(0, end - 0.05)) });
  const setEndAt = (v: number | null) =>
    updateLayer(layer.id, { endAt: v == null ? null : Math.min(Math.max(v, layer.startAt + 0.05), end) });

  return (
    <>
      <Section title="Audio layer">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
          {getClipType(layer.file) === "video" ? (
            <Video size={13} className="shrink-0 text-muted-foreground" />
          ) : (
            <AudioLines size={13} className="shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate text-xs" title={layer.name}>
            {layer.name}
          </span>
          <button
            type="button"
            onClick={() => updateLayer(layer.id, { muted: !layer.muted })}
            className={cn(iconChip, layer.muted && "text-destructive")}
            title={layer.muted ? "Unmute" : "Mute"}
          >
            {layer.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          <button type="button" onClick={() => removeLayer(layer.id)} className={cn(iconChip, "hover:text-destructive")} title="Remove layer">
            <Trash2 size={14} />
          </button>
        </div>
        {getClipType(layer.file) === "video" && (
          <p className="text-[10px] text-muted-foreground">Using the audio track of this video.</p>
        )}
        {src && (
          <MediaPlayer
            ref={mediaRef}
            src={src}
            type="audio"
            trimRange={{ inPoint: layer.inPoint, outPoint: layer.outPoint }}
            className="border-0 bg-transparent p-0"
          />
        )}
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
          <button
            type="button"
            disabled={playhead <= layer.startAt + 0.05}
            onClick={() => setEndAt(playhead)}
            className={chipClass}
          >
            End here
          </button>
        </Row>
        <Row label="Loop">
          <Switch checked={layer.loop} onChange={(loop) => updateLayer(layer.id, { loop })} label="Loop to fill" />
          <span className="text-muted-foreground">
            {layer.loop ? "repeats until End (or the timeline end)" : "plays once"}
          </span>
        </Row>
        <Readout
          label="Plays"
          value={
            span > 0
              ? `${formatTime(layer.startAt).slice(0, 5)} → ${formatTime(layer.startAt + span).slice(0, 5)}${
                  layer.loop && repeats > 1 ? ` · ×${repeats}` : ""
                }`
              : "after the timeline ends"
          }
        />
      </Section>

      <Section title="Mix">
        <Row label="Volume">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={layer.volume}
            onChange={(e) => updateLayer(layer.id, { volume: Number(e.target.value) })}
            className="min-w-0 flex-1 accent-primary"
          />
          <span className="w-10 text-right font-mono">{Math.round(layer.volume * 100)}%</span>
        </Row>
      </Section>

      <Section title="Edit">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={!canSplit}
            onClick={() => splitLayer(layer.id, playhead, end)}
            className={chipClass}
            title="Cut this layer in two at the playhead"
          >
            <Scissors size={12} /> Split at playhead
          </button>
          <button type="button" onClick={() => duplicateLayer(layer.id, 1, end)} className={chipClass}>
            <Copy size={12} /> Duplicate
          </button>
        </div>
        <Row label="Repeat">
          <input
            type="number"
            min={1}
            max={500}
            value={repeat}
            onChange={(e) => setRepeat(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
            className={cn(fieldClass, "w-16")}
          />
          <button type="button" onClick={() => duplicateLayer(layer.id, repeat, end)} className={chipClass}>
            <Repeat size={12} /> ×{repeat}
          </button>
        </Row>
      </Section>
    </>
  );
};

export const Inspector = ({ selection, player, onSelect, onOpenTranscript }: InspectorProps) => {
  const clips = useClipStore((s) => s.clips);
  const layers = useAudioLayerStore((s) => s.layers);
  const end = timelineEnd(clips);

  const clip = selection?.kind === "clip" ? clips.find((c) => c.id === selection.id) : undefined;
  const layer = selection?.kind === "layer" ? layers.find((l) => l.id === selection.id) : undefined;

  return (
    <aside className="flex min-h-0 flex-col bg-sidebar">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-sidebar-border px-3 text-xs font-semibold">
        <SlidersHorizontal size={13} className="text-primary" />
        {clip ? "Clip" : layer ? "Audio layer" : "Project"}
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
        {!clip && !layer && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
            <Section title="Project">
              <Readout label="Duration" value={formatTime(end)} />
              <Readout label="Clips" value={String(clips.length)} />
              <Readout label="Audio layers" value={String(layers.length)} />
            </Section>
            <div className="flex items-start gap-2 px-3 py-3 text-[11px] text-muted-foreground">
              <Layers size={13} className="mt-0.5 shrink-0 text-primary" />
              <p>
                Select a clip or an audio layer on the timeline to edit it here. Right-click any block for
                split, duplicate and repeat.
              </p>
            </div>
          </motion.div>
        )}
      </div>
    </aside>
  );
};
