# Claude integration

Claude is the editorial brain of Reel Edits. It is called only from the Next.js server, through the official Anthropic SDK (`@anthropic-ai/sdk`), with your own API credentials and billing.

## Pipeline

```
UPLOAD → MEDIA ANALYSIS → TRANSCRIPTION → MUSIC ANALYSIS → CLAUDE EDITORIAL PLANNING
       → MOTION GRAPHICS → AUDIO MIXING → REMOTION RENDER → QUALITY CONTROL
```

| Stage | Where | Code |
| --- | --- | --- |
| Upload, media analysis | Phone: probe files, sample timestamped frames | `lib/media.js` |
| Transcription | Phone extracts 16 kHz mono WAV chunks; server sends them to a transcription provider | `lib/audioExtract.js`, `app/api/transcribe`, `lib/server/transcription/` |
| Music analysis | Phone beat tracker | `lib/beats.js` |
| Editorial planning | Claude: analyze → plan → review (tool loop) → per-section re-cuts | `lib/server/claude/editorAgent.js`, `app/api/agent/[step]` |
| Motion graphics | Captions mapped from transcript words onto the edited timeline | `lib/captions.js`, `reel/Captions.js` |
| Audio mixing | Music ducks under speech; clip sound rises for dialogue | `lib/audioMix.js` |
| Render | Remotion in the browser | `reel/Reel.js` |
| Quality control | Timeline checks before render, MP4 length after | `lib/qc.js` |

`lib/pipeline.js` runs the stages. If Claude is not configured, over budget, refuses, or fails, the deterministic planner (`lib/planner.js`, `fallbackTimeline`) makes the reel and the stage list says so.

## The editorial agent

Each step is one Messages API call with `output_config.format` (JSON schema in `lib/ai/schemas.js`), adaptive thinking, and an explicit effort level. Output is validated again locally (`lib/ai/validate.js`) and then by the planner, which clamps trims, enforces the transition/effect allow-list and fits the exact target length. An invalid reply gets one corrective retry.

- **analyze** (effort medium): timestamped frames + transcripts + music + brief → per-asset description, quality, usable moments, hook candidates, risks.
- **plan** (effort high): sectioned edit (hook/build/payoff/outro), transition and effect per shot with reasons, caption style and emphasis words, mix levels, title and ending text.
- **review** (effort medium): Claude calls `validate_timeline`, a strict client tool that runs the app's real validator and QC, then returns the improved plan and a list of changes.
- **section** (effort medium): regenerates one section at the same length; the rest of the edit is untouched (`spliceSection`).

Project context (analysis, transcripts, current plan, history) stays in the browser and is sent back on each step, so revisions and section re-cuts don't re-send frames or re-run analysis. The shared context block carries a cache breakpoint, as does the fixed system prompt, so repeat calls read it from the prompt cache.

The Opus/Fable/Sonnet 5.x models are called with server-side refusal fallbacks (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`); set `REEL_CLAUDE_FALLBACKS=off` to disable.

## Credentials

- `ANTHROPIC_API_KEY`, or Workload Identity Federation (`ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID`, `ANTHROPIC_IDENTITY_TOKEN_FILE`) for short-lived tokens.
- The credential is passed to the SDK explicitly, so `ANTHROPIC_AUTH_TOKEN`, OAuth profiles on disk and Claude.ai sessions are never used. The app never asks for or stores Claude.ai session tokens, and there is no subscription-token workaround.
- Server modules live in `lib/server/` and throw if bundled for the browser. Routes return only the credential *type*.
- `REEL_ACCESS_TOKEN` is an app password for the AI routes. In production the routes refuse to run without it unless `REEL_ALLOW_OPEN_API=1`, so a public URL can't spend your credits.

## Transcription

Claude's API has no speech-to-text endpoint, so transcription is a separate provider behind one interface (`registerTranscriber`):

| Provider | Words | Segments | Speakers | Confidence | Cost |
| --- | --- | --- | --- | --- | --- |
| Whisper API (`openai-whisper`) | native | yes | no | from segment log-probability | $0.006/min |
| whisper.cpp (`whisper-cpp`) | native when the build returns them, otherwise approximated and flagged | yes | if returned | if returned | free |

Silent clips are detected on the phone and not sent. Long clips are split into ~110 s chunks and merged with offsets.

## Usage, cost and budgets

Every call is checked before it is sent (estimated cost against the monthly, per-reel and transcription-minute budgets) and recorded after: input, output and cache tokens, model, audio seconds, estimated cost, failures. The Claude panel shows this per reel and per month. Prices in `lib/ai/pricing.js` are list-price estimates; unknown models are counted at the highest known rate. Your Claude Console invoice is authoritative.

The ledger is a JSON file (`REEL_USAGE_FILE`, default `.data/usage.json`). On Vercel it falls back to `/tmp`, which resets; the panel warns about this. For reliable budgets on serverless hosting, point `REEL_USAGE_FILE` at durable storage or implement the four-method store interface in `lib/server/usage/store.js` on Postgres/KV.

## Monthly API credits

Max and Team plans include monthly Claude Platform API credits (Max 5x $100, Max 20x $200; Team Standard $20 and Premium $100 per seat, pooled). Link a Claude Console organization to your plan on claude.ai to claim them; new subscribers can claim after seven days. They cover API usage like this app's, so check eligibility before buying prepaid credits. Pro is not eligible. See Anthropic's help article "Monthly API credits for Max and Team plans" (support.claude.com/en/articles/17154008).

## Tests

`npm test` runs the real SDK against a fake HTTP transport: connection test, model selection, structured responses, invalid-output retry, SDK retries on 5xx/529, error mapping (auth, rate limit, not found, billing, refusal), budget enforcement before sending, the review tool loop, input validation, Whisper/whisper.cpp parsing, chunk merging, WER, caption timestamp sync through cuts and transitions, ducking, section regeneration and the fallback paths. A live check against your own key and audio is not automated.
