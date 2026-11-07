# Research and decisions

Reviewed 7 November 2026. Provider prices, entitlements, and platform access requirements can change. The first milestone validates video quality and measures costs before committing to a production provider.

## Rendering and hosting

| Option | Role | Decision |
| --- | --- | --- |
| [FFmpeg and ffprobe][ffmpeg] | Inspect media, normalize inputs, make proxies, detect shot changes, trim, crop, mix audio, and encode H.264/AAC. Filters include crossfades, zoom/pan, and loudness normalization. | Use for ingest and media processing from the first render spike. |
| [Remotion Player][player] and [server renderer][renderer] | React compositions for kinetic text, captions, image movement, timed overlays, and transitions. Use the same composition props for preview and render. | Preferred for the polished editor after confirming [license eligibility][remotion-license] and preview/export parity. |
| [Cloud Run Jobs][cloud-run] or [Render background workers][render] | Run a containerized render outside the web request. | Start with a local Docker worker. Benchmark a per-job cloud container for burst traffic and a persistent worker for steady traffic. |
| [Boat.dev][boat] | Programmable sandbox with a CLI, HTTP API and SDKs. | Optional bake-off for isolated render jobs. Measure cold start, sustained CPU, RAM, temp disk, egress, cancellation, retry recovery, and total cost per successful export before adopting it. |
| [Vercel Functions limits][vercel] and [S3 presigned uploads][s3] | Web API for project state and signed upload URLs. Vercel Functions list a 4.5 MB request or response payload limit. | Let the browser upload straight to private object storage. Keep Next.js requests small and rendering asynchronous. |

## References from Instagram and TikTok

Use [Instagram oEmbed][instagram] and [TikTok Embed Player][tiktok] for supported links and display manual style notes alongside them. Validate platform hosts and keep a plain-link fallback for private, removed, or non-embeddable posts. Meta access and feature approval should be checked before promising inline playback.

For automated analysis, accept reference files that the creator is authorized to process. Detect cut points locally, sample representative frames and short windows around cuts, and extract authorized audio features. Record hook timing, shot length, cut density, beat alignment, caption placement, color, motion, and transition families. Turn those observations into a reusable, versioned style profile. Reference footage, sound, captions, and logos stay out of exported reels. A style profile is configuration that can be inspected, edited, and reused with new media. This approach gives the first version a way to learn from examples without running a training job.

## AI and billing

Send timestamped frames, asset descriptions, speech segments and beat cues to a multimodal planner. Ask for structured JSON with clip IDs, trim points, story beats, crop intentions and effects selected from a fixed list. Generate timing and beat measurements locally and validate every proposal against the actual assets. Keep a rules-based planner for projects without an API key. Start with one provider and benchmark another on the same inputs once there is a baseline.

- OpenAI supplies [image inputs][openai-vision], [structured outputs][openai-schema], and [speech-to-text][openai-speech]. [ChatGPT and API billing are separate][openai-billing]. Eligible Pro and Business plans may have a [claimable API-credit benefit][openai-credits]. The application still uses an API project and a server-side key.
- Anthropic supplies [vision][claude-vision] and [structured outputs][claude-schema]. [Claude subscriptions and Console API billing are separate][claude-billing]. Pair Claude with a separate transcription service or a local speech model when captions are needed.

Meter planner input/output, transcription minutes, worker runtime, storage, and transfer. Cache analysis by media checksum and analysis version. Set per-project size and sampling limits, queue concurrency, retry limits and provider budget alerts. Compare cost per approved reel across a 60/90/120-second batch, including preview and retry costs. No production price or render-speed claim is assumed.

[ffmpeg]: https://ffmpeg.org/ffmpeg-filters.html
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
