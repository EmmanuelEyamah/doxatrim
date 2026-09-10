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
- [x] Confirm cross-origin-isolation headers are set in Vite dev config (required for the multi-threaded core / `SharedArrayBuffer`)
- [x] Load ffmpeg core in a Web Worker, confirm it initializes (`useFFmpeg` hook, multi-thread core via `@ffmpeg/core-mt`)
- [x] Run one hardcoded trim command end-to-end (temporary debug button, confirmed working — removed once real pipeline lands)

**Import**
- [x] Build `ImportZone` — drag-drop + file picker fallback
- [x] Client-side file type/extension validation (video: mp4/mov/webm, audio: mp3/wav/m4a)
- [x] Reject/warn on mixing video + audio-only files at import time
- [x] Generate thumbnail (video) — eager, on import
- [x] Show flat placeholder bar for audio (waveform is optional for v1)

**Trim Editor**
- [x] `PreviewPlayer` — `<video>`/`<audio>` element wired to clip source
- [x] Scrubber/playhead synced to playback (native media element controls)
- [x] Draggable in/out range handles
- [x] Numeric time inputs (mm:ss.ms) as alternative to dragging
- [x] "Set in/out at playhead" buttons
- [x] Playback loop/stop constrained to trimmed range
- [x] Trim changes reflected immediately in the clip's timeline entry

**Timeline**
- [x] `ClipTimeline` + `ClipBlock` components
- [x] Drag-to-reorder clips
- [x] Remove clip from project (not from disk)
- [x] Running total duration display
- [x] Click clip → loads into Trim Editor

**Export**
- [x] Trim each clip to in/out range via ffmpeg (`lib/ffmpeg/trim.ts`, stream copy)
- [x] Concat in timeline order — stream copy first, automatic re-encode fallback on nonzero exit code (`lib/ffmpeg/concat.ts`) — decided: auto re-encode, not warn-and-block
- [x] Progress indicator wired to ffmpeg.wasm progress events
- [x] Output preview + download link on completion
- [x] Format-mismatch warning before export if file extensions differ across clips (heuristic — not a true codec/resolution probe)

**Error & scale handling**
- [x] Clear error state if ffmpeg hits memory limits, instead of silent failure (`describeError` in `ExportPanel`)
- [x] Loading states: file import, ffmpeg core first-load, export processing (trim preview relies on native `<video>`/`<audio>` loading)
- [ ] Manual test with a large file (500MB+) to see where it actually breaks — **needs you to run this**, not something I can verify

## 18. Autonomous Session Notes (2026-08-30)

You asked me to push ahead on Tier A/B/C while you were out. Here's exactly what shipped, what's stubbed, and what's genuinely blocked — read this before testing so you know what to expect.

### Shipped and testable now

**Background audio mixing** (a scoped slice of Tier C, not the full multi-track timeline):
- New "Background audio" panel appears once you have at least one clip in the timeline — lets you add one background music/voiceover track (mp3/wav/m4a), trim it (reuses the same `TrimEditor`, now generalized to accept `duration`/`inPoint`/`outPoint`/`onTrimChange` instead of being tied to the main clip store), and set independent volume sliders for the background track and the main timeline.
- On export, if a background track is set, `lib/ffmpeg/mix.ts` loops/trims it to match the main output's duration and mixes it in via ffmpeg's `amix` filter at your chosen volumes — this directly answers your "background music one is too loud" ask from earlier.
- This is **not** the full Tier C (no multiple video tracks, no picture-in-picture, no per-track mute/solo) — just enough to solve the specific mixing problem you described.

**URL import** (part of Tier B):
- New "Import from URL" box above the timeline, gated behind a required "I own this content or have the rights to use it" checkbox — per the v1 spec's stance that this is an internal tool, not a public downloader.
- Backend: `server/` — a small Express server (`server/index.js`) that shells out to `yt-dlp` (already installed on this machine at `/opt/homebrew/bin/yt-dlp`), downloads to a temp dir, streams the file back, and cleans up. Has a 2GB size cap and a 5-minute timeout.
- **I tested this end-to-end for real** — not just type-checked. Downloaded a real sample video through the endpoint and confirmed the file arrives intact (788KB MP4, correct headers, temp dir cleaned up after).
- **To use it, the server has to be running**: `cd server && npm install && npm run dev` (I already ran `npm install` and left it running in the background — port **4321** — but it won't survive a machine restart, so start it again if it's not responding). Frontend is hardcoded to `http://localhost:4321` for now — that's a dev-only shortcut, would need to become an env var for a real deploy.

### Explicitly NOT built — blocked on things only you can provide

**Tier A (accounts, saved projects, real backend)** — did not build this. It needs actual decisions and credentials I don't have: which database, which object storage provider (S3/R2/Supabase), an OAuth app registered under the DOXA domain for sign-in. Building a backend with fake/local stand-ins for all of that would produce something that looks done in the file tree but doesn't reflect a real deployable choice — I didn't think that was useful to hand you.

