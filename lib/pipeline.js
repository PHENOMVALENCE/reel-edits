// The AI-driven editing pipeline, run from the browser:
//   UPLOAD -> MEDIA ANALYSIS -> TRANSCRIPTION -> MUSIC ANALYSIS -> CLAUDE EDITORIAL PLANNING
//   -> MOTION GRAPHICS -> AUDIO MIXING -> REMOTION RENDER -> QUALITY CONTROL
// Browser work (frames, audio decode) and server calls are injected, so this runs in tests too.
// Whenever Claude or transcription is unavailable, the deterministic planner takes over.

import { FPS } from './catalog.js';
import { snapToBeats } from './planner.js';
import { planToTimeline, finalizeTimeline, fallbackTimeline, timelineToPlan, spliceSection } from './editorial.js';
import { mergeTranscripts } from './transcript.js';
import { chunkSamples, encodeWav } from './audioExtract.js';
import { qualityCheck } from './qc.js';

export const STAGES = [
  { id: 'upload', label: 'Upload' },
  { id: 'analysis', label: 'Media analysis' },
  { id: 'transcription', label: 'Transcription' },
  { id: 'music', label: 'Music analysis' },
  { id: 'planning', label: 'Claude editorial planning' },
  { id: 'graphics', label: 'Motion graphics' },
  { id: 'mixing', label: 'Audio mixing' },
  { id: 'render', label: 'Remotion render' },
  { id: 'qc', label: 'Quality control' },
];

const SILENCE_RMS = 0.003;

export function newProjectContext(projectId) {
  return { projectId, analysis: null, analysisKey: '', transcripts: {}, frames: null, plan: null, history: [] };
}

export const assetsKey = (assets) => assets.map((a) => `${a.id}:${a.durationFrames ?? 'p'}`).join('|');

function slimAssets(assets, transcripts) {
  return assets.map((a) => ({
    id: a.id, kind: a.kind, durationFrames: a.durationFrames ?? 0, orientation: a.orientation,
    hasSpeech: Boolean(transcripts?.[a.id]?.words?.length),
  }));
}

export function agentPayload(opts, ctx, extra = {}) {
  return {
    projectId: ctx.projectId,
    model: opts.model || undefined,
    assets: slimAssets(opts.assets, ctx.transcripts),
    transcripts: ctx.transcripts,
    music: opts.music ? { bpm: opts.music.bpm, duration: opts.music.duration, beats: opts.music.beats } : null,
    brief: opts.brief,
    title: opts.title,
    endText: opts.endText,
    presetId: opts.presetId,
    targetSeconds: opts.targetSeconds,
    analysis: ctx.analysis,
    ...extra,
  };
}

export async function transcribeClip({ api, audio, projectId, provider }) {
  const parts = [];
  for (const chunk of chunkSamples(audio.samples, audio.sampleRate)) {
    const { transcript } = await api.transcribe({
      wav: encodeWav(chunk.samples, audio.sampleRate), seconds: chunk.samples.length / audio.sampleRate, projectId, provider,
    });
    parts.push({ offset: chunk.offset, transcript });
  }
  return mergeTranscripts(parts);
}

function applyBeats(timeline, assets, music, transcripts) {
  // Snap hard cuts to the beat only where nobody is speaking, so no word is clipped.
  if (!music?.beats?.length) return 0;
  const speaking = new Set(Object.entries(transcripts || {}).filter(([, t]) => t?.words?.length).map(([id]) => id));
  if (timeline.shots.some((s) => speaking.has(s.assetId))) return 0;
  return snapToBeats(timeline.shots, assets, music.beats);
}

