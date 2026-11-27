import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { FPS } from '../lib/catalog.js';
import { buildTimeline, shotStarts } from '../lib/planner.js';
import { mapWordsToTimeline, buildCaptionCues, clippedWords } from '../lib/captions.js';
import { buildMix, gainAt } from '../lib/audioMix.js';
import { planToTimeline, spliceSection, finalizeTimeline } from '../lib/editorial.js';
import { qualityCheck, checkRenderedDuration } from '../lib/qc.js';
import { runPipeline, newProjectContext, regenerateSection } from '../lib/pipeline.js';
import { parseWhisperVerbose } from '../lib/server/transcription/openaiWhisper.js';
import { parseWhisperCpp } from '../lib/server/transcription/whisperCpp.js';
import { openaiWhisper } from '../lib/server/transcription/openaiWhisper.js';
import { mergeTranscripts, wordErrorRate, approximateWords } from '../lib/transcript.js';
import { encodeWav, chunkSamples, resample } from '../lib/audioExtract.js';
import { claudeCost, transcriptionCost, priceFor } from '../lib/ai/pricing.js';
import { MemoryStore, FileStore } from '../lib/server/usage/store.js';
import { assertWithinBudget, recordTranscriptionUsage, saveBudgets, summarize, usageReport } from '../lib/server/usage/budget.js';
import { clip, photo, samplePlan, testConfig, jsonResponse } from './helpers.mjs';

const assets = [clip('C1', 40), clip('C2', 55), photo('P1')];

// ---- Transcription -------------------------------------------------------

const WHISPER_FIXTURE = {
  text: 'Welcome to the beach. Look at that sunset.',
  language: 'english',
  duration: 6.2,
  segments: [
    { id: 0, start: 0.5, end: 2.4, text: ' Welcome to the beach.', avg_logprob: -0.1, no_speech_prob: 0.01 },
    { id: 1, start: 3.0, end: 5.6, text: ' Look at that sunset.', avg_logprob: -0.9, no_speech_prob: 0.02 },
  ],
  words: [
    { word: 'Welcome', start: 0.5, end: 0.9 }, { word: 'to', start: 0.9, end: 1.1 }, { word: 'the', start: 1.1, end: 1.3 }, { word: 'beach.', start: 1.3, end: 2.4 },
    { word: 'Look', start: 3.0, end: 3.4 }, { word: 'at', start: 3.4, end: 3.6 }, { word: 'that', start: 3.6, end: 4.0 }, { word: 'sunset.', start: 4.0, end: 5.6 },
  ],
};

test('Whisper API verbose_json becomes words, segments and confidence', () => {
  const t = parseWhisperVerbose(WHISPER_FIXTURE);
  assert.equal(t.words.length, 8);
  assert.equal(t.segments.length, 2);
  assert.equal(t.words[0].confidence, Math.round(Math.exp(-0.1) * 1000) / 1000);
  assert.equal(t.words[7].confidence, Math.round(Math.exp(-0.9) * 1000) / 1000);
  assert.equal(t.capabilities.wordTimestamps, 'native');
  assert.equal(t.capabilities.speakers, false);
  assert.equal(t.words[0].speaker, null);
  assert.equal(t.durationSeconds, 6.2);
});

test('Whisper API call sends word+segment granularity and retries a 503', async () => {
  const calls = [];
  const responses = [new Response('busy', { status: 503 }), jsonResponse(WHISPER_FIXTURE)];
  const fetch = async (url, init) => { calls.push({ url, init }); return responses.shift(); };
  const config = testConfig({ transcription: { ...testConfig().transcription, openaiKey: 'sk-test', openaiModel: 'whisper-1' } });
  const t = await openaiWhisper.transcribe({ audio: new ArrayBuffer(8), config, fetch });
  assert.equal(t.words.length, 8);
  assert.equal(calls.length, 2);
  const form = calls[1].init.body;
  assert.equal(form.get('response_format'), 'verbose_json');
  assert.deepEqual(form.getAll('timestamp_granularities[]'), ['word', 'segment']);
  assert.equal(calls[1].init.headers.Authorization, 'Bearer sk-test');
});

