'use client';
// Motion captions, drawn as SVG so the bundled font is embedded in the export.
// Cue and word times are output frames (lib/captions.js), so preview and MP4 stay in sync.

import React from 'react';
import { AbsoluteFill, Sequence, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { CAPTION_SAFE } from '../lib/catalog.js';

const h = React.createElement;
const ACCENT = '#FFE14D';
const MAX_WIDTH = 940;

// Split a cue into at most two balanced rows and pick a font size that fits the safe width.
export function layoutCue(words, baseSize = 76) {
  const texts = words.map((w) => w.text.toUpperCase());
  const total = texts.join(' ').length;
  let rows = [words.map((_, i) => i)];
  if (total > 16 && words.length > 1) {
    let best = 1;
    let bestDiff = Infinity;
    for (let k = 1; k < words.length; k++) {
      const a = texts.slice(0, k).join(' ').length;
      const diff = Math.abs(a - (total - a - 1));
      if (diff < bestDiff) {
        bestDiff = diff;
        best = k;
      }
    }
    rows = [words.slice(0, best).map((_, i) => i), words.slice(best).map((_, i) => i + best)];
  }
  const longest = Math.max(...rows.map((r) => r.map((i) => texts[i]).join(' ').length));
  const size = Math.max(44, Math.min(baseSize, Math.floor(MAX_WIDTH / (longest * 0.66))));
  return { rows, size, texts };
}

function CaptionCue({ cue, style, y, fontFamily }) {
  const frame = useCurrentFrame(); // frames since the cue started
  const { fps, width } = useVideoConfig();
  const abs = cue.from + frame;
  const { rows, size, texts } = layoutCue(cue.words);
  const lineStyle = { fontFamily, fontWeight: 800, fontSize: size, stroke: '#000', strokeWidth: size * 0.14, paintOrder: 'stroke', letterSpacing: -0.5 };
  return h(AbsoluteFill, { style: { opacity: style === 'subtitle' ? Math.min(1, (frame + 1) / 3) : 1 } },
    h('svg', { width, height: 1920, viewBox: `0 0 ${width} 1920` },
      rows.map((row, r) => h('text', { key: r, x: width / 2, y: y + (r - (rows.length - 1) / 2) * size * 1.18, textAnchor: 'middle', style: lineStyle },
        row.map((i, k) => {
          const w = cue.words[i];
          const spoken = abs >= w.from;
          const active = abs >= w.from && abs < w.to;
          let fill = '#fff';
          let opacity = 1;
          if (style === 'karaoke') fill = active || (w.emphasis && spoken) ? ACCENT : '#fff';
          if (style === 'pop') {
            opacity = spoken ? 1 : 0;
            fill = w.emphasis ? ACCENT : '#fff';
          }
          if (style === 'subtitle') fill = w.emphasis ? ACCENT : '#fff';
          const pop = style === 'pop' && spoken ? 0.85 + 0.15 * spring({ frame: abs - w.from, fps, config: { damping: 12, mass: 0.4 } }) : 1;
          return h('tspan', { key: i, fill, opacity, dx: k ? size * 0.28 : 0, style: { fontSize: size * pop * (style === 'karaoke' && active ? 1.06 : 1) } }, texts[i]);
        })))));
}

export function Captions({ captions, captionStyle, fontFamily }) {
  const style = captionStyle?.style;
  if (!captions?.length || !style || style === 'none') return null;
  const y = captionStyle.position === 'middle' ? CAPTION_SAFE.middleY : CAPTION_SAFE.lowerY;
  return h(React.Fragment, null, captions.map((cue, i) => h(Sequence, { key: i, from: cue.from, durationInFrames: Math.max(1, cue.to - cue.from), layout: 'none' },
    h(CaptionCue, { cue, style, y, fontFamily }))));
}
