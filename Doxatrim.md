# DoxaTrim — Project Specification

## 1. Overview

DoxaTrim is a **client-side, browser-based media editor** for trimming and joining video and audio files. No backend, no uploads to a server — all processing happens in the user's browser via `ffmpeg.wasm`. The user drags in one or more media files, trims sections on a timeline, reorders/joins clips, and exports the result as a downloadable file.

**Not in scope for v1**: importing from YouTube or any external URL. Import is local-file-only (drag-drop or file picker). This is a deliberate decision — do not build a URL-import feature.

## 2. Tech Stack

- **Framework**: React 18 + TypeScript (all React code in `.tsx`)
- **Bundler**: Vite
- **Styling**: Tailwind CSS
- **Media processing**: `@ffmpeg/ffmpeg` + `@ffmpeg/util` (ffmpeg.wasm) — runs entirely client-side in a Web Worker
- **State management**: React state/context is sufficient for v1 — no Redux needed unless complexity demands it
- **File handling**: native File API, drag-and-drop via HTML5 DnD or a lightweight lib
- **No server, no database, no auth** for v1

## 3. Core User Flow

1. User drops/selects one or more files (video: mp4, mov, webm; audio: mp3, wav, m4a)
2. Each file becomes a **clip** added to a project-level **clip list / timeline**
3. User selects a clip → sees it in a preview player (`<video>` or `<audio>`) with a **trim bar** showing in/out handles
4. User drags in/out handles (or types timestamps) to define the section of that clip to keep
5. User can reorder clips in the timeline (drag to reorder)
6. User can add more clips at any point
7. User hits **Export** → ffmpeg.wasm trims each clip to its selected range, then concatenates them in timeline order into one output file
8. Output is offered as a downloadable file (blob URL, `<a download>`)

Video and audio clips should NOT be mixed in the same join operation in v1 (keep this constraint explicit and validated — show an error if user tries to join a video clip with an audio-only clip).

## 4. Feature Breakdown

### 4.1 Import

- Drag-and-drop zone + fallback file input button
- Multi-file select supported
- Validate file type/extension client-side before accepting
- Show file name, duration (once loaded), and thumbnail (video) or waveform (audio, optional for v1 — can be a flat placeholder bar if waveform generation is too heavy)

### 4.2 Clip List / Timeline (Full multi-clip version)

