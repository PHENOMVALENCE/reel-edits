import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planReel, totalFrames, shotStarts } from '../lib/planner.js';
import { detectBeats } from '../lib/beats.js';
import { parsePlan, buildPrompt } from '../lib/aiPlan.js';
import { FPS } from '../lib/catalog.js';

const clip = (id, seconds) => ({ id, kind: 'video', durationFrames: seconds * FPS, orientation: 'portrait' });
const photo = (id) => ({ id, kind: 'photo', orientation: 'landscape' });

for (const presetId of ['hype', 'cinematic', 'vlog']) {
  for (const seconds of [60, 90, 120]) {
    test(`${presetId} hits ${seconds}s exactly with enough footage`, () => {
      const assets = [clip('C1', 40), photo('P1'), clip('C2', 55), photo('P2'), clip('C3', 70), photo('P3')];
      const { timeline, warnings } = planReel({ assets, targetSeconds: seconds, presetId });
      assert.equal(warnings.length, 0, warnings.join(' '));
      assert.equal(timeline.durationInFrames, seconds * FPS);
      assert.equal(totalFrames(timeline.shots), seconds * FPS);
      for (const s of timeline.shots) {
        const a = assets.find((x) => x.id === s.assetId);
        assert.ok(s.frames >= 15, 'shot too short');
        if (a.kind === 'video') assert.ok(s.from >= 0 && s.from + s.frames <= a.durationFrames, 'trim out of clip');
      }
      assert.equal(timeline.shots.at(-1).transition, 'cut');
    });
  }
}

test('warns when footage is too short', () => {
  const { timeline, warnings } = planReel({ assets: [clip('C1', 10), photo('P1')], targetSeconds: 60, presetId: 'hype' });
  assert.ok(warnings.length === 1);
  assert.ok(timeline.durationInFrames < 60 * FPS);
});

test('consecutive shots alternate sources when possible', () => {
  const { timeline } = planReel({ assets: [clip('C1', 60), clip('C2', 60)], targetSeconds: 60, presetId: 'hype' });
  let repeats = 0;
  timeline.shots.forEach((s, i) => i && s.assetId === timeline.shots[i - 1].assetId && repeats++);
  assert.equal(repeats, 0);
});

function clickTrack(bpm, seconds, sr = 22050) {
  const samples = new Float32Array(seconds * sr);
  const step = (60 / bpm) * sr;
  for (let t = 0.3 * sr; t < samples.length; t += step) {
    for (let i = 0; i < 400; i++) samples[Math.floor(t) + i] = Math.sin(i / 3) * Math.exp(-i / 80);
  }
  for (let i = 0; i < samples.length; i++) samples[i] += (Math.random() - 0.5) * 0.01;
  return samples;
}

for (const bpm of [90, 120, 128]) {
  test(`beat tracker finds ${bpm} BPM`, () => {
    const { bpm: found, beats } = detectBeats(clickTrack(bpm, 30), 22050);
    assert.ok(Math.abs(found - bpm) <= 3, `found ${found}`);
    assert.ok(Math.abs(beats[0] % (60 / bpm) - 0.3) < 0.05 || beats[0] < 0.4, `first beat ${beats[0]}`);
  });
}

test('cuts snap to beats without changing length', () => {
  const assets = [clip('C1', 60), clip('C2', 60), photo('P1')];
  const beats = Array.from({ length: 200 }, (_, i) => 0.25 + i * 0.5);
  const { timeline, stats } = planReel({ assets, targetSeconds: 60, presetId: 'hype', beats });
  assert.equal(timeline.durationInFrames, 60 * FPS);
  assert.ok(stats.beatSnaps > 0);
  const beatFrames = new Set(beats.map((b) => Math.round(b * FPS)));
  const starts = shotStarts(timeline.shots);
  const onBeat = timeline.shots.slice(0, -1).filter((s, i) => s.transition === 'cut' && beatFrames.has(starts[i + 1])).length;
  assert.ok(onBeat >= stats.beatSnaps * 0.8);
});

test('parses and repairs an AI reply', () => {
  const assets = [clip('C1', 30), photo('P1'), clip('C2', 40)];
  const prompt = buildPrompt({ assets, targetSeconds: 60, presetId: 'cinematic', brief: 'Beach day' });
  assert.match(prompt, /C1: video clip, 30.0 s/);
  const reply = 'Here you go:\n```json\n{"title":"Beach day","end":"","shots":[' +
    '{"asset":"c1","start":2,"length":3,"transition":"fade","effect":"slow_push"},' +
    '{"asset":"P1","start":0,"length":3,"transition":"sparkle","effect":"ken_burns"},' +
    '{"asset":"C2","start":38,"length":5,"transition":"cut","effect":"none"},' +
    '{"asset":"C9","start":0,"length":2}]}\n```';
  const { timeline, warnings } = parsePlan(reply, { assets, targetSeconds: 60, presetId: 'cinematic' });
  assert.equal(timeline.title.text, 'Beach day');
  assert.equal(timeline.shots.length, 3);
  assert.equal(timeline.shots[1].transition, 'cut');
  assert.ok(warnings.some((w) => w.includes('C9')));
  assert.ok(warnings.some((w) => w.includes('sparkle')));
  const c2 = timeline.shots[2];
  assert.ok(c2.from + c2.frames <= 40 * FPS);
});

test('shots from one clip never reuse the same footage', () => {
  const assets = [clip('C1', 70), photo('P1'), clip('C2', 50)];
  for (const presetId of ['hype', 'cinematic', 'vlog']) {
    const { timeline } = planReel({ assets, targetSeconds: 90, presetId, beats: Array.from({ length: 300 }, (_, i) => i * 0.47) });
    for (const id of ['C1', 'C2']) {
      const own = timeline.shots.filter((s) => s.assetId === id).sort((a, b) => a.from - b.from);
      own.forEach((s, i) => i && assert.ok(own[i - 1].from + own[i - 1].frames <= s.from, `${presetId} ${id} overlap`));
    }
  }
});
