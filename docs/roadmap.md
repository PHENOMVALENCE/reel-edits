# Implementation roadmap

Each phase should land as a small pull request with its acceptance gate.

## Shipped: zero-cost phone app (`feat/phone-reel-maker`)

Everything runs in the browser and the app is hosted as a static Vercel Hobby site. It covers clip and photo import, three style presets, a frame-accurate rules planner with beat snapping, ten transitions and five effects, hook and ending titles, the Claude copy-paste planner, a shot editor, a live preview, and an in-browser 1080×1920 H.264/AAC MP4 export. The acceptance check was a headless-Chrome run that produced a 60.0 s, 1,800-frame MP4 from mixed portrait and landscape clips, two photos and a 120 BPM track, with 29 of 46 cuts on the beat.

## Next for the phone app

| Proposed pull request | Deliverable | Acceptance gate |
| --- | --- | --- |
| `feat/word-captions` | In-browser speech-to-text (Whisper in WebAssembly/WebGPU) with word-highlighted captions inside the safe area | Captions stay within ±2 frames of speech on three test clips and export at the same timing as the preview. |
| `feat/reference-presets` | Upload a reference reel; measure its cut rhythm, hook timing and shot lengths on the device and save a custom preset | A preset from a reference produces a measurably similar cut rhythm on unrelated footage. |
| `feat/smart-framing` | On-device face/subject detection so 9:16 crops and photo motion keep people in frame | No faces cut off in a landscape-heavy test set. |
| `feat/projects-on-device` | Save and reopen projects (IndexedDB), duplicate a reel at 60/90/120 s | Reopening restores the same timeline and media after a page reload. |
| `feat/more-looks` | Colour presets, speed ramps and GLSL transitions | Each new look renders identically in preview and export on Android Chrome and iOS Safari. |

## Server pipeline (later, only if needed)

The phases below describe the original server-side pipeline. They become relevant if phone rendering proves too slow or the app is used commercially.

| Proposed pull request | Deliverable | Acceptance gate |
| --- | --- | --- |
| `feat/render-spike` | Local Docker worker, licensed test media, frame-based timeline and FFmpeg ingest/export spike. | Produce a 60-second vertical MP4 from photos and mixed-orientation clips with music and readable titles. Verify duration, streams, framing and speech levels. |
| `feat/project-media-ingest` | Authenticated projects, private signed uploads, asset metadata, proxy generation and deletion. | Process supported assets through the browser and handle corrupt, large, silent and rotated inputs with actionable states. |
| `feat/timeline-editor-preview` | Versioned timeline, editable shot order and trims, caption overlay, starter effects and proxy preview. | Check matching cue and transition times in browser preview and export. Creator can correct a crop and adjust pacing. |
| `feat/ai-first-cut` | Timestamped keyframes, speech and beat cues, schema-constrained AI planner and rules fallback. | Generate valid timelines at 60, 90 and 120 seconds. Reject out-of-range trims and unsafe inputs. Compare AI drafts against the rules baseline. |
| `feat/reference-style-profiles` | Platform link cards, manual notes, authorized file analysis and versioned presets. | Analyze at least three eligible references and apply the same profile to unrelated footage. Compare pacing, caption treatment and transition choices against a no-reference baseline. |
| `feat/export-queue-and-benchmark` | Durable render queue, progress, cancellation, retry, private downloads and compute benchmark. | Kill a worker mid-render and recover without duplicate published output. Record wall time, peak RAM/disk, failure rate and cost across 60/90/120-second runs. Compare local Docker and a hosted worker, with Boat as an optional comparison. |

## First benchmark

Use three distinct sets of rights-cleared inputs. Include portrait and landscape shots, variable-frame-rate phone clips, still photos, voice, silence, and music licensed for export. Assess the hook, flow, framing, caption readability, audio balance, transition fit and time spent correcting the first draft. Log render and upload times separately. Use those results to decide what automation improves the workflow and which presets deserve more development.
