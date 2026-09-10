import { useState } from "react";
import { motion } from "framer-motion";
import { AudioLines, Download, Music, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/formatTime";
import type { Clip } from "@/types/clip";
import type { ClipRange } from "@/lib/timeline";
import { usePointerDrag } from "@/components/timeline/usePointerDrag";
import type { TimelineScale } from "@/components/timeline/useTimelineScale";

export const VIDEO_LANE_HEIGHT = 64;

interface ClipBlockProps {
  clip: Clip;
  range: ClipRange;
  index: number;
  ranges: ClipRange[];
  scale: TimelineScale;
  selected: boolean;
  onSelect: () => void;
  onReorder: (from: number, to: number) => void;
  onRemove: () => void;
  onAddAsLayer: () => void;
  onDownload: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

const ClipBlock = ({
  clip,
  range,
  index,
  ranges,
  scale,
  selected,
  onSelect,
  onReorder,
  onRemove,
  onAddAsLayer,
  onDownload,
  onContextMenu,
}: ClipBlockProps) => {
  const [dragX, setDragX] = useState<number | null>(null);

  const onPointerDown = usePointerDrag({
    onStart: onSelect,
    onMove: (dx) => setDragX(dx),
    onEnd: (dx) => {
      setDragX(null);
      if (Math.abs(dx) < 4) return;
      const center = scale.timeToX((range.start + range.end) / 2) + dx;
      let target = index;
      let best = Infinity;
      ranges.forEach((r, i) => {
        const d = Math.abs(scale.timeToX((r.start + r.end) / 2) - center);
        if (d < best) {
          best = d;
          target = i;
        }
      });
      if (target !== index) onReorder(index, target);
    },
  });

  const left = scale.timeToX(range.start);
  const width = Math.max(scale.timeToX(range.end - range.start), 2);

  return (
    <motion.div
      layout={dragX === null}
      onPointerDown={onPointerDown}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={onContextMenu}
      className={cn(
        "group absolute top-1 bottom-1 cursor-grab select-none overflow-hidden rounded-md border bg-card active:cursor-grabbing",
        selected ? "border-primary ring-2 ring-primary/40" : "border-border",
        dragX !== null && "z-30 opacity-90 shadow-lg"
      )}
      style={{
        left,
        width,
        transform: dragX !== null ? `translateX(${dragX}px)` : undefined,
        backgroundImage: clip.thumbnailUrl ? `url(${clip.thumbnailUrl})` : undefined,
        backgroundRepeat: "repeat-x",
        backgroundSize: "auto 100%",
      }}
    >
      <div className="absolute inset-0 bg-linear-to-t from-black/70 via-black/20 to-transparent" />
      {!clip.thumbnailUrl && <Music size={16} className="absolute left-2 top-2 text-muted-foreground" />}
      <div className="absolute bottom-1 left-2 right-2 flex items-end justify-between gap-2 text-[11px] leading-tight text-white">
        <span className="truncate font-semibold drop-shadow">{clip.file.name}</span>
        <span className="shrink-0 font-mono opacity-80">{formatTime(range.end - range.start).slice(0, 5)}</span>
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
    </motion.div>
  );
};

interface VideoLaneProps {
  clips: Clip[];
  ranges: ClipRange[];
  scale: TimelineScale;
  width: number;
  selectedClipId: string | null;
  onSelect: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onRemove: (id: string) => void;
  onAddAsLayer: (clip: Clip) => void;
  onDownload: (clip: Clip) => void;
  onContextMenu: (id: string, e: React.MouseEvent) => void;
}

export const VideoLane = ({
  clips,
  ranges,
  scale,
  width,
  selectedClipId,
  onSelect,
  onReorder,
  onRemove,
  onAddAsLayer,
  onDownload,
  onContextMenu,
}: VideoLaneProps) => (
  <div className="relative border-b border-border" style={{ height: VIDEO_LANE_HEIGHT, width }}>
    {clips.length === 0 && (
      <p className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
        Drop video or audio here, or import from the media bin
      </p>
    )}
    {clips.map((clip, i) => (
      <ClipBlock
        key={clip.id}
        clip={clip}
        range={ranges[i]}
        index={i}
        ranges={ranges}
        scale={scale}
        selected={clip.id === selectedClipId}
        onSelect={() => onSelect(clip.id)}
        onReorder={onReorder}
        onRemove={() => onRemove(clip.id)}
        onAddAsLayer={() => onAddAsLayer(clip)}
        onDownload={() => onDownload(clip)}
        onContextMenu={(e) => onContextMenu(clip.id, e)}
      />
    ))}
  </div>
);
