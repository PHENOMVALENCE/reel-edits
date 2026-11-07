// Copy-paste bridge to the Claude (or ChatGPT) app you already pay for.
// The app builds a contact sheet + prompt; you paste the reply back in.

import { FPS, TRANSITION_IDS, EFFECT_IDS, MIN_SECONDS, MAX_SECONDS } from './catalog.js';
import { PRESETS } from './presets.js';
import { normalizeShots, reconcile, buildTimeline, totalFrames } from './planner.js';

export function buildPrompt({ assets, targetSeconds, presetId, brief }) {
  const preset = PRESETS[presetId] ?? PRESETS.hype;
  const list = assets
    .map((a) => (a.kind === 'video' ? `${a.id}: video clip, ${(a.durationFrames / FPS).toFixed(1)} s, ${a.orientation}` : `${a.id}: photo, ${a.orientation}`))
    .join('\n');
  return `You are a professional short-form video editor. Plan a vertical 9:16 Instagram/TikTok reel from my footage.

The attached contact sheet shows every asset with its label. Video clips show frames at 10%, 50% and 90% of the clip.

Assets:
${list}

Target length: ${targetSeconds} seconds (must be between ${MIN_SECONDS} and ${MAX_SECONDS}).
Style: ${preset.label} — ${preset.description}
${brief ? `Creative brief: ${brief}\n` : ''}
Editing rules:
- Open with the strongest, most eye-catching shot as the hook (first 1–3 s).
- Build a clear flow: hook, middle that develops, satisfying ending.
- Shots usually ${preset.shotSeconds[0]}–${preset.shotSeconds[1]} s for this style. Photos 1.5–4 s.
- Most joins are "cut". Use a styled transition on roughly 1 in ${preset.transitionEvery} joins.
- Use different parts of long clips; don't repeat the same moment.
- "start" is seconds into the source clip (0 for photos). "start" + "length" must fit inside the clip.

Allowed transitions (into the next shot): ${TRANSITION_IDS.join(', ')}
Allowed effects: ${EFFECT_IDS.join(', ')}

Reply with only this JSON and nothing else:
{"title":"short hook text or empty","end":"closing text or empty","shots":[{"asset":"C1","start":0,"length":1.5,"transition":"cut","effect":"punch_in"}]}`;
}

export function extractJson(text) {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error("Couldn't find JSON in the reply. Paste Claude's whole answer.");
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new Error("The reply's JSON is incomplete or malformed. Ask Claude to reply with valid JSON only.");
  }
}

export function parsePlan(text, { assets, targetSeconds, presetId }) {
  const data = extractJson(text);
  if (!Array.isArray(data.shots) || !data.shots.length) throw new Error('The reply has no shots.');
  const raw = data.shots.map((s) => ({
    assetId: String(s.asset ?? s.assetId ?? '').trim().toUpperCase(),
    from: Math.round((Number(s.start) || 0) * FPS),
    frames: Math.round((Number(s.length) || 0) * FPS),
    transition: s.transition,
    effect: s.effect,
  }));
  const { shots, warnings } = normalizeShots(raw, assets);
  if (!shots.length) throw new Error('None of the shots matched your assets.');
  const target = Math.round(Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, targetSeconds)) * FPS);
  const before = totalFrames(shots);
  if (Math.abs(before - target) > FPS) warnings.push(`The AI plan ran ${(before / FPS).toFixed(1)} s, adjusted toward ${target / FPS} s.`);
  const shortBy = reconcile(shots, assets, target);
  if (shortBy > 0) warnings.push(`Not enough footage in the plan for ${target / FPS} s.`);
  return {
    timeline: buildTimeline({ shots, presetId, title: String(data.title || '').slice(0, 80), endText: String(data.end || '').slice(0, 80) }),
    warnings,
  };
}
