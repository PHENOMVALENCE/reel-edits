// Local Whisper through a whisper.cpp server (`whisper-server`), e.g. WHISPER_CPP_URL=http://127.0.0.1:8080.
// Free and private. Builds that return per-word timings are used directly; otherwise word times
// are approximated from segment times and the transcript says so.

import { approximateWords } from '../../transcript.js';
import { providerHttpError, withRetry } from './errors.js';

const toSeconds = (v) => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.includes(':')) {
    const [h, m, s] = v.replace(',', '.').split(':').map(Number);
    return h * 3600 + m * 60 + s;
  }
  return Number(v) || 0;
};

export function parseWhisperCpp(json) {
  const rawSegs = json.segments || json.transcription || [];
  const segments = rawSegs.map((s) => ({
    start: toSeconds(s.start ?? s.t0 ?? s.timestamps?.from ?? s.offsets?.from / 1000),
    end: toSeconds(s.end ?? s.t1 ?? s.timestamps?.to ?? s.offsets?.to / 1000),
    text: String(s.text || '').trim(),
    confidence: Number.isFinite(s.avg_logprob) ? Math.round(Math.exp(s.avg_logprob) * 1000) / 1000 : null,
    speaker: s.speaker ?? null,
    words: s.words,
  }));
  const nativeWords = segments.flatMap((s) => (s.words || []).map((w) => ({
    word: String(w.word ?? w.text ?? '').trim(),
    start: toSeconds(w.start ?? w.t0),
    end: toSeconds(w.end ?? w.t1),
    confidence: Number.isFinite(w.probability) ? w.probability : Number.isFinite(w.p) ? w.p : null,
    speaker: s.speaker ?? null,
  }))).filter((w) => w.word);
  const clean = segments.map(({ words, ...s }) => s);
  const words = nativeWords.length ? nativeWords : approximateWords(clean);
  return {
    text: String(json.text ?? clean.map((s) => s.text).join(' ')).trim(),
    language: json.language || null,
    durationSeconds: Number(json.duration) || (clean.at(-1)?.end ?? 0),
    provider: 'whisper-cpp',
    model: json.model || 'whisper.cpp',
    words,
    segments: clean,
    capabilities: { wordTimestamps: nativeWords.length ? 'native' : 'approximate', speakers: clean.some((s) => s.speaker), confidence: words.some((w) => w.confidence != null) },
  };
}

export const whisperCpp = {
  id: 'whisper-cpp',
  label: 'Local Whisper (whisper.cpp)',
  costPerMinute: 0,
  capabilities: { wordTimestamps: 'native-or-approximate', speakers: false, confidence: true },
  available: (config) => Boolean(config.transcription.whisperCppUrl),
  async transcribe({ audio, filename = 'audio.wav', mimeType = 'audio/wav', language, config, fetch = globalThis.fetch }) {
    const url = new URL('/inference', config.transcription.whisperCppUrl);
    const json = await withRetry(async () => {
      const form = new FormData();
      form.append('file', new Blob([audio], { type: mimeType }), filename);
      form.append('response_format', 'verbose_json');
      form.append('temperature', '0');
      if (language) form.append('language', language);
      const res = await fetch(url, { method: 'POST', body: form });
      if (!res.ok) throw await providerHttpError(res, 'whisper.cpp');
      return res.json();
    });
    return parseWhisperCpp(json);
  },
};