export async function runPipeline(opts) {
  const { assets, music, api, ai = {}, deps = {}, onStage = () => {}, review = true } = opts;
  const ctx = opts.context || newProjectContext(opts.projectId);
  const notes = [];
  const stage = (id, status, note) => onStage(id, status, note);
  let source = 'fallback';

  // UPLOAD
  stage('upload', 'running');
  if (!assets?.length) {
    stage('upload', 'error', 'Add some clips or photos first.');
    return { timeline: null, notes: ['Add some clips or photos first.'], context: ctx, source };
  }
  stage('upload', 'done', `${assets.length} assets`);

  // MEDIA ANALYSIS: timestamped frames for Claude (re-used while the footage is unchanged).
  stage('analysis', 'running');
  const key = assetsKey(assets);
  if (ai.claude && deps.sampleFrames && (ctx.analysisKey !== key || !ctx.frames)) {
    try {
      ctx.frames = await deps.sampleFrames(assets);
      ctx.analysis = null;
      ctx.analysisKey = key;
    } catch (e) {
      notes.push(`Couldn't read frames: ${e.message}`);
    }
  }
  stage('analysis', 'done', ctx.frames ? `${ctx.frames.length} timestamped frames` : 'probed durations and orientation');

  // TRANSCRIPTION
  const videos = assets.filter((a) => a.kind === 'video');
  if (ai.transcription && deps.extractAudio && videos.length) {
    stage('transcription', 'running');
    let done = 0;
    let failed = 0;
    for (const a of videos) {
      if (ctx.transcripts[a.id]) {
        done++;
        continue;
      }
      try {
        const audio = await deps.extractAudio(a.id);
        if (!audio || audio.level < SILENCE_RMS) {
          ctx.transcripts[a.id] = { text: '', words: [], segments: [], silent: true };
        } else {
          ctx.transcripts[a.id] = await transcribeClip({ api, audio, projectId: ctx.projectId, provider: ai.transcription });
        }
        done++;
        stage('transcription', 'running', `${done}/${videos.length} clips`);
      } catch (e) {
        failed++;
        notes.push(`${a.id}: transcription failed (${e.message}). Captions skip this clip.`);
        if (e.code === 'budget_exceeded' || e.code === 'not_configured' || e.code === 'access_token') break;
      }
    }
    const words = Object.values(ctx.transcripts).reduce((n, t) => n + (t.words?.length || 0), 0);
    stage('transcription', failed && !done ? 'error' : 'done', `${words} words from ${done} clips${failed ? `, ${failed} failed` : ''}`);
  } else {
    stage('transcription', 'skipped', videos.length ? 'no transcription provider' : 'no video clips');
  }

  // MUSIC ANALYSIS (beat tracking already ran on the device when the track was added)
  stage('music', music ? 'done' : 'skipped', music ? (music.bpm ? `${music.bpm} BPM, ${music.beats.length} beats` : 'no steady beat') : 'no music');

  // CLAUDE EDITORIAL PLANNING
  stage('planning', 'running');
  let timeline = null;
  let planWarnings = [];
  if (ai.claude) {
    try {
      if (!ctx.analysis) {
        stage('planning', 'running', 'Claude is reviewing the footage…');
        const res = await api.agent('analyze', agentPayload(opts, ctx, { frames: (ctx.frames || []).map((f) => ({ assetId: f.assetId, time: f.time, dataUrl: f.dataUrl })) }));
        ctx.analysis = res.data;
        ctx.history.push({ step: 'analyze', at: Date.now(), model: res.model });
      }
      stage('planning', 'running', 'Claude is planning the edit…');
      // A revision builds on the edit as it stands now, including any manual changes.
      const currentPlan = opts.revision && opts.currentTimeline ? mergePurposes(timelineToPlan(opts.currentTimeline), ctx.plan) : undefined;
      const planned = await api.agent('plan', agentPayload(opts, ctx, { revision: opts.revision, currentPlan }));
      let plan = planned.data;
      ctx.history.push({ step: 'plan', at: Date.now(), model: planned.model, notes: plan.notes });
      if (review) {
        try {
          stage('planning', 'running', 'Claude is reviewing its cut…');
          const reviewed = await api.agent('review', agentPayload(opts, ctx, { currentPlan: plan }));
          const { changes, ...improved } = reviewed.data;
          plan = improved;
          ctx.history.push({ step: 'review', at: Date.now(), model: reviewed.model, changes });
          if (changes?.length) notes.push(`Claude's review: ${changes.slice(0, 3).join(' · ')}`);
        } catch (e) {
          notes.push(`Review pass skipped: ${e.message}`);
        }
      }
      ({ timeline, warnings: planWarnings } = planToTimeline(plan, { assets, targetSeconds: opts.targetSeconds, presetId: opts.presetId }));
      ctx.plan = plan;
      source = 'claude';
      if (plan.notes) notes.push(plan.notes);
    } catch (e) {
      notes.push(`Claude unavailable (${e.message}). Used the free planner instead.`);
    }
  }
  if (!timeline) {
    const fb = fallbackTimeline({ assets, targetSeconds: opts.targetSeconds, presetId: opts.presetId, beats: music?.beats, title: opts.title, endText: opts.endText });
    timeline = fb.timeline;
    planWarnings = fb.warnings;
    ctx.plan = timeline ? timelineToPlan(timeline) : null;
  } else {
    const snapped = applyBeats(timeline, assets, music, ctx.transcripts);
    if (snapped) notes.push(`${snapped} cuts snapped to the beat.`);
  }
  notes.push(...planWarnings);
  stage('planning', source === 'claude' ? 'done' : ai.claude ? 'fallback' : 'skipped', source === 'claude' ? `${timeline.shots.length} shots by Claude` : `free planner, ${timeline?.shots.length ?? 0} shots`);

  const finished = finishTimeline(timeline, { assets, music, transcripts: ctx.transcripts, targetSeconds: opts.targetSeconds, onStage });
  return { ...finished, notes: [...notes, ...finished.notes], context: ctx, source };
}