- Horizontal list/track of clips in current project, in join order
- Each clip shown as a block with: thumbnail, filename, duration, trimmed duration
- Drag to reorder clips
- Click a clip to load it into the preview/trim editor
- Remove clip from list (doesn't delete original file, just removes from project)
- Running total duration of the final output shown at all times

### 4.3 Trim Editor (per clip)

- Video/audio preview player
- Scrubber/playhead synced to playback
- Two draggable handles on a range slider representing in-point and out-point
- Numeric time inputs as an alternative to dragging (mm:ss.ms)
- "Set in point at playhead" / "Set out point at playhead" buttons
- Live preview constrained to the trimmed range (playback loops or stops at out-point)
- Changes to trim range update that clip's entry in the timeline (trimmed duration reflected immediately)

### 4.4 Join / Concatenation

- Clips are joined in the order they appear in the timeline
- Uses ffmpeg concat (stream copy where codecs match, re-encode fallback where they don't)
- Must handle clips with different resolutions/codecs gracefully — either normalize during export or clearly warn the user before export if formats are mismatched

### 4.5 Export

- "Export" button triggers ffmpeg.wasm processing pipeline:
  1. Trim each clip to its in/out range
  2. Concatenate trimmed clips in order
  3. Output as single file
- Show progress indicator (ffmpeg.wasm exposes progress events — surface them)
- On completion: preview the final result + download button
- Export format: mp4 for video projects, mp3/wav for audio projects (match input type; ask user if ambiguous)

### 4.6 Audio Support

- Same import → trim → join → export flow applies to audio-only files
- UI should adapt: waveform/flat bar instead of video thumbnail, `<audio>` player instead of `<video>`

## 5. Non-Functional Requirements

- **No file leaves the browser** — reinforce this in UI copy (privacy/trust angle)
- Handle reasonably large files (up to ~500MB–1GB) without crashing the tab; if ffmpeg.wasm memory limits are hit, show a clear error rather than silently failing
- ffmpeg.wasm must run in a Web Worker so the UI thread doesn't freeze during processing
- Responsive enough for a laptop screen — mobile support is not a v1 requirement
- Loading/progress states for: file import, ffmpeg core loading (first load), trim preview, export processing

## 6. Suggested Project Structure

```
src/
  components/
    ImportZone.tsx
    ClipTimeline.tsx
    ClipBlock.tsx
    TrimEditor.tsx
    PreviewPlayer.tsx
    ExportPanel.tsx
  hooks/
    useFFmpeg.ts
    useClips.ts
  lib/
    ffmpeg/
      trim.ts
      concat.ts
      loadFFmpeg.ts
    fileValidation.ts
  types/
    clip.ts
    project.ts
  App.tsx
  main.tsx
```

## 7. Data Model (starting point)

```ts
interface Clip {
  id: string;
  file: File;
  type: "video" | "audio";
  originalDuration: number; // seconds
  inPoint: number; // seconds
  outPoint: number; // seconds
  thumbnailUrl?: string;
  order: number;
}

interface Project {
  clips: Clip[];
  outputFormat: "mp4" | "mp3" | "wav";
}
```

## 8. Explicit Non-Goals for v1

- No YouTube or any external URL import
- No cloud storage, accounts, or saved projects across sessions
- No transitions, effects, filters, text overlays, or color grading
- No mobile-optimized UI
- No mixing video + audio-only clips in a single join

## 9. Build Order (suggested milestones)

1. Scaffold Vite + React + TS + Tailwind project
2. Integrate ffmpeg.wasm, confirm it loads and can run a basic trim command on one hardcoded file
3. Build ImportZone + single-clip preview player
4. Build TrimEditor (in/out handles) for one clip, wire to ffmpeg trim
5. Extend to multi-clip ClipTimeline with reordering
6. Build concat/join pipeline across trimmed clips
7. Build ExportPanel with progress + download
8. Add audio-file support end-to-end
9. Polish: error states, format-mismatch warnings, large-file handling

---

# Part II — Full Version (Internal DOXA Tool)

Everything below is the target state once v1 (pure client-side trim/join) is working. It's organized in tiers, not a strict sequence — pick a tier as the next milestone rather than treating this as one giant build.

## 10. Vision

DoxaTrim v1 proves the trim/join loop works entirely in-browser. The full version turns it into DOXA's internal editing tool for producing and repurposing content — team members log in, keep projects across sessions, pull source footage from wherever it lives, and do real multi-track editing (music/voiceover over video, captions, transitions) without leaving the browser. Client-side ffmpeg.wasm stays for the fast/private path on small clips; a real server-side ffmpeg handles anything wasm can't (large files, heavy re-encodes, effects that need real compute).

## 11. Architecture (Hybrid)

- **Client (unchanged core idea)**: React app does trim preview, timeline editing, and can still do the full pipeline client-side for small/simple jobs (same as v1).
- **Server render path**: for large files, multi-track exports, effects, or anything the client flags as too heavy, the job is handed to a backend render service running real ffmpeg (not wasm) — no wasm memory ceiling, faster, supports the full ffmpeg filter graph (crossfades, overlays, filters).
- **Job queue**: render jobs go through a queue (BullMQ + Redis, or equivalent) so the UI can poll/subscribe for progress instead of holding an open request during a multi-minute render.
- **Storage**: uploaded source files and rendered outputs live in object storage (S3-compatible — S3, R2, or Supabase Storage), not the browser only. Enables saved projects and re-export without re-uploading.
- **Client decides the path**: small file + simple trim/join → client-side wasm (instant, private, no upload). Large file, multi-track, or effects → server path (upload required, slower, more capable). Surface this tradeoff to the user rather than hiding it — e.g. "This will process in your browser" vs "This will upload and render on our servers."

## 12. Tech Stack Additions (on top of v1's stack, aligned to DOXA's standard frontend stack)

| Concern | Choice |
|---|---|
| Frontend framework | Vite + React 19 + TS (upgrade from v1's React 18) |
| Routing | TanStack Router (needed now — dashboard, project list, editor, account pages) |
| Server state | TanStack React Query (project CRUD, render job status polling) |
| Client state | Zustand (editor/timeline state, per-project) |
| Styling | Tailwind CSS v4, DOXA color system (`--primary: #2979ff`, dark mode from day one) |
| Animation | Framer Motion |
| Icons | lucide-react |
| Backend | Node.js (Fastify or Express) |
| Database | Postgres (projects, users, render jobs metadata) |
| Object storage | S3-compatible bucket for source files + rendered outputs |
| Queue | BullMQ + Redis for render jobs |
| Server-side media | Real ffmpeg (native binary, not wasm) in the render worker |
| Auth | Internal-only — Google SSO restricted to the DOXA domain, or a simple invite/allow-list. No public signup. |
| Cloud import | Google Drive / Dropbox picker SDKs |
| URL import | yt-dlp or similar on the backend — **only for content DOXA owns or has rights to use**; this is an internal tool, not a general YouTube ripper, and should say so in the UI |

## 13. Feature Breakdown (by tier)

### Tier A — Accounts, Projects, Persistence
- Internal auth (DOXA-domain SSO or allow-list), no public signup
- Save/load projects across sessions (source file refs, trim points, track layout stored in Postgres; media itself in object storage)
- Project list/dashboard (matches DOXA's standard sidebar + card-grid dashboard pattern)
- Autosave on edit; manual "duplicate project" for versioning
- Project history — see prior exports of a project, not just the current state

### Tier B — Import Expansion
- Cloud import: Google Drive / Dropbox file picker in addition to drag-drop
- URL import: paste a YouTube (or other) URL, backend fetches and ingests it as a clip — gated to internal use, with an explicit rights/ownership checkbox in the UI
- Same file-type validation and video/audio-type separation rules as v1 carry forward

### Tier C — Multi-Track Timeline
- Move from v1's flat sequential clip list to a real layered timeline: one or more video tracks + one or more audio tracks (music/voiceover overlay on top of video)
- Picture-in-picture / overlay clips (secondary video positioned over primary)
- Per-track mute/solo, volume control on audio tracks
- This is the biggest architectural jump from v1 — the `Clip[]` sequential model needs to become a proper track/timeline model (start/end position on a timeline axis, not just join-order)

### Tier D — Effects, Transitions, Text
- Transitions between clips: cut (default), crossfade, fade-to-black — rendered server-side via ffmpeg filter graph
- Basic color adjustments: brightness/contrast/saturation
- Text overlays: positioned text with in/out timing, basic font/size/color controls
- DOXA branding overlay: a saved "add DOXA watermark/logo" preset for exports meant for external use

### Tier E — Export & Delivery
- Export presets by destination: 16:9 (YouTube), 9:16 (Shorts/Reels/TikTok), 1:1 (square), matching common social crops — auto-crop/pad logic, not just raw resolution change
- Batch export: same project, multiple preset outputs in one job
- Render progress via job status (queue-backed), not just a client-side progress bar

### Tier F — AI Layer (stretch, evaluate after A–E are solid)
- Auto-captions/subtitles (Whisper or similar), burned in or as a toggle-able overlay track
- Silence/dead-air auto-detection and trim suggestions
- Auto-highlight detection for long-form → short-form repurposing (flag likely "clip-worthy" moments for a human to confirm, not fully automated cutting)

## 14. Data Model v2 (sketch)

```ts
interface Project {
  id: string;
  ownerId: string;
  title: string;
  tracks: Track[];
  createdAt: string;
  updatedAt: string;
}

interface Track {
  id: string;
  type: "video" | "audio" | "overlay" | "text";
  clips: TimelineClip[];
  muted?: boolean;
  volume?: number; // 0-1, audio tracks
}

interface TimelineClip {
  id: string;
  sourceId: string; // ref to SourceFile
  trackStart: number; // position on the timeline, seconds
  inPoint: number;
  outPoint: number;
  transitionIn?: "cut" | "crossfade" | "fade";
}

interface SourceFile {
  id: string;
  storageKey: string; // object storage path
  originalName: string;
  type: "video" | "audio";
  duration: number;
  origin: "upload" | "drive" | "dropbox" | "url";
}

interface RenderJob {
  id: string;
  projectId: string;
  status: "queued" | "processing" | "done" | "failed";
  preset: "16:9" | "9:16" | "1:1";
  progress: number; // 0-1
  outputStorageKey?: string;
  error?: string;
}
```

## 15. Suggested Phase Order

1. **v1 as-is** (client-only trim/join) — ship this first, it's a complete usable tool on its own
2. **Tier A**: add auth + Postgres + object storage + saved projects, still single-track, still client-side render — this is the architectural pivot (adds a real backend) and should land before anything else server-side
3. **Server render path**: stand up the ffmpeg render worker + queue, route large/complex jobs to it — proves the hybrid architecture end-to-end on the existing single-track model
4. **Tier C**: multi-track timeline — the biggest UI/data-model rework, do it once the backend is stable
5. **Tier D + E**: effects/transitions/text, export presets — additive on top of the multi-track model
6. **Tier B**: cloud/URL import — can actually slot in earlier (after Tier A) if it's higher priority than multi-track; it's independent of the timeline rework
7. **Tier F**: AI layer — evaluate last, only once the core editing product is solid

## 16. Brand & Visual Identity

DoxaTrim inherits DOXA's standard system exactly — no separate identity to design or maintain.

**Color** (from DOXA's global design system):

| Token | Light | Dark |
|---|---|---|
| Background | `#ffffff` | `#000527` |
| Foreground | `#000527` | `#ffffff` |
| Card | `#ffffff` | `#0a0f3d` |
| Primary (all interactive elements) | `#2979ff` | `#2979ff` |
| Primary hover | `#1e62d9` | `#1e62d9` |
| Secondary | `#000527` | `#1e3a8a` |
| Muted | `#f5f5f5` | `#1e293b` |
| Border | `#e5e7eb` | `rgba(41,121,255,0.1)` |
| Success (export complete) | `#10b981` | `#10b981` |
| Warning (format mismatch) | `#f59e0b` | `#f59e0b` |
| Destructive (render/memory error) | `#ef4444` | `#ef4444` |

**Font**: Satoshi, all weights, self-hosted — same as every other DOXA tool. No mixing fonts.

**Logo**: generate the icon mark only via AI image gen (text/wordmarks from image models are unreliable), then set "DoxaTrim" as a Satoshi Black wordmark next to it in code — don't rely on AI to render the type.

Prompt for the icon mark (works in ChatGPT/DALL·E, Midjourney, or similar):

> Minimal flat vector app icon, rounded-square tile, dark navy background (#000527), centered symbol combining a play-triangle with video trim in/out bracket marks on either side (like editing timeline handles), symbol in bright blue (#2979ff) with subtle lighter blue accent (#60a5fa), no text, no gradients, no shadows, clean geometric shape, works at small sizes (favicon/app icon scale), flat modern SaaS icon style, centered composition, transparent or solid navy background, square 1:1 aspect ratio.

Variant for a light-background version (for use on white):

> Minimal flat vector app icon, rounded-square tile, white background, centered symbol combining a play-triangle with video trim in/out bracket marks on either side, symbol in bright blue (#2979ff), no text, no gradients, no shadows, clean geometric shape, flat modern SaaS icon style, square 1:1 aspect ratio.

## 17. v1 Build Checklist

**Setup**
- [x] Scaffold Vite + React 19 + TS project
- [x] Install and configure Tailwind CSS v4 (`@tailwindcss/vite`)
- [x] Set up `@/` path alias
- [x] Add DOXA color tokens (§16) as CSS variables, light + dark
- [x] Self-host Satoshi font files, add `@font-face` rules (copied from AltiorCRM)
- [x] Build theme toggle (`.dark` class + Zustand-persisted preference)
- [x] Add favicon/app icon (logo-dark.png as `public/favicon.png`)

**ffmpeg.wasm integration**
- [x] Install `@ffmpeg/ffmpeg` + `@ffmpeg/util`
- [ ] Confirm cross-origin-isolation headers are set in Vite dev config (required for the multi-threaded core / `SharedArrayBuffer`)
- [ ] Load ffmpeg core in a Web Worker, confirm it initializes
- [ ] Run one hardcoded trim command end-to-end (prove the pipeline before building UI around it)

**Import**
- [ ] Build `ImportZone` — drag-drop + file picker fallback
- [ ] Client-side file type/extension validation (video: mp4/mov/webm, audio: mp3/wav/m4a)
- [ ] Reject/warn on mixing video + audio-only files at import time
- [ ] Generate thumbnail (video) — decide eager vs. lazy generation
- [ ] Show flat placeholder bar for audio (waveform is optional for v1)

**Trim Editor**
- [ ] `PreviewPlayer` — `<video>`/`<audio>` element wired to clip source
- [ ] Scrubber/playhead synced to playback
- [ ] Draggable in/out range handles
- [ ] Numeric time inputs (mm:ss.ms) as alternative to dragging
- [ ] "Set in/out at playhead" buttons
- [ ] Playback loop/stop constrained to trimmed range
- [ ] Trim changes reflected immediately in the clip's timeline entry

**Timeline**
- [ ] `ClipTimeline` + `ClipBlock` components
- [ ] Drag-to-reorder clips
- [ ] Remove clip from project (not from disk)
- [ ] Running total duration display
- [ ] Click clip → loads into Trim Editor

**Export**
- [ ] Trim each clip to in/out range via ffmpeg
- [ ] Concat in timeline order — stream copy where codecs match, re-encode fallback otherwise (decide now: auto re-encode vs. warn-and-block, per earlier feedback)
- [ ] Progress indicator wired to ffmpeg.wasm progress events
- [ ] Output preview + download link on completion
- [ ] Format-mismatch warning before export if codecs/resolutions differ

**Error & scale handling**
- [ ] Clear error state if ffmpeg hits memory limits, instead of silent failure
- [ ] Loading states: file import, ffmpeg core first-load, trim preview, export processing
- [ ] Manual test with a large file (500MB+) to see where it actually breaks
