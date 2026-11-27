// Quality control: checks a timeline before render and the MP4 after render.

import { FPS, MIN_SECONDS, MAX_SECONDS, TRANSITIONS, EFFECTS, CAPTION_STYLES } from './catalog.js';
import { totalFrames } from './planner.js';
import { clippedWords } from './captions.js';

export function qualityCheck({ timeline, assets, transcripts, targetSeconds }) {
  const issues = [];
  const add = (level, code, message) => issues.push({ level, code, message });
  if (!timeline?.shots?.length) {
    add('error', 'empty', 'The timeline has no shots.');
    return { ok: false, issues };
  }
  const map = Object.fromEntries((assets || []).map((a) => [a.id, a]));
  const frames = totalFrames(timeline.shots);
  if (frames !== timeline.durationInFrames) add('error', 'duration_mismatch', `Timeline says ${timeline.durationInFrames} frames but the shots add up to ${frames}.`);
  if (frames < MIN_SECONDS * FPS || frames > MAX_SECONDS * FPS) add('error', 'duration_range', `The reel is ${(frames / FPS).toFixed(1)} s; it must be ${MIN_SECONDS}–${MAX_SECONDS} s.`);
  if (targetSeconds && Math.abs(frames - targetSeconds * FPS) > FPS) add('warn', 'duration_target', `The reel is ${(frames / FPS).toFixed(1)} s, not the ${targetSeconds} s target.`);

  timeline.shots.forEach((s, i) => {
    const a = map[s.assetId];
    if (!a) return add('error', 'unknown_asset', `Shot ${i + 1} uses missing asset ${s.assetId}.`);
    if (s.frames < 15) add('error', 'shot_short', `Shot ${i + 1} is shorter than half a second.`);
    if (a.kind === 'video' && (s.from < 0 || s.from + s.frames > a.durationFrames)) add('error', 'trim_bounds', `Shot ${i + 1} runs past the end of ${s.assetId}.`);
    if (!TRANSITIONS[s.transition]) add('error', 'transition', `Shot ${i + 1} has unknown transition ${s.transition}.`);
    if (!EFFECTS[s.effect]) add('error', 'effect', `Shot ${i + 1} has unknown effect ${s.effect}.`);
    if (i > 0 && s.assetId === timeline.shots[i - 1].assetId && a.kind === 'photo') add('warn', 'repeat', `Shots ${i} and ${i + 1} show the same photo back to back.`);
  });
  if (timeline.shots.at(-1).transition !== 'cut') add('error', 'last_transition', 'The last shot must not have a transition out.');

  const style = timeline.captionStyle?.style;
  if (style && !CAPTION_STYLES[style]) add('error', 'caption_style', `Unknown caption style ${style}.`);
  const cues = timeline.captions || [];
  cues.forEach((c, i) => {
    if (c.from < 0 || c.to > timeline.durationInFrames) add('error', 'caption_bounds', `Caption ${i + 1} runs outside the reel.`);
    if (i && c.from < cues[i - 1].to) add('warn', 'caption_overlap', `Captions ${i} and ${i + 1} overlap.`);
    if (c.to - c.from < 8) add('warn', 'caption_fast', `Caption ${i + 1} is on screen for under a third of a second.`);
  });
  const lowConfidence = cues.flatMap((c) => c.words).filter((w) => w.confidence != null && w.confidence < 0.5).length;
  if (lowConfidence) add('warn', 'caption_confidence', `${lowConfidence} caption words had low transcription confidence. Check them before posting.`);
  const clipped = clippedWords(timeline, transcripts);
  if (clipped.length) add('warn', 'clipped_speech', `${clipped.length} spoken words are cut mid-word at shot boundaries (first: shot ${clipped[0].shot + 1}, "${clipped[0].word}").`);

  return { ok: !issues.some((i) => i.level === 'error'), issues };
}

// After export: the MP4 must be the length the timeline promised (±1 frame plus container rounding).
export function checkRenderedDuration(actualSeconds, expectedFrames) {
  const expected = expectedFrames / FPS;
  const delta = Math.abs(actualSeconds - expected);
  return { ok: Number.isFinite(actualSeconds) && delta <= 2 / FPS + 0.05, expected, actual: actualSeconds, delta };
}
