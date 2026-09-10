import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  AudioLines,
  Copy,
  Download,
  Magnet,
  Maximize2,
  Plus,
  Repeat,
  Scissors,
  Trash2,
  Video as VideoIcon,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import toast from "react-hot-toast";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/formatTime";
import { downloadFile } from "@/lib/download";
import { ACCEPT_MEDIA, getClipType } from "@/lib/fileValidation";
import { readMediaDuration } from "@/lib/media";
import { addAssetsToTimeline, importFiles } from "@/lib/importFiles";
import { mainClipRanges, timelineEnd as computeEnd, timelineToClipLocal } from "@/lib/timeline";
import { useAssetStore } from "@/stores/useAssetStore";
import { useAudioLayerStore } from "@/stores/useAudioLayerStore";
import { useClipStore } from "@/stores/useClipStore";
import type { SequencePlayer } from "@/hooks/useSequencePlayer";
import { useTimelineScale } from "@/components/timeline/useTimelineScale";
import { usePointerDrag } from "@/components/timeline/usePointerDrag";
import { RULER_HEIGHT, TimeRuler } from "@/components/timeline/TimeRuler";
import { Playhead } from "@/components/timeline/Playhead";
import { VIDEO_LANE_HEIGHT, VideoLane } from "@/components/timeline/VideoLane";
import { AUDIO_LANE_HEIGHT, LANE_COLORS, LayerBlock } from "@/components/timeline/LayerBlock";

export const ASSET_DRAG_TYPE = "application/x-doxatrim-asset";
const HEADER_WIDTH = 160;
const MIN_HEIGHT = 180;
const NUDGE_FRAME = 1 / 30;

export type Selection = { kind: "clip"; id: string } | { kind: "layer"; id: string } | null;

interface MixTimelineProps {
  player: SequencePlayer;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  height: number;
  onHeightChange: (h: number) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  target: NonNullable<Selection>;
}

function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

const toolButton =
  "flex h-7 items-center gap-1 rounded-md px-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent";

