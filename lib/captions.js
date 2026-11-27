// Motion captions: map transcript words (source-clip seconds) onto the edited timeline (output frames),
// then group them into short caption lines. Pure functions so preview, export and tests agree.

import { FPS } from './catalog.js';
import { shotStarts } from './planner.js';

const MIN_CUE_FRAMES = 10;
const GAP_BREAK_SECONDS = 0.6;

// transcripts: { [assetId]: { words: [{ word, start, end, confidence? }] } }
export function mapWordsToTimeline(timeline, transcripts) {
  if (!timeline?.shots?.length || !transcripts) return [];
  const starts = shotStarts(timeline.shots);
  const out = [];
  timeline.shots.forEach((shot, i) => {
    const words = transcripts[shot.assetId]?.words;
    if (!words?.length) return;
    const srcStart = shot.from;
    const srcEnd = shot.from + shot.frames;
    const nextStart = i < timeline.shots.length - 1 ? starts[i + 1] : timeline.durationInFrames;
    for (const w of words) {
      const ws = Math.round(w.start * FPS);
      const we = Math.max(ws + 1, Math.round(w.end * FPS));
      if (ws < srcStart || ws >= srcEnd) continue;
      const from = starts[i] + (ws - srcStart);
      // A word stays on screen until it ends, the shot ends, or the next shot takes over.
      const to = Math.min(starts[i] + (we - srcStart), starts[i] + shot.frames, Math.max(from + 1, nextStart));
      if (from >= timeline.durationInFrames) continue;
      out.push({ text: String(w.word).trim(), from, to: Math.max(from + 1, to), shot: i, assetId: shot.assetId, confidence: w.confidence ?? null });
    }
  });
  return out.filter((w) => w.text).sort((a, b) => a.from - b.from);
}

// Words cut in half by a shot boundary: QC flags these as clipped speech.
export function clippedWords(timeline, transcripts) {
  if (!timeline?.shots?.length || !transcripts) return [];
  const clipped = [];
  timeline.shots.forEach((shot, i) => {
    for (const w of transcripts[shot.assetId]?.words || []) {
      const ws = w.start * FPS;
      const we = w.end * FPS;
      const a = shot.from;
      const b = shot.from + shot.frames;
      if ((ws < a && we > a + 2) || (ws < b - 2 && we > b)) clipped.push({ shot: i, word: w.word });
    }
  });
  return clipped;
}

const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

export function buildCaptionCues(words, { maxWordsPerLine = 4, emphasis = [], durationInFrames } = {}) {
  const limit = Math.max(1, Math.min(8, Math.round(maxWordsPerLine) || 4));
  const emph = new Set(emphasis.map(norm).filter(Boolean));
  const cues = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    cues.push({
      from: cur[0].from,
      to: cur[cur.length - 1].to,
      words: cur.map((w) => ({ text: w.text, from: w.from, to: w.to, emphasis: emph.has(norm(w.text)), confidence: w.confidence ?? null })),
    });
    cur = [];
  };
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (cur.length && (cur.length >= limit || w.shot !== prev.shot || (w.from - prev.to) / FPS > GAP_BREAK_SECONDS)) flush();
    cur.push(w);
    if (/[.!?]$/.test(w.text)) flush();
  });
  flush();
  // Give every cue a readable minimum duration without overlapping the next one.
  cues.forEach((c, i) => {
    const limitTo = i < cues.length - 1 ? cues[i + 1].from : durationInFrames ?? Infinity;
    c.to = Math.min(Math.max(c.to, c.from + MIN_CUE_FRAMES), limitTo);
    if (c.to <= c.from) c.to = c.from + 1;
  });
  return cues;
}

// Merged spans of speech in output frames, for ducking music under dialogue.
export function speechIntervals(words, mergeGap = 8) {
  const spans = [];
  for (const w of words) {
    const last = spans[spans.length - 1];
    if (last && w.from - last.to <= mergeGap) last.to = Math.max(last.to, w.to);
    else spans.push({ from: w.from, to: w.to });
  }
  return spans;
}
