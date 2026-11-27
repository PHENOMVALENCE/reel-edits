// Editorial glue between Claude's structured plans and the frame-accurate timeline.
// Also holds the deterministic fallback used whenever AI services are unavailable.

import { FPS, MIN_SECONDS, MAX_SECONDS, CAPTION_STYLES } from './catalog.js';
import { PRESETS } from './presets.js';
import { normalizeShots, reconcile, buildTimeline, totalFrames, planReel } from './planner.js';
import { mapWordsToTimeline, buildCaptionCues, speechIntervals } from './captions.js';
import { buildMix, normalizeAudio } from './audioMix.js';

const clampTarget = (s) => Math.round(Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, s)) * FPS);

function captionStyleFrom(c, preset) {
  return {
    style: CAPTION_STYLES[c?.style] ? c.style : preset.captionStyle ?? 'karaoke',
    emphasis: Array.isArray(c?.emphasis) ? c.emphasis.slice(0, 40).map((w) => String(w).slice(0, 30)) : [],
    maxWordsPerLine: Math.max(1, Math.min(8, Math.round(Number(c?.maxWordsPerLine) || 4))),
    position: c?.position === 'middle' ? 'middle' : 'lower',
  };
}

function rawShotsFromPlan(plan) {
  const sections = Array.isArray(plan.sections) ? plan.sections : [{ id: 'main', shots: plan.shots || [] }];
  return sections.flatMap((sec, si) => (sec.shots || []).map((s) => ({
    assetId: String(s.asset ?? s.assetId ?? '').trim().toUpperCase(),
    from: Math.round((Number(s.start) || 0) * FPS),
    frames: Math.round((Number(s.length) || 0) * FPS),
    transition: s.transition,
    effect: s.effect,
    section: String(sec.id || `section-${si + 1}`),
  })));
}

// Claude plan (sections of shots, in source seconds) -> validated timeline at the exact target length.
export function planToTimeline(plan, { assets, targetSeconds, presetId }) {
  const preset = PRESETS[presetId] ?? PRESETS.hype;
  const { shots, warnings } = normalizeShots(rawShotsFromPlan(plan), assets);
  if (!shots.length) throw new Error('None of the planned shots matched your footage.');
  const target = clampTarget(targetSeconds);
  const before = totalFrames(shots);
  if (Math.abs(before - target) > FPS) warnings.push(`The AI plan ran ${(before / FPS).toFixed(1)} s, adjusted to ${target / FPS} s.`);
  const shortBy = reconcile(shots, assets, target);
  if (shortBy > 0) warnings.push(`Not enough footage in the plan for ${target / FPS} s.`);
  const timeline = buildTimeline({
    shots, presetId,
    title: String(plan.title || '').slice(0, 80),
    endText: String(plan.endText ?? plan.end ?? '').slice(0, 80),
    captionStyle: captionStyleFrom(plan.captions, preset),
    audio: normalizeAudio(plan.audio, preset),
  });
  return { timeline, warnings };
}

export function sectionsOf(timeline) {
  const out = [];
  timeline.shots.forEach((s, i) => {
    const id = s.section || 'main';
    const last = out[out.length - 1];
    if (last && last.id === id) last.indices.push(i);
    else out.push({ id, indices: [i] });
  });
  return out.map((sec) => ({ ...sec, frames: totalFrames(sec.indices.map((i) => timeline.shots[i])) }));
}

// Current timeline -> the plan shape Claude reads, so later iterations build on the edit as it stands.
export function timelineToPlan(timeline) {
  return {
    title: timeline.title?.text || '',
    endText: timeline.endCard?.text || '',
    sections: sectionsOf(timeline).map((sec) => ({
      id: sec.id,
      purpose: '',
      shots: sec.indices.map((i) => {
        const s = timeline.shots[i];
        return { asset: s.assetId, start: +(s.from / FPS).toFixed(2), length: +(s.frames / FPS).toFixed(2), transition: s.transition, effect: s.effect, reason: '' };
      }),
    })),
    captions: timeline.captionStyle,
    audio: timeline.audio,
    notes: '',
  };
}

// Replace one section with Claude's regenerated version, keeping that section's length so the
// rest of the edit (and the music sync) is untouched.
export function spliceSection(timeline, sectionId, newSection, { assets }) {
  const secs = sectionsOf(timeline);
  const target = secs.find((s) => s.id === sectionId);
  if (!target) throw new Error(`Section "${sectionId}" is not in the timeline.`);
  const raw = rawShotsFromPlan({ sections: [{ ...newSection, id: sectionId }] });
  const { shots: fresh, warnings } = normalizeShots(raw, assets);
  if (!fresh.length) throw new Error('The regenerated section had no usable shots.');
  const before = timeline.shots.slice(0, target.indices[0]);
  const after = timeline.shots.slice(target.indices.at(-1) + 1);
  // Keep the incoming join: the shot before this section transitions into the new first shot.
  const shortBy = reconcile(fresh, assets, target.frames);
  if (shortBy) warnings.push(`The new ${sectionId} is ${(Math.abs(shortBy) / FPS).toFixed(1)} s ${shortBy > 0 ? 'shorter' : 'longer'} than before.`);
  if (after.length) fresh[fresh.length - 1].transition = timeline.shots[target.indices.at(-1)].transition;
  const shots = [...before.map((s) => ({ ...s })), ...fresh, ...after.map((s) => ({ ...s }))];
  shots[shots.length - 1].transition = 'cut';
  return {
    timeline: buildTimeline({
      shots, presetId: timeline.presetId, title: timeline.title?.text, endText: timeline.endCard?.text,
      captionStyle: timeline.captionStyle, audio: timeline.audio,
    }),
    warnings,
  };
}

// Motion graphics + audio mixing stages: derive caption cues and gain keyframes from the edit.
export function finalizeTimeline(timeline, { transcripts, hasMusic }) {
  if (!timeline) return timeline;
  const words = mapWordsToTimeline(timeline, transcripts);
  const style = timeline.captionStyle?.style ?? 'none';
  const captions = style === 'none' ? [] : buildCaptionCues(words, {
    maxWordsPerLine: timeline.captionStyle.maxWordsPerLine,
    emphasis: timeline.captionStyle.emphasis,
    durationInFrames: timeline.durationInFrames,
  });
  const speech = speechIntervals(words);
  const mix = buildMix({ durationInFrames: timeline.durationInFrames, speech, audio: timeline.audio, hasMusic });
  return { ...timeline, captions, mix, speechFrames: speech.reduce((n, s) => n + s.to - s.from, 0) };
}

// Deterministic planner used when Claude is unavailable, over budget, or fails.
export function fallbackTimeline({ assets, targetSeconds, presetId, beats, title, endText }) {
  const result = planReel({ assets, targetSeconds, presetId, beats, title, endText });
  const t = result.timeline;
  if (!t) return result;
  const n = t.shots.length;
  t.shots.forEach((s, i) => {
    s.section = i === 0 ? 'hook' : i >= n - Math.max(1, Math.round(n * 0.15)) ? 'outro' : i < Math.round(n * 0.55) ? 'build' : 'payoff';
  });
  return result;
}
