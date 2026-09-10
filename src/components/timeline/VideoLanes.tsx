import { useRef, useState } from "react";
import { AudioLines, Download, Music, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/formatTime";
import { clipEnd, clipLength } from "@/lib/timeline";
import { isSelected, type Selection } from "@/lib/selection";
import type { Clip } from "@/types/clip";
import { usePointerDrag } from "@/components/timeline/usePointerDrag";
import type { TimelineScale } from "@/components/timeline/useTimelineScale";

export const VIDEO_LANE_HEIGHT = 64;

export interface ClipDragHandlers {
  /** Called once when a drag starts; the timeline snapshots the selection. */
  onDragStart: (id: string, additive: boolean) => void;
  /** dt in seconds (already snapped), dTrack in whole tracks (up = positive). */
  onDrag: (dt: number, dTrack: number) => void;
  onDragEnd: () => void;
}

interface ClipBlockProps {
  clip: Clip;
  trackCount: number;
  scale: TimelineScale;
  selected: boolean;
  snap: (t: number, shiftKey: boolean) => number;
  drag: ClipDragHandlers;
  onSelect: (additive: boolean) => void;
  onChange: (patch: Partial<Omit<Clip, "id" | "file">>) => void;
  onRemove: () => void;
  onAddAsLayer: () => void;
  onDownload: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

const additiveOf = (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => e.shiftKey || e.metaKey || e.ctrlKey;

const ClipBlock = ({
  clip,
  trackCount,
  scale,
  selected,
  snap,
  drag,
  onSelect,
  onChange,
  onRemove,
  onAddAsLayer,
  onDownload,
  onContextMenu,
}: ClipBlockProps) => {
  const startRef = useRef({ startAt: 0, inPoint: 0, outPoint: 0 });
  const [dragging, setDragging] = useState(false);

  const capture = () => {
    startRef.current = { startAt: clip.startAt, inPoint: clip.inPoint, outPoint: clip.outPoint };
  };

  const onBodyDown = usePointerDrag({
    onStart: (e) => {
      capture();
      drag.onDragStart(clip.id, additiveOf(e));
      setDragging(true);
    },
    onMove: (dx, dy, e) => {
      const s = startRef.current;
      const raw = s.startAt + scale.xToTime(dx);
      const dt = Math.max(-s.startAt, snap(raw, e.shiftKey) - s.startAt);
      // Moving up the screen = a higher track.
      const dTrack = -Math.round(dy / VIDEO_LANE_HEIGHT);
      drag.onDrag(dt, dTrack);
    },
    onEnd: () => {
      setDragging(false);
      drag.onDragEnd();
    },
  });

  // Head trim: inPoint and startAt move together so the picture stays aligned.
  const onLeftDown = usePointerDrag({
    onStart: (e) => {
      capture();
      onSelect(additiveOf(e));
    },
    onMove: (dx, _dy, e) => {
      const s = startRef.current;
      const rawStart = snap(s.startAt + scale.xToTime(dx), e.shiftKey);
      let delta = rawStart - s.startAt;
      delta = Math.max(delta, -s.inPoint, -s.startAt);
      delta = Math.min(delta, s.outPoint - s.inPoint - 0.05);
      onChange({ startAt: s.startAt + delta, inPoint: s.inPoint + delta });
    },
  });

  const onRightDown = usePointerDrag({
    onStart: (e) => {
      capture();
      onSelect(additiveOf(e));
    },
    onMove: (dx, _dy, e) => {
      const s = startRef.current;
      const rawEnd = snap(s.startAt + (s.outPoint - s.inPoint) + scale.xToTime(dx), e.shiftKey);
      const outPoint = s.inPoint + (rawEnd - s.startAt);
      onChange({ outPoint: Math.min(clip.originalDuration, Math.max(s.inPoint + 0.05, outPoint)) });
    },
  });

  const left = scale.timeToX(clip.startAt);
  const width = Math.max(scale.timeToX(clipLength(clip)), 2);
  const laneIndex = trackCount - 1 - clip.track;
  const top = laneIndex * VIDEO_LANE_HEIGHT + 4;

  return (
    <div
      onPointerDown={onBodyDown}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={onContextMenu}
      className={cn(
        "group absolute cursor-grab select-none overflow-hidden rounded-md border bg-card active:cursor-grabbing",
        selected ? "border-primary ring-2 ring-primary/40" : "border-border",
        dragging && "z-30 opacity-90 shadow-lg"
      )}
      style={{
        left,
        top,
        width,
        height: VIDEO_LANE_HEIGHT - 8,
        backgroundImage: clip.thumbnailUrl ? `url(${clip.thumbnailUrl})` : undefined,
        backgroundRepeat: "repeat-x",
        backgroundSize: "auto 100%",
      }}
    >
      <div className="absolute inset-0 bg-linear-to-t from-black/70 via-black/20 to-transparent" />
      {!clip.thumbnailUrl && <Music size={16} className="absolute left-2 top-2 text-muted-foreground" />}
      <div className="absolute bottom-1 left-2 right-2 flex items-end justify-between gap-2 text-[11px] leading-tight text-white">
        <span className="truncate font-semibold drop-shadow">{clip.file.name}</span>
        <span className="shrink-0 font-mono opacity-80">{formatTime(clipLength(clip)).slice(0, 5)}</span>
      </div>
      <div className="absolute right-1 top-1 hidden gap-0.5 rounded-md bg-black/60 p-0.5 group-hover:flex">
        <button
          type="button"
          title="Use this clip's audio as a layer"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onAddAsLayer}
          className="flex h-6 w-6 items-center justify-center rounded text-white/80 hover:bg-white/15 hover:text-white"
        >
          <AudioLines size={12} />
        </button>
        <button
          type="button"
          title="Save source to disk"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onDownload}
          className="flex h-6 w-6 items-center justify-center rounded text-white/80 hover:bg-white/15 hover:text-white"
        >
          <Download size={12} />
        </button>
        <button
          type="button"
          title="Remove from timeline"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onRemove}
          className="flex h-6 w-6 items-center justify-center rounded text-white/80 hover:bg-destructive/80 hover:text-white"
        >
          <Trash2 size={12} />
        </button>
      </div>
      <div onPointerDown={onLeftDown} className="absolute inset-y-0 left-0 w-2 cursor-ew-resize hover:bg-white/30" />
      <div onPointerDown={onRightDown} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-white/30" />
    </div>
  );
};

