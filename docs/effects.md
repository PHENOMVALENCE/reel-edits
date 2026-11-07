# Effects and transitions catalog

Reviewed 7 November 2026. This catalog defines the CapCut-style vocabulary the planner and editor may use. The AI planner can only choose IDs from this list, and the validator rejects anything else. Each entry names the engine that implements it, so preview and export stay consistent.

## Engines

| Engine | Strength | Use it for |
| --- | --- | --- |
| [Remotion `@remotion/transitions`][rt] | React compositions shared by the browser preview and the server render. Built-in presentations include `fade`, `slide` (four directions), `wipe`, `flip` and `clockWipe`, driven by `linearTiming` or `springTiming`. Custom presentations are React components. | Default engine for transitions, text, captions, overlays and photo motion in the editor. |
| [FFmpeg `xfade`][xfade] | About 58 built-in transitions, including fades, wipes, slides, `smooth*`, `circleopen`, `radial`, `pixelize`, `hblur`, `squeeze*` and `zoomin`, plus custom expressions. | Ingest-time normalization, fast draft renders, and the render spike before Remotion is wired in. |
| [gl-transitions][glt] | A large open collection of GLSL transition shaders, each with its own author and license field. | Premium transitions (glitch, ripple, morph, cube) as custom Remotion presentations via WebGL. Check each shader's license before bundling. |

## Starter set (phase 1–3)

| ID | Category | Engine | Default | Notes |
| --- | --- | --- | --- | --- |
| `cut` | Transition | Both | 0 frames | The default between shots. |
| `beat_cut` | Transition | Both | 0 frames | A cut snapped to the nearest beat within ±3 frames. |
| `cross_dissolve` | Transition | Both | 8–12 frames | For soft, emotional sections. |
| `dip_to_black` / `dip_to_white` | Transition | Both | 10–16 frames | Section breaks and endings. |
| `push` (4 directions) | Transition | Remotion `slide` | 8–10 frames, spring | High-energy sequences. |
| `whip_pan` | Transition | Remotion custom | 6–8 frames | Directional motion blur on both sides of the cut. |
| `zoom_through` | Transition | Remotion custom / `xfade zoomin` | 8 frames | Punch into the outgoing shot, then land on the incoming one. |
| `wipe` (linear, clock) | Transition | Remotion `wipe` / `clockWipe` | 10–14 frames | Use sparingly. |
| `ken_burns` | Photo motion | Remotion | Whole shot | Slow pan and zoom chosen from the subject box, never cropping faces. |
| `punch_in` | Clip effect | Remotion | 1.0→1.12 scale | Emphasis on a beat or a spoken word. |
| `speed_ramp` | Clip effect | FFmpeg pre-render | 0.5×–2× | Applied to the source proxy before composition. |
| `shake` | Clip effect | Remotion | 4–6 frames | Impact accents only. |
| `flash` | Overlay | Remotion | 2–3 frames | White flash on a strong beat. |
| `color_preset` | Grade | FFmpeg LUT / CSS filter | Whole reel | A small set of LUTs (warm, cool, film, punchy) applied consistently. |
| `title_card` | Text | Remotion | 1.5–3 s | Hook text inside the safe area. |
| `word_captions` | Text | Remotion | Per word | Word-by-word highlighted captions from speech timestamps. |
| `music_duck` | Audio | FFmpeg | -8 to -12 dB | Lower the music under detected speech. |

## Pacing rules

- Hook: the first 1–3 seconds carry the strongest shot or a title card. No slow fade-in.
- Shot length: 0.6–2.5 s for high-energy styles and 2–5 s for calm styles. The style profile sets the range.
- Transitions: most joins are cuts or beat cuts. A styled transition is limited to roughly one in four joins unless the style profile allows more.
- Photos: hold for 2–4 s with motion. Never show a static still for more than 1.5 s.
- Ending: a hold, a dip, or a CTA card. Loop-friendly endings are an optional style setting.

[rt]: https://www.remotion.dev/docs/transitions
[xfade]: https://ffmpeg.org/ffmpeg-filters.html#xfade
[glt]: https://github.com/gl-transitions/gl-transitions