test('whisper.cpp output with and without per-word timings', () => {
  const native = parseWhisperCpp({ text: 'hi there', segments: [{ start: 0, end: 1, text: 'hi there', words: [{ word: 'hi', start: 0, end: 0.4, probability: 0.9 }, { word: 'there', start: 0.4, end: 1, probability: 0.8 }] }] });
  assert.equal(native.capabilities.wordTimestamps, 'native');
  assert.equal(native.words[1].confidence, 0.8);
  const approx = parseWhisperCpp({ segments: [{ start: 2, end: 4, text: 'one two three four' }] });
  assert.equal(approx.capabilities.wordTimestamps, 'approximate');
  assert.equal(approx.words.length, 4);
  assert.equal(approx.words[0].start, 2);
  assert.ok(Math.abs(approx.words.at(-1).end - 4) < 0.01);
});

test('chunked transcripts merge with correct offsets', () => {
  const a = parseWhisperVerbose(WHISPER_FIXTURE);
  const merged = mergeTranscripts([{ offset: 110, transcript: a }, { offset: 0, transcript: a }]);
  assert.equal(merged.words.length, 16);
  assert.equal(merged.words[8].start, 110.5);
  assert.equal(merged.segments[2].start, 110.5);
  assert.ok(merged.words.every((w, i) => !i || w.start >= merged.words[i - 1].start));
});

test('transcription accuracy is measured with word error rate', () => {
  const t = parseWhisperVerbose(WHISPER_FIXTURE);
  assert.equal(wordErrorRate('Welcome to the beach. Look at that sunset.', t.text), 0);
  assert.equal(wordErrorRate('welcome to the beach look at the sunset', t.text), 1 / 8);
  assert.equal(wordErrorRate('a b c d', 'a c d'), 0.25);
  assert.equal(approximateWords([{ start: 0, end: 1, text: 'a bb' }]).length, 2);
});

test('speech audio is encoded as 16 kHz mono WAV in upload-sized chunks', () => {
  const wav = new DataView(encodeWav(new Float32Array([0, 0.5, -1, 1]), 16000));
  assert.equal(String.fromCharCode(wav.getUint8(0), wav.getUint8(1), wav.getUint8(2), wav.getUint8(3)), 'RIFF');
  assert.equal(wav.getUint32(24, true), 16000);
  assert.equal(wav.getUint16(22, true), 1);
  assert.equal(wav.getInt16(48, true), -32768);
  const chunks = chunkSamples(new Float32Array(16000 * 250), 16000, 110);
  assert.deepEqual(chunks.map((c) => c.offset), [0, 110, 220]);
  assert.equal(resample(new Float32Array(48000), 48000, 16000).length, 16000);
});

// ---- Timestamp synchronisation ----------------------------------------------

function speechTimeline() {
  // Shot 0: C1 from 0 s for 3 s. Shot 1: C2 from 10 s for 57 s.
  const shots = [
    { assetId: 'C1', from: 0, frames: 3 * FPS, transition: 'cut', effect: 'none', section: 'hook' },
    { assetId: 'C2', from: 10 * FPS, frames: 57 * FPS, transition: 'cut', effect: 'none', section: 'build' },
  ];
  return buildTimeline({ shots, presetId: 'vlog' });
}
const transcripts = {
  C1: { words: [{ word: 'Hello', start: 0.5, end: 1.0 }, { word: 'world.', start: 1.0, end: 1.6 }, { word: 'cut', start: 2.9, end: 3.4 }] },
  C2: { words: [{ word: 'Later', start: 9.0, end: 9.5 }, { word: 'sunset', start: 12.0, end: 12.6, confidence: 0.4 }] },
};

