// Whisper API (OpenAI audio transcriptions). Word and segment timestamps via verbose_json.
// Whisper does not identify speakers; confidence is derived from each segment's average log-probability.

import { providerHttpError, withRetry } from './errors.js';

const ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';

export function parseWhisperVerbose(json, { provider = 'openai-whisper', model = 'whisper-1' } = {}) {
  const segments = (json.segments || []).map((s) => ({
    start: s.start,
    end: s.end,
    text: String(s.text || '').trim(),
    confidence: Number.isFinite(s.avg_logprob) ? Math.round(Math.exp(s.avg_logprob) * 1000) / 1000 : null,
    noSpeechProb: s.no_speech_prob ?? null,
    speaker: null,
  }));
  // Words inherit the confidence of the segment they fall in.
  const confAt = (t) => segments.find((s) => t >= s.start && t < s.end + 0.01)?.confidence ?? null;
  const words = (json.words || []).map((w) => ({
    word: String(w.word).trim(),
    start: w.start,
    end: w.end,
    confidence: confAt(w.start),
    speaker: null,
  }));
  return {
    text: String(json.text || '').trim(),
    language: json.language || null,
    durationSeconds: Number(json.duration) || (segments.at(-1)?.end ?? 0),
    provider,
    model,
    words,
    segments,
    capabilities: { wordTimestamps: 'native', speakers: false, confidence: true },
  };
}

export const openaiWhisper = {
  id: 'openai-whisper',
  label: 'Whisper API',
  costPerMinute: 0.006,
  capabilities: { wordTimestamps: 'native', speakers: false, confidence: true },
  available: (config) => Boolean(config.transcription.openaiKey),
  async transcribe({ audio, filename = 'audio.wav', mimeType = 'audio/wav', language, config, fetch = globalThis.fetch }) {
    const model = config.transcription.openaiModel;
    const json = await withRetry(async () => {
      const form = new FormData();
      form.append('file', new Blob([audio], { type: mimeType }), filename);
      form.append('model', model);
      form.append('response_format', 'verbose_json');
      form.append('timestamp_granularities[]', 'word');
      form.append('timestamp_granularities[]', 'segment');
      if (language) form.append('language', language);
      const res = await fetch(ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${config.transcription.openaiKey}` }, body: form });
      if (!res.ok) throw await providerHttpError(res, 'Whisper API');
      return res.json();
    });
    return parseWhisperVerbose(json, { model });
  },
};
