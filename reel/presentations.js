'use client';
// Transition renderers. Only transform, opacity and clip-path are used,
// because those work in both the live preview and Remotion's in-browser renderer.

import React from 'react';
import { AbsoluteFill, Easing } from 'remotion';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { TRANSITIONS } from '../lib/catalog.js';

const ease = Easing.inOut(Easing.cubic);
const h = React.createElement;

const Dip = ({ presentationProgress: p, presentationDirection: dir, children, passedProps }) => {
  if (dir === 'exiting') {
    return h(AbsoluteFill, { style: { backgroundColor: passedProps.color } },
      h(AbsoluteFill, { style: { opacity: p < 0.5 ? 1 - p * 2 : 0 } }, children));
  }
  return h(AbsoluteFill, { style: { opacity: p < 0.5 ? 0 : (p - 0.5) * 2 } }, children);
};

const Whip = ({ presentationProgress, presentationDirection: dir, children }) => {
  const p = ease(presentationProgress);
  const transform = dir === 'exiting' ? `translateX(${-p * 100}%) scale(${1 + p * 0.08})` : `translateX(${(1 - p) * 100}%) scale(${1.08 - p * 0.08})`;
  return h(AbsoluteFill, { style: { transform } }, children);
};

const Zoom = ({ presentationProgress, presentationDirection: dir, children }) => {
  const p = ease(presentationProgress);
  const style = dir === 'exiting' ? { transform: `scale(${1 + p * 0.6})`, opacity: 1 - p } : { transform: `scale(${1.25 - p * 0.25})`, opacity: p };
  return h(AbsoluteFill, { style }, children);
};

const Circle = ({ presentationProgress, presentationDirection: dir, children }) => {
  if (dir === 'exiting') return h(AbsoluteFill, null, children);
  const p = ease(presentationProgress);
  return h(AbsoluteFill, { style: { clipPath: `circle(${p * 80}% at 50% 50%)` } }, children);
};

const Wipe = ({ presentationProgress, presentationDirection: dir, children }) => {
  if (dir === 'exiting') return h(AbsoluteFill, null, children);
  const p = ease(presentationProgress);
  return h(AbsoluteFill, { style: { clipPath: `inset(0 ${(1 - p) * 100}% 0 0)` } }, children);
};

const custom = (component, props = {}) => ({ component, props });

export function presentationFor(id) {
  switch (id) {
    case 'fade': return fade();
    case 'push_left': return slide({ direction: 'from-right' });
    case 'push_up': return slide({ direction: 'from-bottom' });
    case 'dip_black': return custom(Dip, { color: '#000' });
    case 'dip_white': return custom(Dip, { color: '#fff' });
    case 'whip': return custom(Whip);
    case 'zoom': return custom(Zoom);
    case 'circle': return custom(Circle);
    case 'wipe': return custom(Wipe);
    default: return null;
  }
}

export const hasPresentation = (id) => id !== 'cut' && Boolean(TRANSITIONS[id]);
