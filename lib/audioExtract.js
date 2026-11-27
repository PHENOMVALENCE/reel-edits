// Speech audio for transcription: decode a clip's soundtrack on the device, downmix to 16 kHz mono,
// and encode small WAV chunks that fit the server's upload limit.

export const SPEECH_RATE = 16000;
export const CHUNK_SECONDS = 110; // ~3.5 MB of 16-bit mono WAV per chunk

export function downmix(channels) {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length;
  return out;
}

// Linear-interpolation resampler; plenty for speech recognition input.
export function resample(samples, fromRate, toRate = SPEECH_RATE) {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const j = Math.floor(x);
    const t = x - j;
    out[i] = (samples[j] ?? 0) * (1 - t) + (samples[j + 1] ?? samples[j] ?? 0) * t;
  }
  return out;
}

export function encodeWav(samples, sampleRate = SPEECH_RATE) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buffer);
  const text = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

export function chunkSamples(samples, sampleRate = SPEECH_RATE, maxSeconds = CHUNK_SECONDS) {
  const size = Math.floor(maxSeconds * sampleRate);
  const chunks = [];
  for (let i = 0; i < samples.length; i += size) {
    chunks.push({ offset: i / sampleRate, samples: samples.subarray(i, Math.min(samples.length, i + size)) });
  }
  return chunks;
}

// RMS level, to skip clips that are effectively silent instead of paying to transcribe them.
export function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

// Browser only: decode the clip's audio track. Returns null when there is no audio track.
export async function extractSpeechAudio(file) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, c) => decoded.getChannelData(c));
    const mono = resample(downmix(channels), decoded.sampleRate, SPEECH_RATE);
    return { samples: mono, sampleRate: SPEECH_RATE, duration: mono.length / SPEECH_RATE, level: rms(mono) };
  } catch {
    return null; // no audio track, or a codec the browser can't decode
  } finally {
    ctx.close?.();
  }
}
