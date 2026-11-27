// Audio mixing: gain keyframes (output frame -> gain) for the music bed and clip sound.
// Music ducks under speech; clip sound comes up for speech and sits low under music otherwise.

const RAMP = 6; // frames
const DUCK = 0.25; // music gain multiplier while someone is talking

const clamp01 = (v, d) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);

export function normalizeAudio(audio = {}, preset = {}) {
  return {
    musicVolume: clamp01(audio.musicVolume, preset.musicVolume ?? 0.8),
    clipVolume: clamp01(audio.clipVolume, preset.clipVolumeWithMusic ?? 0.2),
    speechVolume: clamp01(audio.speechVolume, 1),
    duckUnderSpeech: audio.duckUnderSpeech !== false,
  };
}

function pushKey(keys, frame, gain) {
  const f = Math.max(0, Math.round(frame));
  const last = keys[keys.length - 1];
  if (last && f <= last[0]) {
    if (f === last[0]) last[1] = gain;
    return;
  }
  keys.push([f, Math.round(gain * 1000) / 1000]);
}

// Build a piecewise-linear envelope that sits at `base` and moves to `active` inside each span.
function envelope(durationInFrames, spans, base, active, { fadeIn = 0, fadeOut = 0 } = {}) {
  const keys = [];
  pushKey(keys, 0, fadeIn ? 0 : base);
  if (fadeIn) pushKey(keys, fadeIn, base);
  for (const s of spans) {
    const a = Math.max(fadeIn, s.from - RAMP);
    const b = Math.min(durationInFrames - fadeOut, s.to + RAMP);
    if (b <= a) continue;
    pushKey(keys, a, base);
    pushKey(keys, Math.min(b, a + RAMP), active);
    pushKey(keys, Math.max(a + RAMP, b - RAMP), active);
    pushKey(keys, b, base);
  }
  if (fadeOut) pushKey(keys, durationInFrames - fadeOut, base);
  pushKey(keys, durationInFrames, fadeOut ? 0 : base);
  return keys;
}

export function buildMix({ durationInFrames, speech = [], audio, hasMusic }) {
  const a = normalizeAudio(audio);
  if (!hasMusic) {
    // No music bed: clip audio plays at full level throughout.
    return { music: null, clip: [[0, 1], [durationInFrames, 1]] };
  }
  const duck = a.duckUnderSpeech ? a.musicVolume * DUCK : a.musicVolume;
  const fadeOut = Math.min(45, Math.floor(durationInFrames / 4));
  return {
    music: envelope(durationInFrames, a.duckUnderSpeech ? speech : [], a.musicVolume, duck, { fadeIn: RAMP, fadeOut }),
    clip: envelope(durationInFrames, speech, a.clipVolume, a.speechVolume),
  };
}

export function gainAt(keys, frame) {
  if (!keys?.length) return 1;
  if (frame <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [f1, g1] = keys[i];
    if (frame <= f1) {
      const [f0, g0] = keys[i - 1];
      return f1 === f0 ? g1 : g0 + ((g1 - g0) * (frame - f0)) / (f1 - f0);
    }
  }
  return keys[keys.length - 1][1];
}
