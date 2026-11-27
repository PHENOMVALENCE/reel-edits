// Validates and trims everything the browser sends to the editorial agent.
// Browser input is untrusted: sizes are capped, shapes are checked, unknown fields dropped.

import { MIN_SECONDS, MAX_SECONDS, FPS } from '../catalog.js';
import { PRESETS } from '../presets.js';
import { validateSchema } from '../ai/validate.js';
import { ANALYSIS_SCHEMA, PLAN_SCHEMA } from '../ai/schemas.js';

const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'bad_request' });
const s = (v, max) => String(v ?? '').slice(0, max);
const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function cleanTranscript(t) {
  if (!t || typeof t !== 'object') return null;
  const words = (Array.isArray(t.words) ? t.words : []).slice(0, 20000).map((w) => ({
    word: s(w.word, 60), start: n(w.start), end: n(w.end), confidence: w.confidence == null ? null : n(w.confidence), speaker: w.speaker ? s(w.speaker, 30) : null,
  }));
  const segments = (Array.isArray(t.segments) ? t.segments : []).slice(0, 4000).map((x) => ({
    start: n(x.start), end: n(x.end), text: s(x.text, 1000), confidence: x.confidence == null ? null : n(x.confidence), speaker: x.speaker ? s(x.speaker, 30) : null,
  }));
  return { words, segments, text: s(t.text, 50000) };
}

export function parseAgentInput(body, config, step) {
  if (!body || typeof body !== 'object') throw bad('Expected a JSON body.');
  const assets = (Array.isArray(body.assets) ? body.assets : []).slice(0, 200).map((a) => ({
    id: s(a.id, 8).toUpperCase(),
    kind: a.kind === 'video' ? 'video' : 'photo',
    durationFrames: Math.max(0, Math.round(n(a.durationFrames))),
    orientation: ['portrait', 'landscape', 'square'].includes(a.orientation) ? a.orientation : 'portrait',
    hasSpeech: Boolean(a.hasSpeech),
  })).filter((a) => /^[CP]\d{1,4}$/.test(a.id));
  if (!assets.length) throw bad('No assets were sent.');

  const frames = (Array.isArray(body.frames) ? body.frames : []).slice(0, config.maxFrames).map((f) => {
    const m = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(f.dataUrl || ''));
    if (!m || !IMAGE_TYPES.has(m[1])) throw bad('Frames must be JPEG, PNG or WebP data URLs.');
    if (m[2].length * 0.75 > config.maxFrameBytes) throw bad('A frame is too large; send smaller thumbnails.');
    return { assetId: s(f.assetId, 8).toUpperCase(), time: n(f.time), mediaType: m[1], data: m[2] };
  });

  const transcripts = {};
  for (const [id, t] of Object.entries(body.transcripts || {}).slice(0, 200)) {
    const clean = cleanTranscript(t);
    if (clean && assets.some((a) => a.id === id)) transcripts[id] = clean;
  }

  const music = body.music && typeof body.music === 'object' ? {
    bpm: body.music.bpm ? Math.round(n(body.music.bpm)) : null,
    duration: n(body.music.duration),
    beats: (Array.isArray(body.music.beats) ? body.music.beats : []).slice(0, 2000).map((b) => n(b)),
  } : null;

  const checkSchema = (value, schema, label) => {
    if (value == null) return null;
    const errors = validateSchema(schema, value);
    if (errors.length) throw bad(`${label} is malformed: ${errors.slice(0, 2).join('; ')}`);
    return value;
  };

  const ctx = {
    projectId: s(body.projectId, 64).replace(/[^\w-]/g, '') || null,
    model: body.model ? s(body.model, 64) : null,
    assets,
    frames,
    transcripts,
    music,
    brief: s(body.brief, 1000),
    title: s(body.title, 80),
    endText: s(body.endText, 80),
    presetId: PRESETS[body.presetId] ? body.presetId : 'hype',
    targetSeconds: Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(n(body.targetSeconds, 60)))),
    analysis: checkSchema(body.analysis, ANALYSIS_SCHEMA, 'Analysis'),
    currentPlan: checkSchema(body.currentPlan, PLAN_SCHEMA, 'Current plan'),
    revision: s(body.revision, 1000),
    sectionId: s(body.sectionId, 40),
    instruction: s(body.instruction, 500),
  };
  if (step === 'section' && !ctx.sectionId) throw bad('sectionId is required.');
  // Footage the planner may not exceed, for prompts.
  ctx.totalFootageSeconds = assets.reduce((t, a) => t + (a.kind === 'video' ? a.durationFrames / FPS : 3), 0);
  return ctx;
}
