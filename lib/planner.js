// Rules-based planner: turns assets + a style preset into a frame-accurate timeline.
// Pure functions, no browser APIs, so it runs in tests and on the phone alike.

import { FPS, TRANSITIONS, EFFECTS, MIN_SECONDS, MAX_SECONDS } from './catalog.js';
import { PRESETS } from './presets.js';

export const MIN_SHOT_FRAMES = 15; // 0.5 s
export const MAX_PHOTO_FRAMES = 5 * FPS;
export const MIN_PHOTO_FRAMES = 1 * FPS;
const BEAT_SNAP_FRAMES = 8;

const byId = (assets) => Object.fromEntries(assets.map((a) => [a.id, a]));

// How many frames a transition actually overlaps, given the two shots it joins.
export function transitionFrames(id, a, b) {
  const def = TRANSITIONS[id]?.frames ?? 0;
  if (!def || !a || !b) return 0;
  const room = Math.floor(Math.min(a.frames, b.frames) / 2) - 1;
  return Math.max(0, Math.min(def, room));
}

export function totalFrames(shots) {
  let total = 0;
  shots.forEach((s, i) => {
    total += s.frames;
    if (i < shots.length - 1) total -= transitionFrames(s.transition, s, shots[i + 1]);
  });
  return total;
}

// Start frame of each shot in the output.
export function shotStarts(shots) {
  const starts = [];
  let t = 0;
  shots.forEach((s, i) => {
    starts.push(t);
    t += s.frames;
    if (i < shots.length - 1) t -= transitionFrames(s.transition, s, shots[i + 1]);
  });
  return starts;
}

// A clip's shots share its footage, so a shot can only grow into frames no other shot uses.
function capacityUp(shot, asset, shots) {
  if (asset.kind === 'photo') return Math.max(0, MAX_PHOTO_FRAMES - shot.frames);
  const used = shots.reduce((n, s) => n + (s.assetId === shot.assetId ? s.frames : 0), 0);
  return Math.max(0, Math.min(asset.durationFrames - shot.frames, asset.durationFrames - used));
}

// Spread each clip's shots through the clip in order, with no overlapping footage.
export function layoutSources(shots, assets) {
  const map = byId(assets);
  for (const asset of assets) {
    if (asset.kind !== 'video') continue;
    const own = shots.filter((s) => s.assetId === asset.id);
    const used = own.reduce((n, s) => n + s.frames, 0);
    const gap = Math.max(0, (asset.durationFrames - used) / (own.length + 1));
    let cursor = 0;
    own.forEach((s, j) => {
      s.from = Math.min(Math.round(gap * (j + 1) + cursor), Math.max(0, map[asset.id].durationFrames - s.frames));
      cursor += s.frames;
    });
  }
}

function capacityDown(shot) {
  return Math.max(0, shot.frames - MIN_SHOT_FRAMES);
}

function resize(shot, asset, newFrames) {
  shot.frames = newFrames;
  if (asset.kind === 'video') {
    // Keep the shot inside the clip, moving its start earlier if needed.
    shot.from = Math.max(0, Math.min(shot.from, asset.durationFrames - newFrames));
  }
}

// Stretch or shrink shots until the reel hits targetFrames exactly (if the material allows).
export function reconcile(shots, assets, targetFrames) {
  const map = byId(assets);
  for (let pass = 0; pass < 50; pass++) {
    const diff = targetFrames - totalFrames(shots);
    if (diff === 0) return 0;
    const grow = diff > 0;
    const open = shots.filter((s) => (grow ? capacityUp(s, map[s.assetId], shots) : capacityDown(s)) > 0);
    if (!open.length) return diff;
    const each = Math.max(1, Math.floor(Math.abs(diff) / open.length));
    let left = Math.abs(diff);
    for (const s of [...open].reverse()) {
      if (!left) break;
      const cap = grow ? capacityUp(s, map[s.assetId], shots) : capacityDown(s);
      const step = Math.min(cap, each, left);
      resize(s, map[s.assetId], s.frames + (grow ? step : -step));
      left -= step;
    }
  }
  return targetFrames - totalFrames(shots);
}

// Move hard cuts onto nearby beats without changing the reel's total length.
export function snapToBeats(shots, assets, beatSeconds) {
  if (!beatSeconds?.length) return 0;
  const map = byId(assets);
  const beats = beatSeconds.map((b) => Math.round(b * FPS));
  let snapped = 0;
  for (let i = 0; i < shots.length - 1; i++) {
    if (shots[i].transition !== 'cut') continue;
    const cut = shotStarts(shots)[i + 1];
    let best = null;
    for (const b of beats) {
      if (Math.abs(b - cut) <= BEAT_SNAP_FRAMES && (best === null || Math.abs(b - cut) < Math.abs(best - cut))) best = b;
    }
    if (best === null || best === cut) continue;
    let delta = best - cut;
    const a = shots[i];
    const b = shots[i + 1];
    if (delta > 0) delta = Math.min(delta, capacityUp(a, map[a.assetId], shots), capacityDown(b));
    else delta = -Math.min(-delta, capacityDown(a), capacityUp(b, map[b.assetId], shots));
    if (!delta) continue;
    resize(a, map[a.assetId], a.frames + delta);
    resize(b, map[b.assetId], b.frames - delta);
    snapped++;
  }
  return snapped;
}

