// Transcript shape shared by every transcription provider, plus helpers that run anywhere.
//
// Transcript = {
//   text, language, durationSeconds, provider, model,
//   words:    [{ word, start, end, confidence|null, speaker|null }],
//   segments: [{ start, end, text, confidence|null, speaker|null }],
//   capabilities: { wordTimestamps: 'native'|'approximate', speakers: boolean, confidence: boolean },
// }
// Times are seconds from the start of the source clip.

const r3 = (n) => Math.round(n * 1000) / 1000;

// When a provider only returns segment times, spread each segment's words across it by length.
export function approximateWords(segments) {
  const words = [];
  for (const seg of segments) {
    const parts = String(seg.text).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    const span = Math.max(0.01, seg.end - seg.start);
    const weight = parts.reduce((n, p) => n + p.length + 1, 0);
    let t = seg.start;
    for (const p of parts) {
      const d = (span * (p.length + 1)) / weight;
      words.push({ word: p, start: r3(t), end: r3(t + d), confidence: seg.confidence ?? null, speaker: seg.speaker ?? null });
      t += d;
    }
  }
  return words;
}

// Chunks are transcribed separately (upload limits); shift each by its offset and join.
export function mergeTranscripts(parts) {
  const sorted = [...parts].sort((a, b) => a.offset - b.offset);
  const out = { text: '', words: [], segments: [], durationSeconds: 0, language: null, provider: null, model: null, capabilities: null };
  for (const { offset, transcript: t } of sorted) {
    out.words.push(...t.words.map((w) => ({ ...w, start: r3(w.start + offset), end: r3(w.end + offset) })));
    out.segments.push(...t.segments.map((s) => ({ ...s, start: r3(s.start + offset), end: r3(s.end + offset) })));
    out.text = `${out.text} ${t.text}`.trim();
    out.durationSeconds = Math.max(out.durationSeconds, offset + (t.durationSeconds || 0));
    out.language ||= t.language;
    out.provider ||= t.provider;
    out.model ||= t.model;
    out.capabilities ||= t.capabilities;
  }
  return out;
}

const tokens = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu, ' ').split(/\s+/).filter(Boolean);

// Word error rate (Levenshtein over words). Used to measure transcription accuracy against a reference.
export function wordErrorRate(reference, hypothesis) {
  const ref = tokens(reference);
  const hyp = tokens(hypothesis);
  if (!ref.length) return hyp.length ? 1 : 0;
  let prev = Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ref.length; i++) {
    const cur = [i];
    for (let j = 1; j <= hyp.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[hyp.length] / ref.length;
}

// Compact text for Claude: timestamped segments, so the editor can cut on sentences.
export function transcriptForPrompt(assetId, t, maxChars = 4000) {
  if (!t?.segments?.length) return `${assetId}: (no speech detected)`;
  const lines = t.segments.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}]${s.speaker ? ` ${s.speaker}:` : ''} ${s.text.trim()}`);
  let out = `${assetId}:\n`;
  for (const l of lines) {
    if (out.length + l.length > maxChars) {
      out += '…(truncated)\n';
      break;
    }
    out += `${l}\n`;
  }
  return out.trimEnd();
}