// MOTION GRAPHICS + AUDIO MIXING + pre-render QC. Also used after manual edits and section regeneration.
export function finishTimeline(timeline, { assets, music, transcripts, targetSeconds, onStage = () => {} }) {
  if (!timeline) return { timeline, notes: [], qc: null };
  onStage('graphics', 'running');
  const final = finalizeTimeline(timeline, { transcripts, hasMusic: Boolean(music) });
  onStage('graphics', 'done', final.captions.length ? `${final.captions.length} caption lines (${final.captionStyle.style})` : 'no speech to caption');
  onStage('mixing', 'done', music
    ? `music ${final.audio.duckUnderSpeech && final.speechFrames ? `ducked under ${(final.speechFrames / FPS).toFixed(1)} s of speech` : 'bed at constant level'}`
    : 'clip audio only');
  onStage('render', 'pending', 'export when ready');
  const qc = qualityCheck({ timeline: final, assets, transcripts, targetSeconds });
  onStage('qc', qc.ok ? 'done' : 'error', qc.issues.length ? `${qc.issues.length} issue${qc.issues.length > 1 ? 's' : ''}` : 'all checks passed');
  return { timeline: final, notes: qc.issues.map((i) => `${i.level === 'error' ? 'QC error' : 'QC'}: ${i.message}`), qc };
}

// Regenerate one section with Claude, leaving the rest of the edit untouched.
export async function regenerateSection(opts, timeline, sectionId, instruction) {
  const ctx = opts.context;
  const currentPlan = mergePurposes(timelineToPlan(timeline), ctx.plan);
  const res = await opts.api.agent('section', agentPayload(opts, ctx, { currentPlan, sectionId, instruction }));
  const { timeline: next, warnings } = spliceSection(timeline, sectionId, res.data.section, { assets: opts.assets });
  ctx.plan = mergePurposes(timelineToPlan(next), { sections: [...(ctx.plan?.sections || []).filter((s) => s.id !== sectionId), res.data.section] });
  ctx.history.push({ step: 'section', at: Date.now(), sectionId, instruction, model: res.model });
  const finished = finishTimeline(next, { assets: opts.assets, music: opts.music, transcripts: ctx.transcripts, targetSeconds: opts.targetSeconds, onStage: opts.onStage });
  return { ...finished, notes: [...warnings, ...(res.data.notes ? [res.data.notes] : []), ...finished.notes] };
}

function mergePurposes(plan, previous) {
  const purposes = Object.fromEntries((previous?.sections || []).map((s) => [s.id, s.purpose]));
  return { ...plan, sections: plan.sections.map((s) => ({ ...s, purpose: purposes[s.id] || s.purpose || '' })) };
}
