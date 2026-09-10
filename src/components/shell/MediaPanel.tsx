import { useState } from "react";
import { motion } from "framer-motion";
import { AudioLines, Download, FolderOpen, Link2, Music, Plus, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/formatTime";
import { downloadFile } from "@/lib/download";
import { addAssetsToTimeline } from "@/lib/importFiles";
import { useAssetStore } from "@/stores/useAssetStore";
import { useAudioLayerStore } from "@/stores/useAudioLayerStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { ImportZone } from "@/components/ImportZone";
import { UrlImport } from "@/components/UrlImport";
import { Switch } from "@/components/Switch";
import { ASSET_DRAG_TYPE } from "@/components/timeline/MixTimeline";
import type { Asset } from "@/types/asset";

type Tab = "media" | "link";

interface MediaPanelProps {
  onLayerAdded: (layerId: string) => void;
}

const AssetCard = ({ asset, onLayerAdded }: { asset: Asset; onLayerAdded: (id: string) => void }) => {
  const removeAsset = useAssetStore((s) => s.removeAsset);
  const addLayer = useAudioLayerStore((s) => s.addLayer);

  const iconButton =
    "flex h-6 w-6 items-center justify-center rounded text-white/80 hover:bg-white/15 hover:text-white";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      {/* Native HTML5 drag lives on a plain element: on a motion.div, onDragStart is
          Framer's gesture handler (no dataTransfer), so the asset id would never be sent. */}
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id);
          e.dataTransfer.effectAllowed = "copy";
        }}
        className="group relative cursor-grab overflow-hidden rounded-md border border-border/60 bg-background active:cursor-grabbing"
        title="Drag onto the timeline"
      >
        <div className="flex aspect-video items-center justify-center bg-black">
          {asset.thumbnailUrl ? (
            <img src={asset.thumbnailUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <Music size={18} className="text-muted-foreground" />
          )}
        </div>
        <div className="flex items-center justify-between gap-2 px-2 py-1 text-[11px]">
          <span className="truncate">{asset.name}</span>
          <span className="shrink-0 font-mono text-muted-foreground">{formatTime(asset.duration).slice(0, 5)}</span>
        </div>
        <div className="absolute right-1 top-1 hidden gap-0.5 rounded-md bg-black/70 p-0.5 group-hover:flex">
          <button
            type="button"
            title="Add to timeline"
            className={iconButton}
            onClick={() => {
              const { rejected } = addAssetsToTimeline([asset]);
              for (const { reason } of rejected) toast.error(reason);
            }}
          >
            <Plus size={12} />
          </button>
          <button
            type="button"
            title="Add as audio layer"
            className={iconButton}
            onClick={() => onLayerAdded(addLayer(asset.file, asset.duration).id)}
          >
            <AudioLines size={12} />
          </button>
          <button type="button" title="Save to disk" className={iconButton} onClick={() => downloadFile(asset.file, asset.name)}>
            <Download size={12} />
          </button>
          <button
            type="button"
            title="Remove from bin (timeline keeps its copies)"
            className={cn(iconButton, "hover:bg-destructive/80")}
            onClick={() => removeAsset(asset.id)}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </motion.div>
  );
};

export const MediaPanel = ({ onLayerAdded }: MediaPanelProps) => {
  const [tab, setTab] = useState<Tab>("media");
  const assets = useAssetStore((s) => s.assets);
  const autoAddImports = useSettingsStore((s) => s.autoAddImports);
  const setAutoAddImports = useSettingsStore((s) => s.setAutoAddImports);

  const tabClass = (active: boolean) =>
    cn(
      "flex h-8 items-center gap-1.5 border-b-2 px-3 text-xs font-semibold transition-colors",
      active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
    );

  return (
    <aside className="flex min-h-0 flex-col bg-sidebar">
      <div className="flex h-10 shrink-0 items-end border-b border-sidebar-border px-1">
        <button type="button" onClick={() => setTab("media")} className={tabClass(tab === "media")}>
          <FolderOpen size={13} /> Media
        </button>
        <button type="button" onClick={() => setTab("link")} className={tabClass(tab === "link")}>
          <Link2 size={13} /> Link
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "media" ? (
          <div className="flex flex-col gap-3 p-3">
            <ImportZone compact />
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Auto-add imports to timeline</span>
              <Switch checked={autoAddImports} onChange={setAutoAddImports} label="Auto-add imports to timeline" />
            </div>
            <div className="border-t border-sidebar-border" />
            {assets.length === 0 ? (
              <p className="py-8 text-center text-[11px] text-muted-foreground">
                Media bin is empty — import files here or from a link.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {assets.map((asset) => (
                  <AssetCard key={asset.id} asset={asset} onLayerAdded={onLayerAdded} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="p-3">
            <UrlImport />
          </div>
        )}
      </div>
    </aside>
  );
};
