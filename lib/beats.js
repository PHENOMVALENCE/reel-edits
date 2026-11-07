// Lightweight beat tracker for the music track. Runs on the phone with no server:
// onset envelope from log-energy flux, tempo by autocorrelation, phase by comb scoring.

const HOP = 512;
const WIN = 1024;

export function detectBeats(samples, sampleRate) {
  const frames = Math.floor((samples.length - WIN) / HOP);
  if (frames < 16) return { bpm: null, beats: [] };

  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const start = f * HOP;
    for (let i = 0; i < WIN; i++) sum += samples[start + i] * samples[start + i];
    energy[f] = Math.log(1e-6 + sum / WIN);
  }
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) onset[f] = Math.max(0, energy[f] - energy[f - 1]);

  const framesPerSecond = sampleRate / HOP;
  const minLag = Math.floor((60 / 180) * framesPerSecond);
  const maxLag = Math.ceil((60 / 70) * framesPerSecond);
  let bestLag = 0;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0;
    for (let f = lag; f < frames; f++) score += onset[f] * onset[f - lag];
    score /= frames - lag;
    // Gentle preference for tempos near 120 BPM to avoid half/double-time picks.
    const bpm = (60 * framesPerSecond) / lag;
    score *= Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (!bestLag) return { bpm: null, beats: [] };

  const period = bestLag;
  let bestPhase = 0;
  let bestPhaseScore = -Infinity;
  for (let phase = 0; phase < period; phase++) {
    let score = 0;
    for (let f = phase; f < frames; f += period) score += onset[f] + 0.5 * (onset[f - 1] || 0) + 0.5 * (onset[f + 1] || 0);
    if (score > bestPhaseScore) {
      bestPhaseScore = score;
      bestPhase = phase;
    }
  }

  const beats = [];
  for (let f = bestPhase; f < frames; f += period) {
    // Nudge each beat to the strongest onset within ±2 frames.
    let peak = f;
    for (let d = -2; d <= 2; d++) if (onset[f + d] > onset[peak]) peak = f + d;
    beats.push(((peak * HOP) + WIN / 2) / sampleRate);
  }
  return { bpm: Math.round((60 * framesPerSecond) / period), beats };
}

// Browser helper: decode a music file and return beats.
export async function analyzeMusicFile(file) {
  const buffer = await file.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    const audio = await ctx.decodeAudioData(buffer);
    const mono = new Float32Array(audio.length);
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const data = audio.getChannelData(c);
      for (let i = 0; i < data.length; i++) mono[i] += data[i] / audio.numberOfChannels;
    }
    return { ...detectBeats(mono, audio.sampleRate), duration: audio.duration };
  } finally {
    ctx.close?.();
  }
}