test('transcript words land on the exact output frames after editing', () => {
  const t = speechTimeline();
  const words = mapWordsToTimeline(t, transcripts);
  const starts = shotStarts(t.shots);
  assert.deepEqual(words.map((w) => w.text), ['Hello', 'world.', 'cut', 'sunset']); // 'Later' was trimmed away
  assert.equal(words[0].from, Math.round(0.5 * FPS));
  assert.equal(words[2].to, 3 * FPS); // clipped at the cut
  // 'sunset' is 2 s into C2's trim, so 2 s after shot 1 starts.
  assert.equal(words[3].from, starts[1] + 2 * FPS);
  assert.equal(words[3].to - words[3].from, Math.round(0.6 * FPS));
});

test('timestamps stay in sync through transitions', () => {
  const t = speechTimeline();
  t.shots[0].transition = 'fade';
  const fixed = buildTimeline({ shots: t.shots, presetId: 'vlog' });
  const starts = shotStarts(fixed.shots);
  const w = mapWordsToTimeline(fixed, transcripts).find((x) => x.text === 'sunset');
  assert.equal(w.from, starts[1] + 2 * FPS);
});

test('caption cues group words, break on sentences and never overlap', () => {
  const t = speechTimeline();
  const cues = buildCaptionCues(mapWordsToTimeline(t, transcripts), { maxWordsPerLine: 3, emphasis: ['sunset'], durationInFrames: t.durationInFrames });
  assert.deepEqual(cues.map((c) => c.words.map((w) => w.text).join(' ')), ['Hello world.', 'cut', 'sunset']);
  cues.forEach((c, i) => i && assert.ok(c.from >= cues[i - 1].to));
  assert.equal(cues[2].words[0].emphasis, true);
  assert.deepEqual(clippedWords(t, transcripts).map((w) => w.word), ['cut']);
});

test('QC flags clipped speech and low-confidence caption words', () => {
  const final = finalizeTimeline(speechTimeline(), { transcripts, hasMusic: true });
  const qc = qualityCheck({ timeline: final, assets: [clip('C1', 40), clip('C2', 70)], transcripts, targetSeconds: 60 });
  const codes = qc.issues.map((i) => i.code);
  assert.ok(codes.includes('clipped_speech'));
  assert.ok(codes.includes('caption_confidence'));
  assert.ok(qc.ok, JSON.stringify(qc.issues));
  assert.equal(checkRenderedDuration(60.02, 1800).ok, true);
  assert.equal(checkRenderedDuration(58, 1800).ok, false);
});

test('music ducks under speech and comes back up', () => {
  const mix = buildMix({ durationInFrames: 1800, speech: [{ from: 300, to: 600 }], audio: { musicVolume: 0.8, clipVolume: 0.2, speechVolume: 1, duckUnderSpeech: true }, hasMusic: true });
  assert.equal(gainAt(mix.music, 150), 0.8);
  assert.equal(gainAt(mix.music, 450), 0.2);
  assert.equal(gainAt(mix.music, 900), 0.8);
  assert.equal(gainAt(mix.music, 1800), 0);
  assert.equal(gainAt(mix.clip, 450), 1);
  assert.equal(gainAt(mix.clip, 900), 0.2);
  assert.equal(gainAt(buildMix({ durationInFrames: 900, speech: [], audio: {}, hasMusic: false }).clip, 400), 1);
});

// ---- Plans, sections and the pipeline ------------------------------------------

test('a Claude plan becomes a valid timeline at the exact target length', () => {
  const { timeline } = planToTimeline(samplePlan(), { assets, targetSeconds: 60, presetId: 'cinematic' });
  assert.equal(timeline.durationInFrames, 60 * FPS);
  assert.deepEqual([...new Set(timeline.shots.map((s) => s.section))], ['hook', 'build', 'outro']);
  assert.equal(timeline.captionStyle.style, 'karaoke');
  assert.equal(timeline.title.text, 'Beach day');
});

