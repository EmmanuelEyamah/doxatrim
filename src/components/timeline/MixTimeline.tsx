import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  AudioLines,
  BoxSelect,
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
import { snapTime } from "@/lib/snap";
import { clipEnd, layerSpan, timelineEnd as computeEnd, timelineToClipLocal, trackCount as countTracks } from "@/lib/timeline";
import {
  EMPTY_SELECTION,
  isEmptySelection,
  isSelected,
  only,
  selectItem,
  selectionCount,
  singleItem,
  union,
  type ItemKind,
  type Selection,
} from "@/lib/selection";
import { moveSnapshot, removeSelection, repeatSelection, snapshotSelection, type DragSnapshot } from "@/lib/groupOps";
import { useAssetStore } from "@/stores/useAssetStore";
import { useAudioLayerStore } from "@/stores/useAudioLayerStore";
import { useClipStore } from "@/stores/useClipStore";
import type { SequencePlayer } from "@/hooks/useSequencePlayer";
import { useTimelineScale } from "@/components/timeline/useTimelineScale";
import { usePointerDrag } from "@/components/timeline/usePointerDrag";
import { RULER_HEIGHT, TimeRuler } from "@/components/timeline/TimeRuler";
import { Playhead } from "@/components/timeline/Playhead";
import { VIDEO_LANE_HEIGHT, VideoLanes } from "@/components/timeline/VideoLanes";
import { AUDIO_LANE_HEIGHT, LANE_COLORS, LayerBlock } from "@/components/timeline/LayerBlock";

export const ASSET_DRAG_TYPE = "application/x-doxatrim-asset";
const HEADER_WIDTH = 160;
const MIN_HEIGHT = 180;
const NUDGE_FRAME = 1 / 30;
const SNAP_PX = 8;

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
  target: Selection;
}

interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  additive: boolean;
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
  const updateClip = useClipStore((s) => s.updateClip);
  const updateTrim = useClipStore((s) => s.updateTrim);
  const splitClip = useClipStore((s) => s.splitClip);
  const layers = useAudioLayerStore((s) => s.layers);
  const addLayer = useAudioLayerStore((s) => s.addLayer);
  const updateLayer = useAudioLayerStore((s) => s.updateLayer);
  const splitLayer = useAudioLayerStore((s) => s.splitLayer);
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
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const fittedRef = useRef(false);
  const dragRef = useRef<{ snapshot: DragSnapshot; endBefore: number } | null>(null);

  const end = computeEnd(clips);
  const tracks = countTracks(clips) + 1; // + one spare lane on top to drag clips into
  const contentWidth = Math.max(scale.timeToX(end) + 240, viewportWidth);
  const videoAreaHeight = tracks * VIDEO_LANE_HEIGHT;
  const lanesHeight = RULER_HEIGHT + videoAreaHeight + layers.length * AUDIO_LANE_HEIGHT;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportWidth(el.clientWidth));
    ro.observe(el);
    setViewportWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

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
        if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80);
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

  // ── Snapping ──
  const snapTargets = [
    0,
    end,
    player.timelineTime,
    ...clips.flatMap((c) => [c.startAt, clipEnd(c)]),
    ...layers.flatMap((l) => [l.startAt, l.startAt + layerSpan(l, end)]),
  ];
  const snap = useCallback(
    (t: number, shiftKey: boolean) => (snapEnabled && !shiftKey ? snapTime(t, snapTargets, SNAP_PX / scale.pxPerSec) : t),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapEnabled, scale.pxPerSec, clips, layers, end, player.timelineTime]
  );

  // ── Selection + group drag ──
  const select = useCallback(
    (kind: ItemKind, id: string, additive: boolean) => {
      onSelect(selectItem(selection, kind, id, additive));
    },
    [selection, onSelect]
  );

  const beginDrag = useCallback(
    (kind: ItemKind, id: string, additive: boolean) => {
      const next = isSelected(selection, kind, id) ? selection : selectItem(selection, kind, id, additive);
      if (next !== selection) onSelect(next);
      dragRef.current = { snapshot: snapshotSelection(next), endBefore: end };
    },
    [selection, onSelect, end]
  );
  const dragBy = useCallback((dt: number, dTrack: number) => {
    const d = dragRef.current;
    if (d) moveSnapshot(d.snapshot, dt, dTrack, d.endBefore);
  }, []);
  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  const clipDrag = { onDragStart: (id: string, a: boolean) => beginDrag("clip", id, a), onDrag: dragBy, onDragEnd: endDrag };
  const layerDrag = { onDragStart: (id: string, a: boolean) => beginDrag("layer", id, a), onDrag: (dt: number) => dragBy(dt, 0), onDragEnd: endDrag };

  // ── Marquee on empty timeline ──
  const contentPoint = (clientX: number, clientY: number) => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    return { x: clientX - rect.left + el.scrollLeft, y: clientY - rect.top + el.scrollTop };
  };
  const onMarqueeDown = usePointerDrag({
    onStart: (e) => {
      const p = contentPoint(e.clientX, e.clientY);
      setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y, additive: e.shiftKey || e.metaKey || e.ctrlKey });
    },
    onMove: (dx, dy) => setMarquee((m) => (m ? { ...m, x1: m.x0 + dx, y1: m.y0 + dy } : m)),
    onEnd: (dx, dy) => {
      setMarquee((m) => {
        if (!m) return null;
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
          if (!m.additive) onSelect(EMPTY_SELECTION);
          return null;
        }
        const left = Math.min(m.x0, m.x1);
        const right = Math.max(m.x0, m.x1);
        const top = Math.min(m.y0, m.y1);
        const bottom = Math.max(m.y0, m.y1);
        const hit: Selection = { clips: [], layers: [] };
        for (const c of clips) {
          const laneTop = RULER_HEIGHT + (tracks - 1 - c.track) * VIDEO_LANE_HEIGHT;
          const laneBottom = laneTop + VIDEO_LANE_HEIGHT;
          if (scale.timeToX(clipEnd(c)) >= left && scale.timeToX(c.startAt) <= right && laneBottom >= top && laneTop <= bottom) {
            hit.clips.push(c.id);
          }
        }
        layers.forEach((l, i) => {
          const laneTop = RULER_HEIGHT + videoAreaHeight + i * AUDIO_LANE_HEIGHT;
          const laneBottom = laneTop + AUDIO_LANE_HEIGHT;
          const x0 = scale.timeToX(l.startAt);
          const x1 = scale.timeToX(l.startAt + layerSpan(l, end));
          if (x1 >= left && x0 <= right && laneBottom >= top && laneTop <= bottom) hit.layers.push(l.id);
        });
        onSelect(m.additive ? union(selection, hit) : hit);
        return null;
      });
    },
  });

  // ── Editing operations (toolbar, keyboard, context menu all route here) ──
  const splitAtPlayhead = useCallback(
    (target: Selection = selection) => {
      const t = player.timelineTime;
      let did = false;
      for (const id of target.layers) {
        splitLayer(id, t, end);
        did = true;
      }
      const clipTargets = target.clips.length > 0 ? clips.filter((c) => target.clips.includes(c.id)) : [];
      const underPlayhead = timelineToClipLocal(clips, t);
      if (clipTargets.length === 0 && target.layers.length === 0 && underPlayhead) {
        splitClip(underPlayhead.clipId, underPlayhead.localTime);
        onSelect(only("clip", underPlayhead.clipId));
        return;
      }
      for (const c of clipTargets) {
        if (t > c.startAt + 0.05 && t < clipEnd(c) - 0.05) {
          splitClip(c.id, c.inPoint + (t - c.startAt));
          did = true;
        }
      }
      if (!did) toast("Move the playhead inside the selected clip to split it");
    },
    [selection, player.timelineTime, clips, end, splitClip, splitLayer, onSelect]
  );

  const repeat = useCallback(
    (target: Selection = selection, count = 1) => {
      if (isEmptySelection(target)) {
        toast("Select a clip or an audio layer first");
        return;
      }
      repeatSelection(target, count);
    },
    [selection]
  );

  const remove = useCallback(
    (target: Selection = selection) => {
      removeSelection(target);
      onSelect(EMPTY_SELECTION);
    },
    [selection, onSelect]
  );

  const selectAll = useCallback(() => {
    onSelect({ clips: clips.map((c) => c.id), layers: layers.map((l) => l.id) });
  }, [clips, layers, onSelect]);

  const addLayerFromFile = useCallback(
    (file: File, duration: number, startAt: number) => {
      const layer = addLayer(file, duration);
      updateLayer(layer.id, { startAt: Math.max(0, Math.min(startAt, Math.max(0, end - 0.05))) });
      onSelect(only("layer", layer.id));
    },
    [addLayer, updateLayer, end, onSelect]
  );

  const playheadHit = timelineToClipLocal(clips, player.timelineTime);
  const canSplit =
    selection.layers.length > 0 ||
    (selection.clips.length > 0
      ? clips.some((c) => selection.clips.includes(c.id) && player.timelineTime > c.startAt + 0.05 && player.timelineTime < clipEnd(c) - 0.05)
      : !!playheadHit);

  // ── Drops: files or bin assets, onto a video track or a layer position ──
  const dropTarget = (e: React.DragEvent) => {
    const { x, y } = contentPoint(e.clientX, e.clientY);
    const time = Math.max(0, scale.xToTime(x));
    if (y < RULER_HEIGHT + videoAreaHeight) {
      const laneIndex = Math.max(0, Math.min(tracks - 1, Math.floor((y - RULER_HEIGHT) / VIDEO_LANE_HEIGHT)));
      return { lane: "clip" as const, track: tracks - 1 - laneIndex, time };
    }
    return { lane: "layer" as const, track: 0, time };
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const { lane, track, time } = dropTarget(e);

    const assetId = e.dataTransfer.getData(ASSET_DRAG_TYPE);
    if (assetId) {
      const asset = assets.find((a) => a.id === assetId);
      if (!asset) return;
      if (lane === "clip") {
        const { clips: placed, rejected } = addAssetsToTimeline([asset], { track, startAt: time });
        for (const { reason } of rejected) toast.error(reason);
        if (placed[0]) onSelect(only("clip", placed[0].id));
      } else {
        addLayerFromFile(asset.file, asset.duration, time);
      }
      return;
    }

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    if (lane === "clip") {
      const { rejected } = await importFiles(files, { origin: "local", addToTimeline: true, placement: { track, startAt: time } });
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

  // ── Keyboard ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const cmd = e.metaKey || e.ctrlKey;
      if (e.key === "Escape") {
        setMenu(null);
        return;
      }
      if (cmd && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        selectAll();
        return;
      }
      if (!cmd && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        splitAtPlayhead();
        return;
      }
      if (cmd && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        repeat(selection, 1);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (isEmptySelection(selection)) return;
        e.preventDefault();
        remove();
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (isEmptySelection(selection)) return;
        e.preventDefault();
        const step = (e.shiftKey ? 1 : NUDGE_FRAME) * (e.key === "ArrowLeft" ? -1 : 1);
        moveSnapshot(snapshotSelection(selection), step, 0, end);
        return;
      }
      const single = singleItem(selection);
      if ((e.key === "i" || e.key === "o") && single?.kind === "clip") {
        const local = player.localTimeFor(single.id);
        const clip = clips.find((c) => c.id === single.id);
        if (local == null || !clip) return;
        e.preventDefault();
        if (e.key === "i") updateTrim(clip.id, Math.min(local, clip.outPoint - 0.05), clip.outPoint);
        else updateTrim(clip.id, clip.inPoint, Math.max(local, clip.inPoint + 0.05));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, clips, end, updateTrim, player, splitAtPlayhead, repeat, remove, selectAll]);

  const openMenu = (kind: ItemKind, id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const target = isSelected(selection, kind, id) ? selection : only(kind, id);
    if (target !== selection) onSelect(target);
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

  const count = selectionCount(selection);
  const menuSingleClip = menu && singleItem(menu.target)?.kind === "clip" ? clips.find((c) => c.id === menu.target.clips[0]) : undefined;

  return (
    <div className="relative flex shrink-0 flex-col border-t border-border bg-sidebar" style={{ height }}>
      <div onPointerDown={onResizeDown} className="absolute inset-x-0 -top-1 z-30 h-2 cursor-row-resize hover:bg-primary/40" />

      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2 text-xs">
        <button type="button" onClick={() => splitAtPlayhead()} disabled={!canSplit} className={toolButton} title="Split at playhead (S)">
          <Scissors size={13} /> Split
        </button>
        <button type="button" onClick={() => repeat(selection, 1)} disabled={count === 0} className={toolButton} title="Duplicate selection (⌘/Ctrl+D)">
          <Copy size={13} /> Duplicate
        </button>
        <div className="flex items-center gap-1" title="Repeat the whole selection N times, as one unit">
          <button type="button" onClick={() => repeat(selection, repeatCount)} disabled={count === 0} className={toolButton}>
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
        <button type="button" onClick={() => remove()} disabled={count === 0} className={toolButton} title="Remove selection (Delete)">
          <Trash2 size={13} />
        </button>
        <span className="mx-1 h-5 w-px bg-border" />
        <button type="button" onClick={selectAll} disabled={clips.length + layers.length === 0} className={toolButton} title="Select everything (⌘/Ctrl+A)">
          <BoxSelect size={13} /> All
        </button>
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
        {count > 1 && <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">{count} selected</span>}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-muted-foreground" title="Main audio volume">
            {mainVolume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
            <input type="range" min={0} max={1} step={0.01} value={mainVolume} onChange={(e) => setMainVolume(Number(e.target.value))} className="w-24 accent-primary" />
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
          <button type="button" onClick={() => scale.fit(viewportWidth, end)} className="rounded p-1 text-muted-foreground hover:text-foreground" title="Fit project">
            <Maximize2 size={14} />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="shrink-0 overflow-hidden border-r border-border" style={{ width: HEADER_WIDTH }}>
          <div style={{ height: RULER_HEIGHT }} className="border-b border-border" />
          {Array.from({ length: tracks }, (_, laneIndex) => {
            const track = tracks - 1 - laneIndex;
            const spare = laneIndex === 0;
            return (
              <div
                key={track}
                className={cn("flex items-center gap-2 border-b border-border px-3 text-xs font-semibold", spare && "text-muted-foreground/60")}
                style={{ height: VIDEO_LANE_HEIGHT }}
              >
                <VideoIcon size={14} className={spare ? "text-muted-foreground/60" : "text-primary"} /> V{track + 1}
                {spare && <span className="text-[10px] font-normal">new track</span>}
              </div>
            );
          })}
          {layers.map((layer, i) => (
            <div
              key={layer.id}
              className={cn("flex items-center gap-1.5 border-b border-border px-2 text-xs", isSelected(selection, "layer", layer.id) && "bg-primary/10")}
              style={{ height: AUDIO_LANE_HEIGHT }}
              onClick={(e) => select("layer", layer.id, e.shiftKey || e.metaKey || e.ctrlKey)}
              onContextMenu={(e) => openMenu("layer", layer.id, e)}
            >
              <span className="h-6 w-1 shrink-0 rounded-full" style={{ backgroundColor: LANE_COLORS[layer.colorIndex % LANE_COLORS.length] }} />
              <span className="min-w-0 flex-1 truncate font-semibold">A{i + 1} · {layer.name}</span>
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
                  remove(only("layer", layer.id));
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
        >
          <div className="relative" style={{ width: contentWidth, minHeight: "100%" }} onPointerDown={onMarqueeDown}>
            <TimeRuler duration={end} width={contentWidth} scale={scale} onSeek={player.seek} />
            <VideoLanes
              clips={clips}
              trackCount={tracks}
              scale={scale}
              width={contentWidth}
              selection={selection}
              snap={snap}
              drag={clipDrag}
              onSelect={(id, additive) => select("clip", id, additive)}
              onChange={updateClip}
              onRemove={(id) => remove(only("clip", id))}
              onAddAsLayer={(clip) => addLayerFromFile(clip.file, clip.originalDuration, clip.startAt)}
              onDownload={(clip) => downloadFile(clip.file, clip.file.name)}
              onContextMenu={(id, e) => openMenu("clip", id, e)}
            />
            {layers.map((layer) => (
              <div key={layer.id} className="relative border-b border-border/60" style={{ height: AUDIO_LANE_HEIGHT, width: contentWidth }}>
                <LayerBlock
                  layer={layer}
                  timelineEnd={end}
                  scale={scale}
                  selected={isSelected(selection, "layer", layer.id)}
                  snap={snap}
                  drag={layerDrag}
                  onSelect={(additive) => select("layer", layer.id, additive)}
                  onChange={(patch) => updateLayer(layer.id, patch)}
                  onContextMenu={(e) => openMenu("layer", layer.id, e)}
                />
              </div>
            ))}
            {layers.length === 0 && clips.length > 0 && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-3 py-3 text-xs text-muted-foreground">
                Drop music, voiceover, or a video here to add an audio layer at that point in time.
              </motion.p>
            )}
            {marquee && (
              <div
                className="pointer-events-none absolute z-20 rounded border border-primary bg-primary/10"
                style={{
                  left: Math.min(marquee.x0, marquee.x1),
                  top: Math.min(marquee.y0, marquee.y1),
                  width: Math.abs(marquee.x1 - marquee.x0),
                  height: Math.abs(marquee.y1 - marquee.y0),
                }}
              />
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
            className="absolute w-56 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl"
            style={{ left: Math.min(menu.x, window.innerWidth - 236), top: Math.min(menu.y, window.innerHeight - 280) }}
          >
            {selectionCount(menu.target) > 1 && (
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{selectionCount(menu.target)} items</p>
            )}
            {menuItem("Split at playhead", <Scissors size={12} />, () => splitAtPlayhead(menu.target))}
            {menuItem("Duplicate", <Copy size={12} />, () => repeat(menu.target, 1))}
            {menuItem(`Repeat ×${repeatCount}`, <Repeat size={12} />, () => repeat(menu.target, repeatCount))}
            {menuSingleClip && (
              <>
                <div className="my-1 h-px bg-border" />
                {menuItem("Use as audio layer", <AudioLines size={12} />, () => addLayerFromFile(menuSingleClip.file, menuSingleClip.originalDuration, menuSingleClip.startAt))}
                {menuItem("Save source to disk", <Download size={12} />, () => downloadFile(menuSingleClip.file, menuSingleClip.file.name))}
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