interface VideoLanesProps {
  clips: Clip[];
  /** Visible lanes, including the spare empty one on top. */
  trackCount: number;
  scale: TimelineScale;
  width: number;
  selection: Selection;
  snap: (t: number, shiftKey: boolean) => number;
  drag: ClipDragHandlers;
  onSelect: (id: string, additive: boolean) => void;
  onChange: (id: string, patch: Partial<Omit<Clip, "id" | "file">>) => void;
  onRemove: (id: string) => void;
  onAddAsLayer: (clip: Clip) => void;
  onDownload: (clip: Clip) => void;
  onContextMenu: (id: string, e: React.MouseEvent) => void;
}

export const VideoLanes = ({
  clips,
  trackCount,
  scale,
  width,
  selection,
  snap,
  drag,
  onSelect,
  onChange,
  onRemove,
  onAddAsLayer,
  onDownload,
  onContextMenu,
}: VideoLanesProps) => (
  <div className="relative" style={{ height: trackCount * VIDEO_LANE_HEIGHT, width }}>
    {Array.from({ length: trackCount }, (_, laneIndex) => {
      const track = trackCount - 1 - laneIndex;
      const empty = !clips.some((c) => c.track === track);
      return (
        <div
          key={track}
          className={cn("absolute inset-x-0 border-b border-border", empty && laneIndex === 0 && "bg-muted/20")}
          style={{ top: laneIndex * VIDEO_LANE_HEIGHT, height: VIDEO_LANE_HEIGHT }}
        >
          {empty && (
            <p className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground/70">
              {laneIndex === 0
                ? "Drag a clip up here to stack it on a new track"
                : clips.length === 0
                  ? "Drop video or audio here, or import from the media bin"
                  : ""}
            </p>
          )}
        </div>
      );
    })}
    {clips.map((clip) => (
      <ClipBlock
        key={clip.id}
        clip={clip}
        trackCount={trackCount}
        scale={scale}
        selected={isSelected(selection, "clip", clip.id)}
        snap={snap}
        drag={drag}
        onSelect={(additive) => onSelect(clip.id, additive)}
        onChange={(patch) => onChange(clip.id, patch)}
        onRemove={() => onRemove(clip.id)}
        onAddAsLayer={() => onAddAsLayer(clip)}
        onDownload={() => onDownload(clip)}
        onContextMenu={(e) => onContextMenu(clip.id, e)}
      />
    ))}
  </div>
);

export const clipRight = clipEnd;