test('regenerating one section leaves the other sections untouched', () => {
  const { timeline } = planToTimeline(samplePlan(), { assets, targetSeconds: 60, presetId: 'cinematic' });
  const before = timeline.shots.filter((s) => s.section !== 'build');
  const { timeline: next } = spliceSection(timeline, 'build', { id: 'build', purpose: '', shots: [
    { asset: 'C2', start: 30, length: 8, transition: 'cut', effect: 'none', reason: '' },
    { asset: 'C1', start: 20, length: 12, transition: 'cut', effect: 'shake', reason: '' },
  ] }, { assets });
  assert.equal(next.durationInFrames, timeline.durationInFrames);
  assert.deepEqual(next.shots.filter((s) => s.section !== 'build'), before);
  assert.equal(next.shots.filter((s) => s.section === 'build').length, 2);
});

const baseOpts = (api, ai) => ({
  assets, music: null, brief: '', presetId: 'cinematic', targetSeconds: 60, title: '', endText: '', projectId: 'p1',
  context: newProjectContext('p1'), api, ai, deps: { sampleFrames: async () => [{ assetId: 'C1', time: 1, dataUrl: 'data:image/jpeg;base64,AA' }] },
});

test('deterministic fallback runs when AI is off', async () => {
  const stages = {};
  const r = await runPipeline({ ...baseOpts(null, {}), onStage: (id, s) => { stages[id] = s; } });
  assert.equal(r.source, 'fallback');
  assert.equal(r.timeline.durationInFrames, 60 * FPS);
  assert.equal(stages.planning, 'skipped');
  assert.equal(stages.qc, 'done');
});

test('deterministic fallback takes over when Claude fails', async () => {
  const api = { agent: async () => { throw Object.assign(new Error('Claude is temporarily overloaded'), { code: 'overloaded' }); } };
  const stages = {};
  const r = await runPipeline({ ...baseOpts(api, { claude: true }), onStage: (id, s) => { stages[id] = s; } });
  assert.equal(r.source, 'fallback');
  assert.equal(stages.planning, 'fallback');
  assert.ok(r.notes.some((n) => n.includes('free planner')));
  assert.equal(r.timeline.durationInFrames, 60 * FPS);
});

test('Claude pipeline: analyze, plan, review; context is reused for later iterations', async () => {
  const calls = [];
  const api = {
    agent: async (step, payload) => {
      calls.push({ step, payload });
      if (step === 'analyze') return { data: { summary: 'beach', story: '', hookCandidates: [], assets: [], musicFit: '', risks: [] }, model: 'claude-opus-5-5' };
      if (step === 'plan') return { data: samplePlan(), model: 'claude-opus-5-5' };
      if (step === 'review') return { data: { ...samplePlan(), title: 'Better title', changes: ['New title'] }, model: 'claude-opus-5-5' };
      if (step === 'section') return { data: { section: { id: 'outro', purpose: 'end', shots: [{ asset: 'C2', start: 0, length: 30, transition: 'cut', effect: 'none', reason: '' }] }, notes: '' }, model: 'claude-opus-5-5' };
      throw new Error(step);
    },
  };
  const opts = baseOpts(api, { claude: true });
  const r = await runPipeline(opts);
  assert.equal(r.source, 'claude');
  assert.equal(r.timeline.title.text, 'Better title');
  assert.deepEqual(calls.map((c) => c.step), ['analyze', 'plan', 'review']);
  assert.equal(calls[0].payload.frames.length, 1);
  assert.equal(calls[1].payload.frames, undefined);

  // A revision reuses the cached analysis: no new analyze call, no frames re-sent.
  calls.length = 0;
  await runPipeline({ ...opts, revision: 'faster hook', currentTimeline: r.timeline });
  assert.deepEqual(calls.map((c) => c.step), ['plan', 'review']);
  assert.equal(calls[0].payload.revision, 'faster hook');
  assert.equal(calls[0].payload.currentPlan.sections.length, 3);

  calls.length = 0;
  const sec = await regenerateSection(opts, r.timeline, 'outro', 'end on the sunset');
  assert.deepEqual(calls.map((c) => c.step), ['section']);
  assert.equal(calls[0].payload.instruction, 'end on the sunset');
  assert.equal(sec.timeline.durationInFrames, r.timeline.durationInFrames);
});