**Tier B cloud pickers (Google Drive / Dropbox import)** — did not build this. Both need an OAuth app registered in *your* Google Cloud / Dropbox developer console, which only you can create (I can't self-serve a client ID).

**Full Tier C (multiple tracks, PiP, mute/solo)** — did not attempt this. It's the biggest data-model rework in the whole roadmap (§13, §15) and risky to do unsupervised without you around to redirect me if the direction's wrong. What shipped instead (background audio mixing) solves the concrete problem you raised without touching the core timeline model.

### What to test when you're back

1. Background audio: add a main clip, add a background track, adjust both volume sliders, export, confirm the mix sounds right (main audible, background sitting under it, not clipping/distorted).
2. URL import: confirm `cd server && npm run dev` starts cleanly, paste a URL you have rights to, check the box, import, confirm it lands in the timeline like a normal clip.
3. The original outstanding item: large file (500MB+) export test — still not done, still needs you.

## 19. Multi-Track Studio (Tier C) — shipped 2026-09-10

Direction change from you: a proper editing-software UI ("CapCut desktop kind of UI, production grade") with real multi-track audio mixing, not the stacked-cards v1 page. Built in five phases; the engine half is verified against native ffmpeg with synthetic fixtures (`silencedetect`/`ffprobe` assertions), the browser half needs your eyes.

### What's there now

- **Editor shell** (`src/components/shell/`): top bar (project name, theme, **Export** dialog) · **media bin** left (Media tab: drop zone + asset grid, drag assets onto the timeline; Link tab: URL/playlist import; "Auto-add imports to timeline" switch) · **monitor** center (plays the whole sequence, ⏮ ▶ ⏭, scrubber with clip boundaries, Space) · **inspector** right (clip → trim + actions; layer → full layer editor with Start here / End here; nothing → project summary).
- **Lane timeline** (`src/components/timeline/`): ruler, playhead (drag to scrub, follows playback), V1 lane with clip blocks (drag to reorder, hover actions), one lane per audio layer (drag to move, drag edges to trim/extend, loop repeat hairlines, snap to clip edges/other layers/playhead — Shift bypasses), zoom slider + fit, resizable height, drop files or bin assets directly where you want them. Keys: Space play/pause · ←/→ nudge a layer (Shift = 1 s) · I / O mark in/out on the selected clip · Delete.
- **Audio layers** (`useAudioLayerStore`, `types/audioLayer.ts`): any number, each with source trim, start time, optional end, **loop to fill**, volume, mute. Sources can be audio *or video* files (only the audio is used) — "Use as audio layer" on any clip/asset. Replaces the single background track.
- **Live mixed preview** (`lib/audioEngine.ts`, `hooks/useMixPreview.ts`): every layer plays in sync with the monitor through Web Audio — enters at its start, loops, at its volume; volume/mute changes are audible live. Best-effort sync (~50–150 ms); export is the source of truth.
- **Mixing engine** (`lib/ffmpeg/mixArgs.ts` + `mix.ts`): N-track ffmpeg graph (`atrim` → `adelay` → `volume` → `amix normalize=0`), loop via `-stream_loop`, silent-video fallback via `anullsrc`. **Video is stream-copied — never re-encoded** by the mix. Layer pre-trims are frame-accurate (output-side `-ss`; a real off-by-one-second bug was caught and regression-guarded during testing).
- **Export as audio**: any video project → mp3/wav (the "save it to my phone as audio" case), works for YouTube and local files alike.
- Quality: the only re-encode path (mismatched clip codecs) now uses `crf 18` + `+faststart`. Warning when audio-layer sources exceed ~500 MB (wasm memory).
- **Cutting & repeating on the timeline** (added same day, from your feedback): **Split at playhead** (`S`), **Duplicate** (`⌘/Ctrl+D`) and **Repeat ×N** for clips *and* audio layers — from the timeline toolbar, the right-click menu on any block, or the inspector. Splits are free (both halves point at the same file). Typical flow: trim the section you want → Repeat ×10 → Export as audio.
- **Resizable panels**: drag the gutters beside the media bin and inspector (widths remembered), plus the timeline's height handle. Inspector and bin restyled as flat, dense editor panels (label/control rows, section dividers) instead of stacked cards.

### Known limitations (honest list)

- **Main-clip trims are keyframe-snapped** (that's what keeps video untouched) — a clip can start up to a GOP early in the export, which also shifts layer placement slightly on later clips. Fix in progress: measure each trimmed segment's real length and build export timing from that.
- Preview sync is approximate; short blip possible when playback crosses a clip boundary (source swap).
- No undo/redo yet (needs a history layer). No mobile layout (desktop editor by nature).
- Clip-to-clip transitions, PiP/overlay video, text — still Tier D.
