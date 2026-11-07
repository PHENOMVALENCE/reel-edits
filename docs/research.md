# Research and decisions

Reviewed 7 November 2026. Provider prices, entitlements, and platform access requirements can change. The first milestone validates video quality and measures costs before committing to a production provider.

## Rendering and hosting

| Option | Role | Decision |
| --- | --- | --- |
| [FFmpeg and ffprobe][ffmpeg] | Inspect media, normalize inputs, make proxies, detect shot changes, trim, crop, mix audio, and encode H.264/AAC. Filters include crossfades, zoom/pan, and loudness normalization. | Use for ingest and media processing from the first render spike. |
| [Remotion Player][player] and [server renderer][renderer] | React compositions for kinetic text, captions, image movement, timed overlays, and transitions. Use the same composition props for preview and render. | Preferred for the polished editor. The [Remotion license][remotion-license-md] is free for individuals, non-profits and for-profit companies with up to 3 employees; larger companies need a company license. Confirm eligibility for the operating entity before deploying. |
| [Cloud Run Jobs][cloud-run] or [Render background workers][render] | Run a containerized render outside the web request. | Start with a local Docker worker. Benchmark a per-job cloud container for burst traffic and a persistent worker for steady traffic. |
| [Boat.dev][boat] | Persistent Ubuntu VM sandboxes with Docker, Chrome and Node preinstalled, an HTTP API, Python/TypeScript SDKs and a CLI. Sizes run from 2 vCPU/4 GB to 16 vCPU/32 GB, billed per second with a $20/month minimum. EU regions only, a one-hour default sandbox TTL (overridable), and no GPU is advertised. FFmpeg would be installed in the image. | Optional bake-off for isolated render jobs. Measure cold start, sustained CPU, RAM, temp disk, egress, cancellation, retry recovery, and total cost per successful export before adopting it. |
| [Vercel Functions limits][vercel] and [S3 presigned uploads][s3] | Web API for project state and signed upload URLs. Vercel Functions list a 4.5 MB request or response payload limit. | Let the browser upload straight to private object storage. Keep Next.js requests small and rendering asynchronous. |

## Footage analysis tools

| Tool | Output | Notes |
| --- | --- | --- |
| [PySceneDetect][scenedetect] or FFmpeg `select='gt(scene,…)'` | Shot boundaries in source clips and references | Run locally on proxies. |
| [aubio][aubio] (`aubio beat`, `aubio onset`) | Beat and onset times for the music track | Drives `beat_cut` snapping. Essentia or librosa are alternatives. |
| [whisper.cpp][whispercpp] or OpenAI speech-to-text | Word-level speech timestamps | Feeds word captions, speech-aware trims and music ducking. |
| FFmpeg `ebur128`, `silencedetect`, `cropdetect` | Loudness, silences, letterboxing | Normalize to a consistent loudness target before mixing. |
| Face/subject detection (for example MediaPipe) | Subject boxes per sampled frame | Keeps faces inside the 9:16 crop and photo pan paths. |

The effects and transitions vocabulary lives in the [effects catalog](effects.md).

## References from Instagram and TikTok

Use [Instagram oEmbed][instagram] and [TikTok Embed Player][tiktok] for supported links and display manual style notes alongside them. Validate platform hosts and keep a plain-link fallback for private, removed, or non-embeddable posts. Meta access and feature approval should be checked before promising inline playback. Instagram states that [scraping goes against its Terms of Use][ig-scraping], so the pipeline does not download posts from pasted links.

For automated analysis, accept reference files that the creator is authorized to process. Detect cut points locally, sample representative frames and short windows around cuts, and extract authorized audio features. Record hook timing, shot length, cut density, beat alignment, caption placement, color, motion, and transition families. Turn those observations into a reusable, versioned style profile. Reference footage, sound, captions, and logos stay out of exported reels. A style profile is configuration that can be inspected, edited, and reused with new media. This approach gives the first version a way to learn from examples without running a training job.

## AI and billing

Send timestamped frames, asset descriptions, speech segments and beat cues to a multimodal planner. Ask for structured JSON with clip IDs, trim points, story beats, crop intentions and effects selected from a fixed list. Generate timing and beat measurements locally and validate every proposal against the actual assets. Keep a rules-based planner for projects without an API key. Start with one provider and benchmark another on the same inputs once there is a baseline.

- OpenAI supplies [image inputs][openai-vision], [structured outputs][openai-schema], and [speech-to-text][openai-speech]. [ChatGPT and API billing are separate][openai-billing]. Eligible Pro and Business plans may have a [claimable API-credit benefit][openai-credits]. The application still uses an API project and a server-side key.
- Google Gemini [accepts video files directly][gemini-video], sampling 1 frame per second by default (configurable) and referencing moments as `MM:SS`. It is a strong candidate for the *reference analysis* step because it sees motion and audio together. It also accepts public YouTube URLs, but not Instagram or TikTok links.
- Anthropic supplies [vision][claude-vision] and [structured outputs][claude-schema]. Claude takes images, not video, so the pipeline sends sampled keyframes with timestamps and a transcript. [Claude subscriptions and Console API billing are separate][claude-billing]. Pair Claude with a separate transcription service or a local speech model when captions are needed.

Meter planner input/output, transcription minutes, worker runtime, storage, and transfer. Cache analysis by media checksum and analysis version. Set per-project size and sampling limits, queue concurrency, retry limits and provider budget alerts. Compare cost per approved reel across a 60/90/120-second batch, including preview and retry costs. No production price or render-speed claim is assumed.

[ffmpeg]: https://ffmpeg.org/ffmpeg-filters.html
[remotion-license-md]: https://github.com/remotion-dev/remotion/blob/main/LICENSE.md
[scenedetect]: https://github.com/Breakthrough/PySceneDetect
[aubio]: https://aubio.readthedocs.io/en/latest/cli.html
[whispercpp]: https://github.com/ggml-org/whisper.cpp
[ig-scraping]: https://help.instagram.com/740480200552298
[gemini-video]: https://ai.google.dev/gemini-api/docs/video-understanding
[player]: https://www.remotion.dev/docs/player/
[renderer]: https://www.remotion.dev/docs/renderer/render-media
[remotion-license]: https://www.remotion.dev/docs/terms
[cloud-run]: https://docs.cloud.google.com/run/docs/create-jobs
[render]: https://render.com/docs/background-workers
[boat]: https://boat.dev/
[vercel]: https://vercel.com/docs/functions/limitations
[s3]: https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html
[instagram]: https://developers.facebook.com/docs/instagram/oembed/
[tiktok]: https://developers.tiktok.com/docs/en/embed-player
[openai-vision]: https://developers.openai.com/api/docs/guides/images-vision
[openai-schema]: https://developers.openai.com/api/docs/guides/structured-outputs
[openai-speech]: https://developers.openai.com/api/docs/guides/speech-to-text
[openai-billing]: https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform
[openai-credits]: https://help.openai.com/en/articles/20001626-api-credits-benefit-for-eligible-chatgpt-subscriptions
[claude-vision]: https://platform.claude.com/docs/en/build-with-claude/vision
[claude-schema]: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
[claude-billing]: https://support.anthropic.com/en/articles/9876003-i-subscribe-to-a-paid-claude-ai-plan-why-do-i-have-to-pay-separately-for-api-usage-on-console