test('transcription stage feeds captions; silent clips are skipped for free', async () => {
  const transcribed = [];
  const api = {
    transcribe: async ({ seconds }) => { transcribed.push(seconds); return { transcript: parseWhisperVerbose(WHISPER_FIXTURE) }; },
  };
  const opts = baseOpts(api, { transcription: 'openai-whisper' });
  opts.deps.extractAudio = async (id) => (id === 'C1'
    ? { samples: new Float32Array(16000 * 5).fill(0.1), sampleRate: 16000, level: 0.1 }
    : { samples: new Float32Array(16000), sampleRate: 16000, level: 0 });
  const r = await runPipeline(opts);
  assert.equal(transcribed.length, 1);
  assert.equal(r.context.transcripts.C2.silent, true);
  assert.ok(r.context.transcripts.C1.words.length);
});

// ---- Usage accounting and budgets -----------------------------------------------

test('cost accounting per model, cache and transcription', () => {
  assert.equal(claudeCost({ input_tokens: 1e6, output_tokens: 1e6 }, 'claude-opus-5-5').usd, 24);
  assert.equal(claudeCost({ cache_creation_input_tokens: 1e6, cache_read_input_tokens: 1e6 }, 'claude-opus-5-5').usd, 5.2);
  assert.equal(claudeCost({ input_tokens: 1e6 }, 'claude-sonnet-5-5').usd, 2);
  assert.equal(priceFor('claude-unknown-9').estimated, true);
  assert.equal(transcriptionCost(90, 'openai-whisper'), 0.009);
  assert.equal(transcriptionCost(600, 'whisper-cpp'), 0);
});

test('budgets: per-reel, monthly and transcription minutes are enforced; warnings fire', async () => {
  const store = new MemoryStore();
  const config = testConfig();
  await store.append({ id: '1', at: new Date().toISOString(), kind: 'claude', projectId: 'p1', step: 'plan', model: 'claude-opus-5-5', status: 'ok', inputTokens: 1, outputTokens: 1, costUsd: 1.8 });
  await assertWithinBudget(store, config, { projectId: 'p1', estimateUsd: 0.1 });
  await assert.rejects(assertWithinBudget(store, config, { projectId: 'p1', estimateUsd: 0.3 }), (e) => e.details.scope === 'project');
  await assertWithinBudget(store, config, { projectId: 'p2', estimateUsd: 0.3 });
  const report = await usageReport(store, config, 'p1');
  assert.ok(report.warnings.some((w) => w.includes('This reel')));
  await recordTranscriptionUsage(store, config, { projectId: 'p2', provider: 'openai-whisper', audioSeconds: 119 * 60 });
  await assert.rejects(assertWithinBudget(store, config, { projectId: 'p2', audioSeconds: 120 }), (e) => e.details.scope === 'audio');
  const s = summarize((await store.read()).events, { projectId: 'p2' });
  assert.equal(s.projectTotals.transcriptionUsd, 0.714);
});

test('user budgets are saved but capped by the server hard limit', async () => {
  const store = new MemoryStore();
  const config = testConfig();
  const b = await saveBudgets(store, config, { monthlyUsd: 5, projectUsd: '0.5', warnAt: 0.5 });
  assert.equal(b.monthlyUsd, 5);
  assert.equal(b.projectUsd, 0.5);
  await assert.rejects(saveBudgets(store, config, { monthlyUsd: 500 }), /hard cap/);
  await assert.rejects(saveBudgets(store, config, { projectUsd: -1 }), /non-negative/);
});

test('the file ledger survives concurrent writes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reel-usage-'));
  const store = new FileStore(path.join(dir, 'usage.json'));
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.append({ id: String(i), at: new Date().toISOString(), kind: 'claude', costUsd: 0.01 })));
  assert.equal((await new FileStore(path.join(dir, 'usage.json')).read()).events.length, 20);
  await fs.rm(dir, { recursive: true, force: true });
});