export function planReel({ assets, targetSeconds = 60, presetId = 'hype', beats = null, title = '', endText = '' }) {
  const preset = PRESETS[presetId] ?? PRESETS.hype;
  const warnings = [];
  if (!assets.length) return { timeline: null, warnings: ['Add some clips or photos first.'] };

  const target = Math.round(Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, targetSeconds)) * FPS);
  const avgShot = Math.round(((preset.shotSeconds[0] + preset.shotSeconds[1]) / 2) * FPS);
  const photos = assets.filter((a) => a.kind === 'photo');
  const videos = assets.filter((a) => a.kind === 'video');

  let photoFrames = Math.round(preset.photoSeconds * FPS);
  let remaining = target - photos.length * photoFrames;
  if (remaining < 0 && photos.length) {
    photoFrames = Math.max(MIN_PHOTO_FRAMES, Math.floor(target / photos.length));
    remaining = target - photos.length * photoFrames;
  }

  const videoTotal = videos.reduce((n, v) => n + v.durationFrames, 0);
  const segmentsByAsset = new Map();
  for (const a of assets) {
    if (a.kind === 'photo') {
      segmentsByAsset.set(a.id, [{ assetId: a.id, from: 0, frames: photoFrames }]);
      continue;
    }
    const share = videoTotal ? Math.min(a.durationFrames, Math.max(0, remaining) * (a.durationFrames / videoTotal)) : 0;
    const usable = Math.max(Math.min(a.durationFrames, MIN_SHOT_FRAMES), Math.floor(share));
    const count = Math.max(1, Math.round(usable / avgShot));
    const len = Math.max(Math.min(MIN_SHOT_FRAMES, a.durationFrames), Math.floor(usable / count));
    const slice = a.durationFrames / count;
    const segs = [];
    for (let j = 0; j < count; j++) {
      segs.push({ assetId: a.id, from: Math.max(0, Math.floor(j * slice + (slice - len) / 2)), frames: len });
    }
    segmentsByAsset.set(a.id, segs);
  }

  // Round-robin through assets so consecutive shots come from different moments.
  const shots = [];
  for (let pass = 0; ; pass++) {
    let added = false;
    for (const a of assets) {
      const seg = segmentsByAsset.get(a.id)[pass];
      if (seg) {
        shots.push({ ...seg });
        added = true;
      }
    }
    if (!added) break;
  }

  let t = 0;
  let clipIndex = 0;
  const map = byId(assets);
  shots.forEach((s, i) => {
    const isLast = i === shots.length - 1;
    s.transition = !isLast && (i + 1) % preset.transitionEvery === 0 ? preset.transitions[t++ % preset.transitions.length] : 'cut';
    s.effect = map[s.assetId].kind === 'photo' ? preset.photoEffect : preset.clipEffects[clipIndex++ % preset.clipEffects.length];
  });
  // Open on the strongest beat: no transition into the hook, and give the first shot a punch-in.
  if (shots[0] && map[shots[0].assetId].kind === 'video' && presetId === 'hype') shots[0].effect = 'punch_in';

  const shortBy = reconcile(shots, assets, target);
  const snapped = snapToBeats(shots, assets, beats);
  layoutSources(shots, assets);
  if (shortBy > 0) {
    warnings.push(`Not enough footage for ${Math.round(target / FPS)} s. The reel is ${Math.round(totalFrames(shots) / FPS)} s. Add more clips or photos to reach it.`);
  }

  return {
    timeline: buildTimeline({ shots, presetId, title, endText }),
    warnings,
    stats: { shots: shots.length, beatSnaps: snapped },
  };
}

export function buildTimeline({ shots, presetId, title = '', endText = '' }) {
  const preset = PRESETS[presetId] ?? PRESETS.hype;
  return {
    fps: FPS,
    presetId,
    shots,
    title: title ? { text: title, frames: Math.round(preset.titleSeconds * FPS) } : null,
    endCard: endText ? { text: endText, frames: Math.round(2 * FPS) } : null,
    durationInFrames: Math.max(1, totalFrames(shots)),
  };
}

// Validate a timeline from the editor or the AI. Clamps anything out of range and reports it.
export function normalizeShots(rawShots, assets) {
  const map = byId(assets);
  const warnings = [];
  const shots = [];
  for (const [i, raw] of (rawShots || []).entries()) {
    const asset = map[raw.assetId];
    if (!asset) {
      warnings.push(`Shot ${i + 1}: unknown asset "${raw.assetId}" was skipped.`);
      continue;
    }
    let frames = Math.round(Number(raw.frames) || 0);
    let from = asset.kind === 'video' ? Math.max(0, Math.round(Number(raw.from) || 0)) : 0;
    if (asset.kind === 'video') {
      if (from >= asset.durationFrames - MIN_SHOT_FRAMES) from = Math.max(0, asset.durationFrames - MIN_SHOT_FRAMES);
      frames = Math.min(frames, asset.durationFrames - from);
    } else {
      frames = Math.min(frames, MAX_PHOTO_FRAMES);
    }
    if (frames < MIN_SHOT_FRAMES) frames = Math.min(MIN_SHOT_FRAMES, asset.kind === 'video' ? asset.durationFrames : MIN_SHOT_FRAMES);
    const transition = TRANSITIONS[raw.transition] ? raw.transition : 'cut';
    const effect = EFFECTS[raw.effect] ? raw.effect : asset.kind === 'photo' ? 'ken_burns' : 'none';
    if (raw.transition && transition !== raw.transition) warnings.push(`Shot ${i + 1}: transition "${raw.transition}" isn't available, used a cut.`);
    if (raw.effect && effect !== raw.effect) warnings.push(`Shot ${i + 1}: effect "${raw.effect}" isn't available.`);
    shots.push({ assetId: asset.id, from, frames, transition, effect });
  }
  if (shots.length) shots[shots.length - 1].transition = 'cut';
  return { shots, warnings };
}
