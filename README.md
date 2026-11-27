# Reel Edits

Reel Edits is a phone-first Next.js app that turns short clips and photos into a polished 60–120 second vertical reel (1080×1920, 30 fps MP4). Pick your footage, choose a style, and it plans the cuts, snaps them to the beat of your music, adds transitions, effects and titles, previews the result, and exports the MP4 on your phone.

Rendering runs in the browser. With a Claude API key on the server, Claude edits the reel: it reviews timestamped frames, transcripts and the music, plans a sectioned edit with transitions, effects and motion captions, then reviews and improves its own cut. Without a key, a free rules planner makes the reel on its own.

## How it works

1. **Footage:** Add clips and photos from your camera roll. The first item is the hook; reorder to tell the story.
2. **Music (optional):** Add a track and the app detects its tempo so cuts land on the beat. Or skip it and add a trending sound inside Instagram or TikTok when you post.
3. **Claude:** The panel shows whether the server is connected, lets you test the connection, pick a model and a transcription provider, set budgets, and see token use and cost for this reel and this month.
4. **Style:** Choose Hype, Cinematic or Vlog, a length between 60 and 120 seconds, optional hook and ending text, and a short brief. Tap **Make my reel**; the stage list shows each pipeline step.
5. **Preview and edit:** Watch the reel, ask Claude for changes, re-cut a single section, switch caption style, or change any shot by hand. A copy-paste route to the Claude app is still there for use without an API key.
6. **Export:** Render the MP4 on the device, then save or share it.

| Part | How it's done | Cost |
| --- | --- | --- |
| Hosting | Static Next.js page on Vercel Hobby | Free for personal, non-commercial use |
| Edit planning | Rules engine (`lib/planner.js`) with style presets | Free |
| Beat detection | In-browser onset and tempo tracker (`lib/beats.js`) | Free |
| AI editing | Claude API editorial agent (`lib/server/claude/`) | Your API usage; budgets enforced in the app |
| Transcription | Whisper API or local whisper.cpp (`lib/server/transcription/`) | $0.006/min or free |
| Preview and export | Remotion Player and `@remotion/web-renderer` (WebCodecs) | Free under the Remotion Free License |

## Use it on your phone

1. Sign in at [vercel.com](https://vercel.com) with GitHub, choose **Add New → Project**, import `PHENOMVALENCE/reel-edits`, and click **Deploy**. For Claude editing, add `ANTHROPIC_API_KEY` and `REEL_ACCESS_TOKEN` as environment variables (see `.env.example`); without them the free planner is used.
2. Open the deployment URL on your phone.
3. Add it to your home screen: **Share → Add to Home Screen** in Safari, or **⋮ → Add to Home screen** in Chrome.

Supported browsers: Chrome on Android, and Safari on iOS/iPadOS 26 or newer (in-browser export needs WebCodecs). Keep the screen on and the app in the foreground while exporting. A 60 s reel took about 90 s on a desktop test machine; phones vary.

## Run locally

Use Node.js 22 or newer.

```sh
npm ci
cp .env.example .env.local   # add ANTHROPIC_API_KEY (optional)
npm run dev        # http://localhost:3000
npm test           # planner, Claude provider, transcription, budgets and sync tests
npm run build      # production build
```

`npm run test:e2e -- <workdir>` drives the built app in headless Chrome and exports a real MP4 (see the header of `tests/e2e-render.mjs`).

## Project layout

| Path | Contents |
| --- | --- |
| `components/ReelMaker.jsx` | The phone UI |
| `reel/Reel.js`, `reel/presentations.js` | Remotion composition, effects and transitions shared by preview and export |
| `lib/planner.js` | Frame-accurate rules planner, length fitting, beat snapping, validation |
| `lib/beats.js` | Beat tracker |
| `lib/server/claude/` | Claude provider (auth, models, retries, structured calls) and the editorial agent |
| `lib/server/transcription/` | Transcription providers (Whisper API, whisper.cpp) |
| `lib/server/usage/` | Usage ledger, cost accounting and budgets |
| `app/api/` | Server routes: Claude status/models, agent steps, transcription, usage |
| `lib/pipeline.js`, `lib/editorial.js` | Pipeline stages, plan-to-timeline, section re-cuts, fallback |
| `lib/captions.js`, `lib/audioMix.js`, `lib/qc.js` | Motion captions, ducking mix, quality checks |
| `lib/aiPlan.js` | Copy-paste prompt builder and reply parser |
| `lib/media.js` | File probing, thumbnails, contact sheet |
| `lib/catalog.js`, `lib/presets.js` | Allowed transitions and effects, style presets |

## Documentation

- [Claude integration](docs/claude-integration.md) covers the editorial agent, credentials, transcription, budgets and monthly API credits.
- [Research and decisions](docs/research.md) covers video tooling, reference links, AI APIs, compute, and costs.
- [Pipeline architecture](docs/architecture.md) defines the asset, style, timeline, and render boundaries.
- [Effects and transitions catalog](docs/effects.md) lists the allowed transitions, effects, captions and pacing rules.
- [Implementation roadmap](docs/roadmap.md) lists what has shipped and what comes next.
- [Licensing and media policy](docs/licensing.md) explains the MIT license, dependency terms, and media handling.

The source and documentation in this repository use the [MIT License](LICENSE). The bundled Montserrat font uses the [SIL Open Font License](public/fonts/Montserrat-OFL.txt).
