import type { AudioLayer } from "@/types/audioLayer";
import { layerSpan } from "@/lib/timeline";

interface LayerNode {
  el: HTMLAudioElement;
  url: string;
  source: MediaElementAudioSourceNode | null;
  gain: GainNode | null;
  layer: AudioLayer;
  span: number;
}

const DRIFT_TOLERANCE = 0.15; // seconds

/**
 * Live preview of the audio mix: one persistent <audio> element per layer,
 * routed through a Web Audio GainNode, positioned against the project
 * timeline clock. Export via ffmpeg remains the source of truth — this is a
 * best-effort in-sync preview (typically within ~50–150 ms).
 */
export class MixPreviewEngine {
  private ctx: AudioContext | null = null;
  private mainEl: HTMLMediaElement | null = null;
  private mainSource: MediaElementAudioSourceNode | null = null;
  private mainGain: GainNode | null = null;
  private mainVolume = 1;
  private nodes = new Map<string, LayerNode>();

  /**
   * Must run synchronously inside a user gesture (the play click): browsers
   * only allow creating/resuming an AudioContext there.
   */
  unlock() {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") void this.ctx.resume();
    this.connectAll();
  }

  attachMain(el: HTMLMediaElement | null) {
    if (el === this.mainEl) return;
    this.mainSource?.disconnect();
    this.mainGain?.disconnect();
    this.mainSource = null;
    this.mainGain = null;
    this.mainEl = el;
    if (this.ctx && el) this.connectAll();
  }

  setMainVolume(volume: number) {
    this.mainVolume = volume;
    if (this.mainGain) this.mainGain.gain.value = volume;
  }

  /** Reconcile the engine's elements with the store's layers. */
  syncLayers(layers: AudioLayer[], timelineEnd: number) {
    const ids = new Set(layers.map((l) => l.id));
    for (const [id, node] of this.nodes) {
      if (!ids.has(id)) this.dispose(node, id);
    }
    for (const layer of layers) {
      let node = this.nodes.get(layer.id);
      if (!node) {
        const url = URL.createObjectURL(layer.file);
        const el = new Audio(url);
        el.preload = "auto";
        node = { el, url, source: null, gain: null, layer, span: 0 };
        this.nodes.set(layer.id, node);
        if (this.ctx) this.connectNode(node);
      }
      node.layer = layer;
      node.span = layerSpan(layer, timelineEnd);
      if (node.gain) node.gain.gain.value = this.gainFor(layer);
    }
  }

  /**
   * Position and play/pause every layer against the timeline clock. Called on
   * play/pause/seek and every animation frame while playing — the per-frame
   * call is what wraps loops and stops play-once layers at their end.
   */
  sync(timelineTime: number, playing: boolean) {
    for (const node of this.nodes.values()) {
      const { layer, el, span } = node;
      const segment = layer.outPoint - layer.inPoint;
      const local = timelineTime - layer.startAt;
      const audible = playing && !layer.muted && segment > 0.01 && local >= 0 && local < span;

      if (!audible) {
        if (!el.paused) el.pause();
        continue;
      }

      const target = layer.inPoint + (layer.loop ? local % segment : local);
      if (Math.abs(el.currentTime - target) > DRIFT_TOLERANCE) el.currentTime = target;
      if (el.paused) void el.play().catch(() => {});
    }
  }

  destroy() {
    for (const [id, node] of this.nodes) this.dispose(node, id);
    this.mainSource?.disconnect();
    this.mainGain?.disconnect();
    void this.ctx?.close();
    this.ctx = null;
  }

  private gainFor(layer: AudioLayer) {
    return layer.muted ? 0 : layer.volume;
  }

  private connectAll() {
    if (!this.ctx) return;
    if (this.mainEl && !this.mainSource) {
      try {
        this.mainSource = this.ctx.createMediaElementSource(this.mainEl);
        this.mainGain = this.ctx.createGain();
        this.mainGain.gain.value = this.mainVolume;
        this.mainSource.connect(this.mainGain).connect(this.ctx.destination);
      } catch (err) {
        // An element can only ever be attached to one AudioContext; if this
        // one was already claimed, leave it routed as-is.
        console.error("Could not route main audio through the mix engine:", err);
      }
    }
    for (const node of this.nodes.values()) this.connectNode(node);
  }

  private connectNode(node: LayerNode) {
    if (!this.ctx || node.source) return;
    node.source = this.ctx.createMediaElementSource(node.el);
    node.gain = this.ctx.createGain();
    node.gain.gain.value = this.gainFor(node.layer);
    node.source.connect(node.gain).connect(this.ctx.destination);
  }

  private dispose(node: LayerNode, id: string) {
    node.el.pause();
    node.source?.disconnect();
    node.gain?.disconnect();
    node.el.removeAttribute("src");
    node.el.load();
    URL.revokeObjectURL(node.url);
    this.nodes.delete(id);
  }
}
