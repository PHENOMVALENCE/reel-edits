'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Player } from '@remotion/player';
import { Reel, REEL_ID } from '../reel/Reel.js';
import { FPS, WIDTH, HEIGHT, MIN_SECONDS, MAX_SECONDS, TRANSITIONS, EFFECTS, CAPTION_STYLES } from '../lib/catalog.js';
import { PRESETS, PRESET_IDS } from '../lib/presets.js';
import { normalizeShots, reconcile, buildTimeline } from '../lib/planner.js';
import { buildPrompt, parsePlan } from '../lib/aiPlan.js';
import { analyzeMusicFile } from '../lib/beats.js';
import { probeFile, contactSheet, sampleFrames } from '../lib/media.js';
import { extractSpeechAudio } from '../lib/audioExtract.js';
import { createApi } from '../lib/apiClient.js';
import { STAGES, newProjectContext, runPipeline, finishTimeline, regenerateSection } from '../lib/pipeline.js';
import { sectionsOf } from '../lib/editorial.js';
import { checkRenderedDuration } from '../lib/qc.js';
import AiPanel from './AiPanel.jsx';

const secs = (frames) => (frames / FPS).toFixed(1);
const SETTINGS_KEY = 'reel-edits:ai-settings';
const DEFAULT_SETTINGS = { useClaude: true, model: '', review: true, transcription: null, accessToken: '' };

function videoDuration(url) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => resolve(v.duration);
    v.onerror = () => resolve(NaN);
    v.src = url;
  });
}

