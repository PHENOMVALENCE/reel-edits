'use client';
// The reel composition. The preview player and the MP4 export both render this,
// so what you see on the phone is what gets exported.

import React from 'react';
import { AbsoluteFill, Img, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import { Video, Audio } from '@remotion/media';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { loadFont } from '@remotion/fonts';
import { presentationFor, hasPresentation } from './presentations.js';
import { transitionFrames } from '../lib/planner.js';
import { PRESETS } from '../lib/presets.js';

// Bundled with the app (public/fonts, SIL OFL) so titles look the same offline and in the export.
const fontFamily = 'Montserrat';
if (typeof window !== 'undefined') {
  loadFont({ family: fontFamily, url: `${window.location.origin}/fonts/montserrat-latin-800-normal.woff2`, weight: '800' }).catch(() => {});
}
const h = React.createElement;
const fill = { width: '100%', height: '100%', objectFit: 'cover' };
const videoFill = { width: '100%', height: '100%' };

function effectTransform(effect, frame, duration, index) {
  const t = duration > 1 ? frame / (duration - 1) : 0;
  switch (effect) {
    case 'ken_burns': {
      const dir = index % 2 ? 1 : -1;
      return `scale(${1.06 + 0.12 * t}) translateX(${dir * (-2 + 4 * t)}%)`;
    }
    case 'slow_push':
      return `scale(${1 + 0.08 * t})`;
    case 'punch_in': {
      const s = interpolate(frame, [0, 4, duration], [1, 1.12, 1.16], { extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
      return `scale(${s})`;
    }
    case 'shake': {
      const k = Math.max(0, 1 - frame / 8);
      return `translate(${Math.sin(frame * 2.7) * 18 * k}px, ${Math.cos(frame * 3.3) * 14 * k}px) scale(1.04)`;
    }
    default:
      return undefined;
  }
}

function Shot({ shot, asset, index, clipVolume }) {
  const frame = useCurrentFrame();
  const transform = effectTransform(shot.effect, frame, shot.frames, index);
  const media = asset.kind === 'video'
    ? h(Video, { src: asset.url, trimBefore: shot.from, volume: clipVolume, muted: clipVolume === 0, objectFit: 'cover', style: videoFill })
    : h(Img, { src: asset.url, style: fill });
  return h(AbsoluteFill, { style: { backgroundColor: '#000', overflow: 'hidden' } },
    h(AbsoluteFill, { style: { transform } }, media));
}

// Balanced line breaks: aim for lines of similar length, max 16 characters.
function wrapLines(text, limit = 16) {
  const total = String(text).trim().length;
  const max = Math.min(limit, Math.ceil(total / Math.ceil(total / limit)) + 3);
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if ((line + ' ' + word).trim().length > max && line) {
      lines.push(line);
      line = word;
    } else line = (line + ' ' + word).trim();
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

// Text is drawn as SVG so the font is embedded in the exported MP4.
function TextCard({ text, y, size = 96, frames }) {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 14, mass: 0.6 } });
  const lines = wrapLines(text);
  return h(AbsoluteFill, { style: { opacity: Math.min(1, (frame + 2) / 4, (frames - frame) / 6), transform: `scale(${0.85 + 0.15 * pop})` } },
    h('svg', { width, height: 1920, viewBox: `0 0 ${width} 1920` },
      lines.map((line, i) => h('text', {
        key: i, x: width / 2, y: y + i * size * 1.15, textAnchor: 'middle',
        style: { fontFamily, fontWeight: 800, fontSize: size, fill: '#fff', stroke: '#000', strokeWidth: size * 0.12, paintOrder: 'stroke', letterSpacing: -1 },
      }, line.toUpperCase()))));
}

export function Reel({ timeline, assets, music }) {
  const { durationInFrames, fps } = useVideoConfig();
  if (!timeline?.shots?.length) return h(AbsoluteFill, { style: { backgroundColor: '#000' } });
  const preset = PRESETS[timeline.presetId] ?? PRESETS.hype;
  const clipVolume = music ? preset.clipVolumeWithMusic : 1;
  const series = [];
  timeline.shots.forEach((shot, i) => {
    const asset = assets[shot.assetId];
    if (!asset) return;
    series.push(h(TransitionSeries.Sequence, { key: `s${i}`, durationInFrames: shot.frames, premountFor: 15 },
      h(Shot, { shot, asset, index: i, clipVolume })));
    const next = timeline.shots[i + 1];
    const overlap = next ? transitionFrames(shot.transition, shot, next) : 0;
    if (next && overlap > 0 && hasPresentation(shot.transition)) {
      series.push(h(TransitionSeries.Transition, { key: `t${i}`, timing: linearTiming({ durationInFrames: overlap }), presentation: presentationFor(shot.transition) }));
    }
  });
  const fadeOut = Math.min(durationInFrames, Math.round(1.5 * fps));
  return h(AbsoluteFill, { style: { backgroundColor: '#000' } },
    h(TransitionSeries, null, series),
    timeline.title?.text ? h(Sequence, { durationInFrames: timeline.title.frames }, h(TextCard, { text: timeline.title.text, y: 520, frames: timeline.title.frames })) : null,
    timeline.endCard?.text ? h(Sequence, { from: Math.max(0, durationInFrames - timeline.endCard.frames) }, h(TextCard, { text: timeline.endCard.text, y: 900, size: 84, frames: timeline.endCard.frames + 6 })) : null,
    music ? h(Audio, {
      src: music.url, loop: true,
      volume: (f) => preset.musicVolume * interpolate(f, [0, 6, durationInFrames - fadeOut, durationInFrames], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
    }) : null);
}

export const REEL_ID = 'reel';