export const MixTimeline = ({ player, selection, onSelect, height, onHeightChange }: MixTimelineProps) => {
  const clips = useClipStore((s) => s.clips);
  const reorderClips = useClipStore((s) => s.reorderClips);
  const removeClip = useClipStore((s) => s.removeClip);
  const updateTrim = useClipStore((s) => s.updateTrim);
  const splitClip = useClipStore((s) => s.splitClip);
  const duplicateClip = useClipStore((s) => s.duplicateClip);
  const layers = useAudioLayerStore((s) => s.layers);
  const addLayer = useAudioLayerStore((s) => s.addLayer);
  const updateLayer = useAudioLayerStore((s) => s.updateLayer);
  const removeLayer = useAudioLayerStore((s) => s.removeLayer);
  const splitLayer = useAudioLayerStore((s) => s.splitLayer);
  const duplicateLayer = useAudioLayerStore((s) => s.duplicateLayer);
  const mainVolume = useAudioLayerStore((s) => s.mainVolume);
  const setMainVolume = useAudioLayerStore((s) => s.setMainVolume);
  const assets = useAssetStore((s) => s.assets);

  const scale = useTimelineScale();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [isDragOver, setIsDragOver] = useState(false);
  const [repeatCount, setRepeatCount] = useState(2);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const fittedRef = useRef(false);

  const ranges = mainClipRanges(clips);
  const end = computeEnd(clips);
  const contentWidth = Math.max(scale.timeToX(end) + 240, viewportWidth);
  const lanesHeight = RULER_HEIGHT + VIDEO_LANE_HEIGHT + layers.length * AUDIO_LANE_HEIGHT;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportWidth(el.clientWidth));
    ro.observe(el);
    setViewportWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Fit the whole project into view the first time it has a length.
  useEffect(() => {
    if (!fittedRef.current && end > 0 && viewportWidth > 0) {
      scale.fit(viewportWidth, end);
      fittedRef.current = true;
    }
  }, [end, viewportWidth, scale]);

  // Keep the playhead in view while playing.
  useEffect(() => {
    if (!player.playing) return;
    let raf = 0;
    const loop = () => {
      const el = scrollRef.current;
      if (el) {
        const x = scale.timeToX(player.getTimelineTimeNow());
        if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft) {
          el.scrollLeft = Math.max(0, x - 80);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [player.playing, player.getTimelineTimeNow, scale]);

  const onResizeDown = usePointerDrag({
    onMove: (_dx, dy) => {
      const max = Math.floor(window.innerHeight * 0.6);
      onHeightChange(Math.min(max, Math.max(MIN_HEIGHT, height - dy)));
    },
  });

  const snapTargets = [
    0,
    end,
    player.timelineTime,
    ...ranges.map((r) => r.start),
    ...layers.flatMap((l) => [l.startAt, l.startAt + (l.endAt ?? 0)]),
  ];

  const addLayerFromFile = useCallback(
    (file: File, duration: number, startAt: number) => {
      const layer = addLayer(file, duration);
      updateLayer(layer.id, { startAt: Math.max(0, Math.min(startAt, Math.max(0, end - 0.05))) });
      onSelect({ kind: "layer", id: layer.id });
    },
    [addLayer, updateLayer, end, onSelect]
  );

  // ── Editing operations (toolbar, keyboard, context menu all route here) ──
  const splitAtPlayhead = useCallback(
    (target: Selection = selection) => {
      const t = player.timelineTime;
      if (target?.kind === "layer") {
        splitLayer(target.id, t, end);
        return;
      }
      const hit = timelineToClipLocal(clips, t);
      if (!hit) return;
      splitClip(hit.clipId, hit.localTime);
      onSelect({ kind: "clip", id: hit.clipId });
    },
    [selection, player.timelineTime, clips, end, splitClip, splitLayer, onSelect]
  );

  const duplicate = useCallback(
    (target: Selection = selection, count = 1) => {
      if (!target) {
        toast("Select a clip or an audio layer first");
        return;
      }
      if (target.kind === "clip") duplicateClip(target.id, count);
      else duplicateLayer(target.id, count, end);
    },
    [selection, end, duplicateClip, duplicateLayer]
  );

  const remove = useCallback(
    (target: Selection = selection) => {
      if (!target) return;
      if (target.kind === "clip") removeClip(target.id);
      else removeLayer(target.id);
      onSelect(null);
    },
    [selection, removeClip, removeLayer, onSelect]
  );

  const playheadHit = timelineToClipLocal(clips, player.timelineTime);
  const canSplit =
    selection?.kind === "layer"
      ? true
      : !!playheadHit &&
        (() => {
          const c = clips.find((x) => x.id === playheadHit.clipId);
          return !!c && playheadHit.localTime > c.inPoint + 0.05 && playheadHit.localTime < c.outPoint - 0.05;
        })();

  // ── Drops: files or bin assets, onto the video lane or a layer position ──
  const dropTarget = (e: React.DragEvent) => {
    const el = scrollRef.current;
    if (!el) return { lane: "layer" as const, time: 0 };
    const rect = el.getBoundingClientRect();
    const y = e.clientY - rect.top + el.scrollTop;
    const x = e.clientX - rect.left + el.scrollLeft;
    const lane = y < RULER_HEIGHT + VIDEO_LANE_HEIGHT ? ("clip" as const) : ("layer" as const);
    return { lane, time: Math.max(0, scale.xToTime(x)) };
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const { lane, time } = dropTarget(e);

    const assetId = e.dataTransfer.getData(ASSET_DRAG_TYPE);
    if (assetId) {
      const asset = assets.find((a) => a.id === assetId);
      if (!asset) return;
      if (lane === "clip") {
        const { rejected } = addAssetsToTimeline([asset]);
        for (const { reason } of rejected) toast.error(reason);
      } else {
        addLayerFromFile(asset.file, asset.duration, time);
      }
      return;
    }

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    if (lane === "clip") {
      const { rejected } = await importFiles(files, { origin: "local", addToTimeline: true });
      for (const { file, reason } of rejected) toast.error(`${file.name}: ${reason}`);
    } else {
      for (const file of files) {
        const type = getClipType(file);
        if (!type) {
          toast.error(`${file.name}: unsupported file type`);
          continue;
        }
        addLayerFromFile(file, await readMediaDuration(file, type), time);
      }
    }
  };

  const handleAddLayerFiles = async (fileList: FileList | null) => {
    if (!fileList) return;
    for (const file of Array.from(fileList)) {
      const type = getClipType(file);
      if (!type) {
        toast.error(`${file.name}: unsupported file type`);
        continue;
      }
      addLayerFromFile(file, await readMediaDuration(file, type), player.timelineTime);
    }
  };

  // ── Keyboard: S split · ⌘/Ctrl+D duplicate · ←/→ nudge · I/O mark · Delete · Esc ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === "Escape") {
        setMenu(null);
        return;
      }
      if ((e.key === "s" || e.key === "S") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        splitAtPlayhead();
        return;
      }
      if ((e.key === "d" || e.key === "D") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        duplicate();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (!selection) return;
        e.preventDefault();
        remove();
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (!selection || selection.kind !== "layer") return;
        e.preventDefault();
        const layer = layers.find((l) => l.id === selection.id);
        if (!layer) return;
        const step = (e.shiftKey ? 1 : NUDGE_FRAME) * (e.key === "ArrowLeft" ? -1 : 1);
        updateLayer(layer.id, { startAt: Math.max(0, Math.min(end - 0.05, layer.startAt + step)) });
        return;
      }
      if ((e.key === "i" || e.key === "o") && selection?.kind === "clip") {
        const local = player.localTimeFor(selection.id);
        const clip = clips.find((c) => c.id === selection.id);
        if (local == null || !clip) return;
        e.preventDefault();
        if (e.key === "i") updateTrim(clip.id, Math.min(local, clip.outPoint - 0.05), clip.outPoint);
        else updateTrim(clip.id, clip.inPoint, Math.max(local, clip.inPoint + 0.05));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, layers, clips, end, updateLayer, updateTrim, player, splitAtPlayhead, duplicate, remove]);

  const openMenu = (target: NonNullable<Selection>, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(target);
    setMenu({ x: e.clientX, y: e.clientY, target });
  };

  const menuItem = (label: string, icon: React.ReactNode, action: () => void, opts?: { danger?: boolean; disabled?: boolean }) => (
    <button
      type="button"
      disabled={opts?.disabled}
      onClick={() => {
        setMenu(null);
        action();
      }}
      className={cn(
        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-40",
        opts?.danger && "text-destructive"
      )}
    >
      {icon} {label}
    </button>
  );

  return (
    <div className="relative flex shrink-0 flex-col border-t border-border bg-sidebar" style={{ height }}>
      <div onPointerDown={onResizeDown} className="absolute inset-x-0 -top-1 z-30 h-2 cursor-row-resize hover:bg-primary/40" />

      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2 text-xs">
        <button
          type="button"
          onClick={() => splitAtPlayhead()}
          disabled={!canSplit}
          className={toolButton}
          title="Split at playhead (S)"
        >
          <Scissors size={13} /> Split
        </button>
        <button
          type="button"
          onClick={() => duplicate()}
          disabled={!selection}
          className={toolButton}
          title="Duplicate selection (⌘/Ctrl+D)"
        >
          <Copy size={13} /> Duplicate
        </button>
        <div className="flex items-center gap-1" title="Repeat the selection N times">
          <button type="button" onClick={() => duplicate(selection, repeatCount)} disabled={!selection} className={toolButton}>
            <Repeat size={13} /> Repeat
          </button>
          <input
            type="number"
            min={1}
            max={500}
            value={repeatCount}
            onChange={(e) => setRepeatCount(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
            className="h-7 w-14 rounded-md border border-border bg-background px-1.5 font-mono text-xs outline-none focus:border-primary"
            aria-label="Repeat count"
          />
        </div>
        <button type="button" onClick={() => remove()} disabled={!selection} className={toolButton} title="Remove selection (Delete)">
          <Trash2 size={13} />
        </button>
        <span className="mx-1 h-5 w-px bg-border" />
        <button
          type="button"
          onClick={() => setSnapEnabled((s) => !s)}
          className={cn(toolButton, snapEnabled && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary")}
          title="Snap to clip edges, layers and playhead (hold Shift to bypass)"
        >
          <Magnet size={13} /> Snap
        </button>
        <span className="ml-2 font-mono text-muted-foreground">
          {formatTime(player.timelineTime)} <span className="opacity-50">/ {formatTime(end)}</span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-muted-foreground" title="Main audio volume">
            {mainVolume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={mainVolume}
              onChange={(e) => setMainVolume(Number(e.target.value))}
              className="w-24 accent-primary"
            />
          </label>
          <button type="button" onClick={scale.zoomOut} className="rounded p-1 text-muted-foreground hover:text-foreground" title="Zoom out">
            <ZoomOut size={14} />
          </button>
          <input
            type="range"
            min={Math.log(4)}
            max={Math.log(400)}
            step={0.01}
            value={Math.log(scale.pxPerSec)}
            onChange={(e) => scale.setPxPerSec(Math.exp(Number(e.target.value)))}
            className="w-24 accent-primary"
            aria-label="Zoom"
          />
          <button type="button" onClick={scale.zoomIn} className="rounded p-1 text-muted-foreground hover:text-foreground" title="Zoom in">
            <ZoomIn size={14} />
          </button>
          <button
            type="button"
            onClick={() => scale.fit(viewportWidth, end)}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            title="Fit project"
          >
            <Maximize2 size={14} />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="shrink-0 overflow-hidden border-r border-border" style={{ width: HEADER_WIDTH }}>
          <div style={{ height: RULER_HEIGHT }} className="border-b border-border" />
          <div className="flex items-center gap-2 border-b border-border px-3 text-xs font-semibold" style={{ height: VIDEO_LANE_HEIGHT }}>
            <VideoIcon size={14} className="text-primary" /> V1 · Sequence
          </div>
          {layers.map((layer, i) => (
            <div
              key={layer.id}
              className={cn(
                "flex items-center gap-1.5 border-b border-border px-2 text-xs",
                selection?.kind === "layer" && selection.id === layer.id && "bg-primary/10"
              )}
              style={{ height: AUDIO_LANE_HEIGHT }}
              onClick={() => onSelect({ kind: "layer", id: layer.id })}
              onContextMenu={(e) => openMenu({ kind: "layer", id: layer.id }, e)}
            >
              <span className="h-6 w-1 shrink-0 rounded-full" style={{ backgroundColor: LANE_COLORS[layer.colorIndex % LANE_COLORS.length] }} />
              <span className="min-w-0 flex-1 truncate font-semibold">
                A{i + 1} · {layer.name}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  updateLayer(layer.id, { muted: !layer.muted });
                }}
                className={cn("rounded p-1", layer.muted ? "text-destructive" : "text-muted-foreground hover:text-foreground")}
                title={layer.muted ? "Unmute" : "Mute"}
              >
                {layer.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  remove({ kind: "layer", id: layer.id });
                }}
                className="rounded p-1 text-muted-foreground hover:text-destructive"
                title="Remove layer"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <label htmlFor="doxatrim-timeline-layer-input" className="flex h-9 cursor-pointer items-center gap-1.5 px-3 text-xs text-muted-foreground hover:text-foreground">
            <Plus size={12} /> Add audio layer
            <input
              id="doxatrim-timeline-layer-input"
              type="file"
              multiple
              accept={ACCEPT_MEDIA}
              className="hidden"
              onChange={(e) => {
                void handleAddLayerFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>

        <div
          ref={scrollRef}
          className={cn("relative min-w-0 flex-1 overflow-auto", isDragOver && "bg-primary/5")}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => void handleDrop(e)}
          onClick={() => onSelect(null)}
        >
          <div className="relative" style={{ width: contentWidth, minHeight: "100%" }}>
            <TimeRuler duration={end} width={contentWidth} scale={scale} onSeek={player.seek} />
            <VideoLane
              clips={clips}
              ranges={ranges}
              scale={scale}
              width={contentWidth}
              selectedClipId={selection?.kind === "clip" ? selection.id : null}
              onSelect={(id) => onSelect({ kind: "clip", id })}
              onReorder={reorderClips}
              onRemove={(id) => remove({ kind: "clip", id })}
              onAddAsLayer={(clip) => addLayerFromFile(clip.file, clip.originalDuration, 0)}
              onDownload={(clip) => downloadFile(clip.file, clip.file.name)}
              onContextMenu={(id, e) => openMenu({ kind: "clip", id }, e)}
            />
            {layers.map((layer) => (
              <div key={layer.id} className="relative border-b border-border/60" style={{ height: AUDIO_LANE_HEIGHT, width: contentWidth }}>
                <LayerBlock
                  layer={layer}
                  timelineEnd={end}
                  scale={scale}
                  selected={selection?.kind === "layer" && selection.id === layer.id}
                  snapEnabled={snapEnabled}
                  snapTargets={snapTargets.filter((t) => t !== layer.startAt)}
                  onSelect={() => onSelect({ kind: "layer", id: layer.id })}
                  onChange={(patch) => updateLayer(layer.id, patch)}
                  onContextMenu={(e) => openMenu({ kind: "layer", id: layer.id }, e)}
                />
              </div>
            ))}
            {layers.length === 0 && clips.length > 0 && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-3 py-3 text-xs text-muted-foreground">
                Drop music, voiceover, or a video here to add an audio layer at that point in time.
              </motion.p>
            )}
            <Playhead player={player} scale={scale} height={Math.max(lanesHeight, height)} />
          </div>
        </div>
      </div>

      {menu && (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu(null);
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.12 }}
            onClick={(e) => e.stopPropagation()}
            className="absolute w-52 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl"
            style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 260) }}
          >
            {menuItem("Split at playhead", <Scissors size={12} />, () => splitAtPlayhead(menu.target), {
              disabled: menu.target.kind === "clip" && !(playheadHit && playheadHit.clipId === menu.target.id && canSplit),
            })}
            {menuItem("Duplicate", <Copy size={12} />, () => duplicate(menu.target, 1))}
            {menuItem(`Repeat ×${repeatCount}`, <Repeat size={12} />, () => duplicate(menu.target, repeatCount))}
            {menu.target.kind === "clip" && (
              <>
                <div className="my-1 h-px bg-border" />
                {menuItem("Use as audio layer", <AudioLines size={12} />, () => {
                  const clip = clips.find((c) => c.id === menu.target.id);
                  if (clip) addLayerFromFile(clip.file, clip.originalDuration, 0);
                })}
                {menuItem("Save source to disk", <Download size={12} />, () => {
                  const clip = clips.find((c) => c.id === menu.target.id);
                  if (clip) downloadFile(clip.file, clip.file.name);
                })}
              </>
            )}
            <div className="my-1 h-px bg-border" />
            {menuItem("Remove", <Trash2 size={12} />, () => remove(menu.target), { danger: true })}
          </motion.div>
        </div>
      )}
    </div>
  );
};