export default function ReelMaker() {
  const [assets, setAssets] = useState([]);
  const [busy, setBusy] = useState('');
  const [notes, setNotes] = useState([]);
  const [music, setMusic] = useState(null);
  const [presetId, setPresetId] = useState('hype');
  const [target, setTarget] = useState(60);
  const [title, setTitle] = useState('');
  const [endText, setEndText] = useState('');
  const [brief, setBrief] = useState('');
  const [timeline, setTimeline] = useState(null);
  const [reply, setReply] = useState('');
  const [render, setRender] = useState({ status: 'idle' });
  const counters = useRef({ C: 0, P: 0 });
  const abort = useRef(null);
  const fileStore = useRef(new Map());
  const [projectId] = useState(() => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())));
  const context = useRef(null);
  if (!context.current) context.current = newProjectContext(projectId);
  const [settings, setSettingsState] = useState(DEFAULT_SETTINGS);
  const settingsRef = useRef(settings);
  const [status, setStatus] = useState(null);
  const [usage, setUsage] = useState(null);
  const [stages, setStages] = useState({});
  const [revision, setRevision] = useState('');
  const [sectionAsk, setSectionAsk] = useState({});

  const api = useMemo(() => createApi({ getAccessToken: () => settingsRef.current.accessToken }), []);
  const setSettings = (next) => {
    settingsRef.current = next;
    setSettingsState(next);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };
  const refreshUsage = useCallback(() => api.usage(projectId).then(setUsage).catch(() => {}), [api, projectId]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      if (saved) {
        settingsRef.current = { ...DEFAULT_SETTINGS, ...saved };
        setSettingsState(settingsRef.current);
      }
    } catch { /* ignore */ }
    api.status(false)
      .then((st) => { setStatus(st); if (st.configured) refreshUsage(); })
      .catch(() => setStatus({ state: 'not_configured', configured: false }));
  }, [api, refreshUsage]);

  const claudeOn = Boolean(status?.configured && settings.useClaude && !status?.openApiBlocked);
  const transcriptionOn = settings.transcription && settings.transcription !== 'none' ? settings.transcription : null;
  const markStage = (id, st, note) => setStages((prev) => ({ ...prev, [id]: { status: st, note } }));
  const pipelineOpts = (extra = {}) => ({
    assets, music, brief, presetId, targetSeconds: target, title, endText,
    model: settings.model || undefined, projectId, context: context.current, api, review: settings.review,
    ai: { claude: claudeOn, transcription: transcriptionOn },
    deps: { sampleFrames, extractAudio: (id) => extractSpeechAudio(fileStore.current.get(id)) },
    onStage: markStage,
    ...extra,
  });

  const assetMap = useMemo(() => Object.fromEntries(assets.map((a) => [a.id, a])), [assets]);
  const inputProps = useMemo(() => ({ timeline, assets: assetMap, music: music ? { url: music.url } : null }), [timeline, assetMap, music]);

  async function addFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    setBusy(`Reading ${files.length} file${files.length > 1 ? 's' : ''}…`);
    const added = [];
    const problems = [];
    for (const file of files) {
      const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(file.name);
      const prefix = isVideo ? 'C' : 'P';
      const id = `${prefix}${++counters.current[prefix]}`;
      try {
        added.push(await probeFile(file, id));
        fileStore.current.set(id, file);
      } catch (e) {
        problems.push(`${file.name}: ${e.message}`);
      }
    }
    setAssets((prev) => [...prev, ...added]);
    setNotes(problems);
    setBusy('');
  }

  function moveAsset(i, dir) {
    setAssets((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function removeAsset(i) {
    setAssets((prev) => {
      URL.revokeObjectURL(prev[i].url);
      fileStore.current.delete(prev[i].id);
      delete context.current.transcripts[prev[i].id];
      return prev.filter((_, k) => k !== i);
    });
    setTimeline(null);
  }

  async function addMusic(file) {
    if (!file) return;
    setBusy('Finding the beat…');
    try {
      const analysis = await analyzeMusicFile(file);
      if (music) URL.revokeObjectURL(music.url);
      setMusic({ name: file.name, url: URL.createObjectURL(file), ...analysis });
    } catch {
      setNotes(["Couldn't read that music file. Try an MP3 or M4A."]);
    }
    setBusy('');
  }

  async function makeReel(extra = {}) {
    setStages({});
    setBusy(claudeOn ? 'Editing with Claude…' : 'Making your reel…');
    setRender({ status: 'idle' });
    try {
      const result = await runPipeline(pipelineOpts(extra));
      setTimeline(result.timeline);
      setNotes(result.notes);
      if (extra.revision) setRevision('');
    } catch (e) {
      setNotes([e.message]);
    }
    setBusy('');
    if (status?.configured) refreshUsage();
  }

  // Rebuild after a manual edit, keeping caption and mix choices, then redo captions, mix and QC.
  function rebuild(shots, overrides = {}) {
    const next = buildTimeline({
      shots, presetId: timeline.presetId, title: timeline.title?.text, endText: timeline.endCard?.text,
      captionStyle: overrides.captionStyle ?? timeline.captionStyle, audio: overrides.audio ?? timeline.audio,
    });
    const done = finishTimeline(next, { assets, music, transcripts: context.current.transcripts, targetSeconds: target, onStage: markStage });
    setTimeline(done.timeline);
    return done;
  }

  function editShots(mutator) {
    const shots = timeline.shots.map((s) => ({ ...s }));
    mutator(shots);
    const { shots: clean, warnings } = normalizeShots(shots, assets);
    rebuild(clean);
    if (warnings.length) setNotes(warnings);
  }

  function fitLength() {
    const shots = timeline.shots.map((s) => ({ ...s }));
    const short = reconcile(shots, assets, target * FPS);
    rebuild(shots);
    setNotes(short > 0 ? [`Not enough footage to reach ${target} s.`] : [`Fitted to ${target} s.`]);
  }

  async function redoSection(sectionId) {
    setBusy(`Claude is re-cutting the ${sectionId}…`);
    try {
      const result = await regenerateSection(pipelineOpts(), timeline, sectionId, sectionAsk[sectionId] || '');
      setTimeline(result.timeline);
      setNotes([`Re-cut the ${sectionId}.`, ...result.notes]);
      setSectionAsk((p) => ({ ...p, [sectionId]: '' }));
    } catch (e) {
      setNotes([`Couldn't re-cut the ${sectionId}: ${e.message}`]);
    }
    setBusy('');
    refreshUsage();
  }

  async function shareForClaude() {
    setBusy('Building the contact sheet…');
    try {
      const prompt = buildPrompt({ assets, targetSeconds: target, presetId, brief });
      const blob = await contactSheet(assets);
      const file = new File([blob], 'reel-contact-sheet.jpg', { type: 'image/jpeg' });
      try { await navigator.clipboard.writeText(prompt); } catch { /* clipboard may be blocked */ }
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: prompt, title: 'Plan my reel' });
        setNotes(['Shared. The prompt is also copied: paste it in Claude with the image if it did not come through.']);
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'reel-contact-sheet.jpg';
        a.click();
        setNotes(['Contact sheet downloaded and prompt copied. Attach the image in Claude and paste the prompt.']);
      }
    } catch (e) {
      if (e.name !== 'AbortError') setNotes([`Couldn't share: ${e.message}`]);
    }
    setBusy('');
  }

  function applyReply() {
    try {
      const { timeline: t, warnings } = parsePlan(reply, { assets, targetSeconds: target, presetId });
      setTimeline(finishTimeline(t, { assets, music, transcripts: context.current.transcripts, targetSeconds: target, onStage: markStage }).timeline);
      setRender({ status: 'idle' });
      setNotes(['Applied Claude’s plan.', ...warnings]);
    } catch (e) {
      setNotes([e.message]);
    }
  }

  async function exportReel() {
    const { renderMediaOnWeb, canRenderMediaOnWeb } = await import('@remotion/web-renderer');
    const check = await canRenderMediaOnWeb({ width: WIDTH, height: HEIGHT, container: 'mp4' });
    if (!check.canRender) {
      setRender({ status: 'error', error: `This browser can't export video: ${check.issues.map((i) => i.message).join(' ')} Use Chrome on Android or Safari on iOS 26+.` });
      return;
    }
    abort.current = new AbortController();
    let wake = null;
    try { wake = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
    setRender({ status: 'rendering', progress: 0 });
    markStage('render', 'running');
    try {
      const { getBlob } = await renderMediaOnWeb({
        composition: { id: REEL_ID, component: Reel, durationInFrames: timeline.durationInFrames, fps: FPS, width: WIDTH, height: HEIGHT },
        inputProps,
        container: 'mp4',
        videoBitrate: 'high',
        licenseKey: 'free-license',
        signal: abort.current.signal,
        onProgress: ({ progress, renderEstimatedTime }) => setRender({ status: 'rendering', progress, eta: renderEstimatedTime }),
      });
      const blob = await getBlob();
      const url = URL.createObjectURL(blob);
      setRender({ status: 'done', blob, url });
      markStage('render', 'done', `${(blob.size / 1e6).toFixed(1)} MB MP4`);
      // Post-render QC: the file must be exactly as long as the timeline.
      const check = checkRenderedDuration(await videoDuration(url), timeline.durationInFrames);
      markStage('qc', check.ok ? 'done' : 'error', check.ok
        ? `MP4 is ${check.actual.toFixed(2)} s as planned`
        : `MP4 length ${Number.isFinite(check.actual) ? check.actual.toFixed(2) : 'unknown'} s, expected ${check.expected.toFixed(2)} s`);
    } catch (e) {
      const aborted = abort.current.signal.aborted;
      setRender(aborted ? { status: 'idle' } : { status: 'error', error: e.message });
      markStage('render', aborted ? 'pending' : 'error', aborted ? 'cancelled' : e.message);
    } finally {
      wake?.release?.();
    }
  }

  async function shareVideo() {
    const file = new File([render.blob], 'reel.mp4', { type: 'video/mp4' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); } catch { /* cancelled */ }
    } else {
      const a = document.createElement('a');
      a.href = render.url;
      a.download = 'reel.mp4';
      a.click();
    }
  }

  const footage = assets.reduce((n, a) => n + (a.kind === 'video' ? a.durationFrames / FPS : 3), 0);

  return (
    <main className="app">
      <header className="top">
        <h1>Reel Edits</h1>
        <p>Clips and photos in, a polished 1–2 minute reel out. Claude plans the edit; the video renders on your phone.</p>
      </header>

      <section className="card">
        <h2><span>1</span> Footage</h2>
        <label className="pick">
          <input type="file" accept="video/*,image/*" multiple onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          + Add clips and photos
        </label>
        {assets.length > 0 && (
          <>
            <p className="hint">The first item is your hook. Reorder to tell the story. About {Math.round(footage)} s of material.</p>
            <ul className="assets">
              {assets.map((a, i) => (
                <li key={a.id}>
                  <img src={a.thumb} alt="" />
                  <div className="meta">
                    <b>{a.id}</b>
                    <small>{a.kind === 'video' ? `${secs(a.durationFrames)} s` : 'photo'} · {a.orientation}</small>
                  </div>
                  <div className="row-actions">
                    <button aria-label="Move up" onClick={() => moveAsset(i, -1)} disabled={i === 0}>↑</button>
                    <button aria-label="Move down" onClick={() => moveAsset(i, 1)} disabled={i === assets.length - 1}>↓</button>
                    <button aria-label="Remove" onClick={() => removeAsset(i)}>✕</button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card">
        <h2><span>2</span> Music <em>optional</em></h2>
        <label className="pick secondary">
          <input type="file" accept="audio/*" onChange={(e) => { addMusic(e.target.files[0]); e.target.value = ''; }} />
          {music ? `♪ ${music.name}` : '+ Add a music track'}
        </label>
        {music && <p className="hint">{music.bpm ? `${music.bpm} BPM · cuts will land on the beat.` : 'No clear beat found.'} <button className="link" onClick={() => setMusic(null)}>Remove</button></p>}
        <p className="hint">Tip: skip this and add a trending sound in Instagram or TikTok when you post. That avoids music licensing.</p>
      </section>

      <AiPanel api={api} settings={settings} setSettings={setSettings} status={status} setStatus={setStatus} usage={usage} refreshUsage={refreshUsage} projectId={projectId} />

      <section className="card">
        <h2><span>3</span> Style</h2>
        <div className="chips">
          {PRESET_IDS.map((id) => (
            <button key={id} className={id === presetId ? 'chip on' : 'chip'} onClick={() => setPresetId(id)}>
              <b>{PRESETS[id].label}</b>
              <small>{PRESETS[id].description}</small>
            </button>
          ))}
        </div>
        <label className="field">
          Length: <b>{target} s</b>
          <input type="range" min={MIN_SECONDS} max={MAX_SECONDS} step={5} value={target} onChange={(e) => setTarget(Number(e.target.value))} />
        </label>
        <label className="field">Hook text <input value={title} maxLength={60} placeholder="e.g. 48 hours in Zanzibar" onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="field">Ending text <input value={endText} maxLength={60} placeholder="e.g. Follow for part 2" onChange={(e) => setEndText(e.target.value)} /></label>
        <label className="field">What is the reel about? <textarea rows={2} value={brief} maxLength={1000} placeholder="e.g. Launch event for our new product. Hook on the reveal, end on the crowd." onChange={(e) => setBrief(e.target.value)} /></label>
        <button className="primary" disabled={!assets.length || !!busy} onClick={() => makeReel()}>{claudeOn ? 'Make my reel with Claude' : 'Make my reel'}</button>
        {Object.keys(stages).length > 0 && (
          <ol className="stages">
            {STAGES.map((st) => {
              const cur = stages[st.id];
              return <li key={st.id} className={cur?.status || 'waiting'}><b>{st.label}</b>{cur?.note ? <small>{cur.note}</small> : null}</li>;
            })}
          </ol>
        )}
      </section>

      <details className="card manual">
        <summary>Plan in the Claude app instead (copy and paste, no API key)</summary>
        <ol className="steps">
          <li><button className="secondary-btn" disabled={!assets.length || !!busy} onClick={shareForClaude}>Share footage sheet + prompt to Claude</button></li>
          <li>Paste Claude&apos;s reply here:
            <textarea rows={4} value={reply} onChange={(e) => setReply(e.target.value)} placeholder='{"title": "...", "shots": [...]}' />
          </li>
          <li><button className="secondary-btn" disabled={!reply.trim() || !assets.length} onClick={applyReply}>Apply Claude&apos;s plan</button></li>
        </ol>
      </details>

      {busy && <p className="busy">{busy}</p>}
      {notes.length > 0 && <ul className="notes">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}

      {timeline && (
        <section className="card">
          <h2><span>4</span> Preview <em>{secs(timeline.durationInFrames)} s · {timeline.shots.length} shots</em></h2>
          <div className="player">
            <Player
              component={Reel}
              inputProps={inputProps}
              durationInFrames={timeline.durationInFrames}
              fps={FPS}
              compositionWidth={WIDTH}
              compositionHeight={HEIGHT}
              style={{ width: '100%', aspectRatio: '9 / 16' }}
              controls
              acknowledgeRemotionLicense
            />
          </div>

          {claudeOn && (
            <div className="revise">
              <label className="field">Ask Claude for changes
                <input value={revision} maxLength={500} placeholder="e.g. Faster hook, end on the sunset, fewer flashes" onChange={(e) => setRevision(e.target.value)} />
              </label>
              <button className="secondary-btn" disabled={!revision.trim() || !!busy} onClick={() => makeReel({ revision, currentTimeline: timeline })}>Revise the edit</button>
            </div>
          )}

          <label className="field">Captions
            <select value={timeline.captionStyle?.style || 'none'} onChange={(e) => rebuild(timeline.shots, { captionStyle: { ...timeline.captionStyle, style: e.target.value } })}>
              {Object.entries(CAPTION_STYLES).map(([id, c]) => <option key={id} value={id}>{c.label}</option>)}
            </select>
          </label>
          {timeline.captionStyle?.style !== 'none' && !timeline.captions?.length && <p className="hint">Captions appear when transcription is on and clips contain speech.</p>}

          {claudeOn && sectionsOf(timeline).length > 1 && (
            <details className="sections">
              <summary>Re-cut one section with Claude</summary>
              {sectionsOf(timeline).map((sec) => (
                <div key={sec.id} className="section-row">
                  <b>{sec.id}</b> <small>{secs(sec.frames)} s · {sec.indices.length} shots</small>
                  <input value={sectionAsk[sec.id] || ''} maxLength={300} placeholder="What should change?" onChange={(e) => setSectionAsk((p) => ({ ...p, [sec.id]: e.target.value }))} />
                  <button className="secondary-btn" disabled={!!busy} onClick={() => redoSection(sec.id)}>Re-cut</button>
                </div>
              ))}
            </details>
          )}

          <details className="shots">
            <summary>Edit shots</summary>
            {Math.abs(timeline.durationInFrames - target * FPS) > 2 && (
              <button className="secondary-btn" onClick={fitLength}>Fit back to {target} s</button>
            )}
            <ol>
              {timeline.shots.map((s, i) => (
                <li key={i}>
                  <img src={assetMap[s.assetId]?.thumb} alt="" />
                  <div className="shot-body">
                    <div className="shot-head">
                      <b>{s.assetId}{s.section ? <small> · {s.section}</small> : null}</b>
                      <span>
                        <button onClick={() => editShots((x) => { x[i].frames -= 8; })}>−</button>
                        {secs(s.frames)} s
                        <button onClick={() => editShots((x) => { x[i].frames += 8; })}>+</button>
                      </span>
                    </div>
                    <select value={s.effect} onChange={(e) => editShots((x) => { x[i].effect = e.target.value; })}>
                      {Object.entries(EFFECTS).map(([id, e]) => <option key={id} value={id}>{e.label}</option>)}
                    </select>
                    {i < timeline.shots.length - 1 && (
                      <select value={s.transition} onChange={(e) => editShots((x) => { x[i].transition = e.target.value; })}>
                        {Object.entries(TRANSITIONS).map(([id, t]) => <option key={id} value={id}>→ {t.label}</option>)}
                      </select>
                    )}
                    <div className="row-actions">
                      <button onClick={() => editShots((x) => { if (i > 0) [x[i - 1], x[i]] = [x[i], x[i - 1]]; })} disabled={i === 0}>↑</button>
                      <button onClick={() => editShots((x) => { if (i < x.length - 1) [x[i + 1], x[i]] = [x[i], x[i + 1]]; })} disabled={i === timeline.shots.length - 1}>↓</button>
                      <button onClick={() => editShots((x) => { x.splice(i, 1); })} disabled={timeline.shots.length < 2}>✕</button>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </details>
        </section>
      )}

      {timeline && (
        <section className="card">
          <h2><span>5</span> Export</h2>
          {render.status === 'idle' && <button className="primary" onClick={exportReel}>Export MP4 (1080×1920)</button>}
          {render.status === 'rendering' && (
            <>
              <progress value={render.progress} max={1} />
              <p className="hint">{Math.round(render.progress * 100)}%{render.eta ? ` · about ${Math.ceil(render.eta / 1000)} s left` : ''}. Keep this screen open.</p>
              <button className="secondary-btn" onClick={() => abort.current?.abort()}>Cancel</button>
            </>
          )}
          {render.status === 'done' && (
            <>
              <video className="result" src={render.url} controls playsInline />
              <button className="primary" onClick={shareVideo}>Save or share</button>
              <button className="secondary-btn" onClick={() => setRender({ status: 'idle' })}>Export again</button>
            </>
          )}
          {render.status === 'error' && (
            <>
              <p className="error">{render.error}</p>
              <button className="secondary-btn" onClick={() => setRender({ status: 'idle' })}>Try again</button>
            </>
          )}
        </section>
      )}
    </main>
  );
}
