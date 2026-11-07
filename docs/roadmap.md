# Implementation roadmap

Each phase should land as a small pull request with its acceptance gate. Phase 1 is the next implementation.

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
