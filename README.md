# Reel Edits

Reel Edits is a phone-first Next.js app that turns short clips and photos into a polished 60–120 second vertical reel (1080×1920, 30 fps MP4). Pick your footage, choose a style, and it plans the cuts, snaps them to the beat of your music, adds transitions, effects and titles, previews the result, and exports the MP4 on your phone.

Everything runs in the browser. Media never leaves the device, there is no server-side rendering, and hosting on the free Vercel Hobby plan is enough.

## How it works

1. **Footage:** Add clips and photos from your camera roll. The first item is the hook; reorder to tell the story.
2. **Music (optional):** Add a track and the app detects its tempo so cuts land on the beat. Or skip it and add a trending sound inside Instagram or TikTok when you post.
3. **Style:** Choose Hype, Cinematic or Vlog, a length between 60 and 120 seconds, and optional hook and ending text. Tap **Make my reel**.
4. **Plan with Claude (optional):** The app builds a contact sheet of your footage and a prompt. Share both to the Claude app, paste Claude's JSON reply back, and the app checks and applies it.
5. **Preview and edit:** Watch the reel, then change any shot's length, effect, transition or position.
6. **Export:** Render the MP4 on the device, then save or share it.

| Part | How it's done | Cost |
| --- | --- | --- |
| Hosting | Static Next.js page on Vercel Hobby | Free for personal, non-commercial use |
| Edit planning | Rules engine (`lib/planner.js`) with style presets | Free |
| Beat detection | In-browser onset and tempo tracker (`lib/beats.js`) | Free |
| AI planning | Copy-paste with the Claude app you already pay for (`lib/aiPlan.js`) | No extra cost |
| Preview and export | Remotion Player and `@remotion/web-renderer` (WebCodecs) | Free under the Remotion Free License |

## Use it on your phone

1. Sign in at [vercel.com](https://vercel.com) with GitHub, choose **Add New → Project**, import `PHENOMVALENCE/reel-edits`, and click **Deploy**. No settings or environment variables are needed.
2. Open the deployment URL on your phone.
3. Add it to your home screen: **Share → Add to Home Screen** in Safari, or **⋮ → Add to Home screen** in Chrome.

Supported browsers: Chrome on Android, and Safari on iOS/iPadOS 26 or newer (in-browser export needs WebCodecs). Keep the screen on and the app in the foreground while exporting. A 60 s reel took about 90 s on a desktop test machine; phones vary.

## Run locally

Use Node.js 22 or newer.

```sh
npm ci
npm run dev        # http://localhost:3000
npm test           # planner, beat tracker and AI-reply tests
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
| `lib/aiPlan.js` | Claude prompt builder and reply parser |
| `lib/media.js` | File probing, thumbnails, contact sheet |
| `lib/catalog.js`, `lib/presets.js` | Allowed transitions and effects, style presets |

## Documentation

- [Research and decisions](docs/research.md) covers video tooling, reference links, AI APIs, compute, and costs.
- [Pipeline architecture](docs/architecture.md) defines the asset, style, timeline, and render boundaries.
- [Effects and transitions catalog](docs/effects.md) lists the allowed transitions, effects, captions and pacing rules.
- [Implementation roadmap](docs/roadmap.md) lists what has shipped and what comes next.
- [Licensing and media policy](docs/licensing.md) explains the MIT license, dependency terms, and media handling.

The source and documentation in this repository use the [MIT License](LICENSE). The bundled Montserrat font uses the [SIL Open Font License](public/fonts/Montserrat-OFL.txt).
