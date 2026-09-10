import { getClipType, getExtension, timelineTypeConflict } from "@/lib/fileValidation";
import { generateVideoThumbnail, readMediaInfo } from "@/lib/media";
import { useAssetStore } from "@/stores/useAssetStore";
import { useClipStore, type ClipPlacement } from "@/stores/useClipStore";
import type { Asset } from "@/types/asset";
import type { Clip } from "@/types/clip";

export interface Rejection {
  file: File;
  reason: string;
}

export interface ImportOptions {
  origin: "local" | "url";
  sourceUrl?: string;
  /** Also place the new assets on the main sequence (the media bin always gets them). */
  addToTimeline: boolean;
  placement?: ClipPlacement;
}

export interface ImportResult {
  assets: Asset[];
  clips: Clip[];
  rejected: Rejection[];
}

export async function buildAsset(file: File, origin: Asset["origin"], sourceUrl?: string): Promise<Asset> {
  const type = getClipType(file);
  if (!type) throw new Error(`Unsupported file type (.${getExtension(file) || "unknown"})`);
  const { duration, width, height } = await readMediaInfo(file, type);
  const thumbnailUrl = type === "video" ? await generateVideoThumbnail(file) : undefined;
  return { id: crypto.randomUUID(), file, name: file.name, type, duration, width, height, thumbnailUrl, origin, sourceUrl };
}

/** A fresh timeline instance of an asset (the same asset can be placed more than once). */
export function clipFromAsset(asset: Asset): Clip {
  return {
    id: crypto.randomUUID(),
    file: asset.file,
    type: asset.type,
    originalDuration: asset.duration,
    inPoint: 0,
    outPoint: asset.duration,
    startAt: 0,
    track: 0,
    thumbnailUrl: asset.thumbnailUrl,
    width: asset.width,
    height: asset.height,
    order: 0,
    assetId: asset.id,
    transcript: asset.transcript,
  };
}

/** Places assets on the sequence, enforcing the single-type rule; returns what landed. */
export function addAssetsToTimeline(assets: Asset[], placement?: ClipPlacement): { clips: Clip[]; rejected: Rejection[] } {
  const clipStore = useClipStore.getState();
  let projectType = clipStore.clips[0]?.type ?? null;
  const clips: Clip[] = [];
  const rejected: Rejection[] = [];

  for (const asset of assets) {
    const conflict = timelineTypeConflict(projectType, asset.type);
    if (conflict) {
      rejected.push({ file: asset.file, reason: conflict });
      continue;
    }
    clips.push(clipFromAsset(asset));
    projectType = asset.type;
  }

  if (clips.length > 0) clipStore.addClips(clips, placement);
  return { clips, rejected };
}

/** Imports files into the media bin (and, if asked, onto the timeline). Shared by every import path. */
export async function importFiles(files: File[], opts: ImportOptions): Promise<ImportResult> {
  const assets: Asset[] = [];
  const rejected: Rejection[] = [];

  for (const file of files) {
    if (!getClipType(file)) {
      rejected.push({ file, reason: `Unsupported file type (.${getExtension(file) || "unknown"})` });
      continue;
    }
    try {
      assets.push(await buildAsset(file, opts.origin, opts.sourceUrl));
    } catch (err) {
      rejected.push({ file, reason: err instanceof Error ? err.message : "Could not read file" });
    }
  }

  if (assets.length > 0) useAssetStore.getState().addAssets(assets);

  let clips: Clip[] = [];
  if (opts.addToTimeline && assets.length > 0) {
    const placed = addAssetsToTimeline(assets, opts.placement);
    clips = placed.clips;
    rejected.push(...placed.rejected);
  }

  return { assets, clips, rejected };
}
