'use client';
// Claude connection, model choice, transcription provider, budgets and the usage dashboard.
// Shows only non-secret server state; the API key never reaches the browser.

import { useEffect, useState } from 'react';

const usd = (n) => `$${(n || 0).toFixed(n && n < 0.1 ? 4 : 2)}`;
const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n || 0));

const STATE_LABEL = {
  not_configured: 'Not connected',
  untested: 'Configured, not tested',
  connected: 'Connected',
  error: 'Connection error',
  loading: 'Checking…',
};

export default function AiPanel({ api, settings, setSettings, status, setStatus, usage, refreshUsage, projectId }) {
  const [models, setModels] = useState([]);
  const [transcribers, setTranscribers] = useState(null);
  const [budgetDraft, setBudgetDraft] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.transcribers().then(setTranscribers).catch(() => setTranscribers({ default: 'none', providers: [] }));
  }, [api]);

  useEffect(() => {
    if (status?.state === 'connected' && status.models) setModels(status.models);
  }, [status]);

  async function test() {
    setStatus({ ...status, state: 'loading' });
    try {
      const s = await api.status(true);
      setStatus(s);
      setMsg(s.state === 'connected' ? `Connected in ${s.latencyMs} ms.` : s.error?.message || '');
      if (s.state === 'connected') refreshUsage();
    } catch (e) {
      setStatus({ ...status, state: 'error', error: { message: e.message } });
      setMsg(e.message);
    }
  }

  async function saveBudgets() {
    try {
      await api.saveBudgets({
        monthlyUsd: budgetDraft.monthlyUsd,
        projectUsd: budgetDraft.projectUsd,
        warnAt: budgetDraft.warnPct / 100,
        audioMinutesMonthly: budgetDraft.audioMinutesMonthly,
      });
      setBudgetDraft(null);
      setMsg('Budgets saved.');
      refreshUsage();
    } catch (e) {
      setMsg(e.message);
    }
  }

  const state = status?.state || 'loading';
  const dot = { connected: 'ok', untested: 'warn', loading: 'warn', error: 'bad', not_configured: 'off' }[state];
  const b = usage?.budgets;
  const month = usage?.monthTotals;
  const proj = usage?.projectTotals;
  const pct = b && b.monthlyUsd ? Math.min(100, (month.totalUsd / b.monthlyUsd) * 100) : 0;
  const currentModel = settings.model || status?.defaultModel;
  const modelOptions = models.length ? models : currentModel ? [{ id: currentModel, name: currentModel }] : [];

  return (
    <section className="card">
      <h2><span>✦</span> Claude <em className={`status ${dot}`}>● {STATE_LABEL[state]}</em></h2>

      {state === 'not_configured' && (
        <p className="hint">Add <code>ANTHROPIC_API_KEY</code> to the server environment (<code>.env.local</code> locally, project secrets when deployed) and restart. Until then the free planner makes every reel.</p>
      )}
      {status?.openApiBlocked && <p className="error">AI routes are off in production until <code>REEL_ACCESS_TOKEN</code> is set on the server.</p>}
      {status?.configured && (
        <p className="hint">Credential: {status.credential === 'workload_identity' ? 'workload identity (short-lived tokens)' : 'Claude API key'}, held on the server.</p>
      )}

      <div className="ai-row">
        <button className="secondary-btn" disabled={!status?.configured || state === 'loading'} onClick={test}>Test connection</button>
        <label className="switch">
          <input type="checkbox" checked={settings.useClaude && Boolean(status?.configured)} disabled={!status?.configured} onChange={(e) => setSettings({ ...settings, useClaude: e.target.checked })} />
          Use Claude to edit
        </label>
      </div>
      {msg && <p className="hint">{msg}</p>}

      {status?.accessTokenRequired && (
        <label className="field">App access token
          <input type="password" autoComplete="off" value={settings.accessToken} onChange={(e) => setSettings({ ...settings, accessToken: e.target.value })} placeholder="Set by whoever runs this server" />
        </label>
      )}

      {status?.configured && (
        <>
          <label className="field">Model
            <select value={currentModel || ''} onChange={(e) => setSettings({ ...settings, model: e.target.value })}>
              {modelOptions.map((m) => (
                <option key={m.id} value={m.id}>{m.name || m.id}{m.price && !m.price.estimated ? ` · $${m.price.input}/$${m.price.output} per M tokens` : ''}</option>
              ))}
            </select>
          </label>
          {!models.length && <p className="hint">Test the connection to load the models your key can use.</p>}
          <label className="switch">
            <input type="checkbox" checked={settings.review} onChange={(e) => setSettings({ ...settings, review: e.target.checked })} />
            Second pass: Claude reviews and improves its cut
          </label>
        </>
      )}

      <label className="field">Transcription (for captions and speech-aware cuts)
        <select value={settings.transcription ?? transcribers?.default ?? 'none'} onChange={(e) => setSettings({ ...settings, transcription: e.target.value })}>
          <option value="none">Off</option>
          {(transcribers?.providers || []).map((p) => (
            <option key={p.id} value={p.id} disabled={!p.available}>{p.label}{p.available ? (p.costPerMinute ? ` · $${p.costPerMinute}/min` : ' · free') : ' · not configured'}</option>
          ))}
        </select>
      </label>

      {usage && (
        <details className="usage">
          <summary>Usage and budget · this reel {usd(proj?.totalUsd)} · month {usd(month?.totalUsd)}{b?.monthlyUsd ? ` of ${usd(b.monthlyUsd)}` : ''}</summary>
          {b?.monthlyUsd > 0 && <progress className={pct >= (b.warnAt * 100) ? 'warn' : ''} value={pct} max={100} />}
          {usage.warnings?.map((w, i) => <p key={i} className="error">{w}</p>)}
          {!usage.durable && <p className="hint">Usage is kept in temporary storage on this host and may reset. Set REEL_USAGE_FILE to a persistent path for reliable budgets.</p>}
          <table className="usage-table">
            <thead><tr><th></th><th>This reel</th><th>This month</th></tr></thead>
            <tbody>
              <tr><td>Claude input tokens</td><td>{k(proj?.inputTokens)}</td><td>{k(month?.inputTokens)}</td></tr>
              <tr><td>Claude output tokens</td><td>{k(proj?.outputTokens)}</td><td>{k(month?.outputTokens)}</td></tr>
              <tr><td>Cache reads / writes</td><td>{k(proj?.cacheReadTokens)} / {k(proj?.cacheWriteTokens)}</td><td>{k(month?.cacheReadTokens)} / {k(month?.cacheWriteTokens)}</td></tr>
              <tr><td>Models</td><td>{Object.keys(proj?.models || {}).join(', ') || '—'}</td><td>{Object.keys(month?.models || {}).join(', ') || '—'}</td></tr>
              <tr><td>Claude cost</td><td>{usd(proj?.claudeUsd)}</td><td>{usd(month?.claudeUsd)}</td></tr>
              <tr><td>Transcribed audio</td><td>{((proj?.audioSeconds || 0) / 60).toFixed(1)} min</td><td>{((month?.audioSeconds || 0) / 60).toFixed(1)} min</td></tr>
              <tr><td>Transcription cost</td><td>{usd(proj?.transcriptionUsd)}</td><td>{usd(month?.transcriptionUsd)}</td></tr>
              <tr><td>Requests (failed)</td><td>{proj?.requests || 0} ({proj?.failed || 0})</td><td>{month?.requests || 0} ({month?.failed || 0})</td></tr>
              <tr className="total"><td>Total processing cost</td><td>{usd(proj?.totalUsd)}</td><td>{usd(month?.totalUsd)}</td></tr>
            </tbody>
          </table>
          {proj && Object.keys(proj.steps).length > 0 && (
            <p className="hint">By step: {Object.entries(proj.steps).map(([s, v]) => `${s} ${usd(v.usd)}`).join(' · ')}</p>
          )}
          <p className="hint">Costs are estimates from list prices{proj?.estimatedPrice || month?.estimatedPrice ? ' (one model had no known price and was counted at the highest rate)' : ''}. Your Claude Console invoice is authoritative. Project {projectId.slice(0, 8)}.</p>

          {budgetDraft ? (
            <div className="budget-form">
              <label className="field">Monthly budget (USD) <input type="number" min="0" step="1" value={budgetDraft.monthlyUsd} onChange={(e) => setBudgetDraft({ ...budgetDraft, monthlyUsd: e.target.value })} /></label>
              <label className="field">Per-reel budget (USD) <input type="number" min="0" step="0.5" value={budgetDraft.projectUsd} onChange={(e) => setBudgetDraft({ ...budgetDraft, projectUsd: e.target.value })} /></label>
              <label className="field">Warn at (% of budget) <input type="number" min="1" max="100" value={budgetDraft.warnPct} onChange={(e) => setBudgetDraft({ ...budgetDraft, warnPct: e.target.value })} /></label>
              <label className="field">Transcription minutes per month <input type="number" min="0" value={budgetDraft.audioMinutesMonthly} onChange={(e) => setBudgetDraft({ ...budgetDraft, audioMinutesMonthly: e.target.value })} /></label>
              <p className="hint">The server caps budgets at {usd(b.hardCapUsd)}.</p>
              <button className="secondary-btn" onClick={saveBudgets}>Save budgets</button>
              <button className="link" onClick={() => setBudgetDraft(null)}>Cancel</button>
            </div>
          ) : (
            <button className="secondary-btn" onClick={() => setBudgetDraft({ monthlyUsd: b.monthlyUsd, projectUsd: b.projectUsd, warnPct: Math.round(b.warnAt * 100), audioMinutesMonthly: b.audioMinutesMonthly })}>Edit budgets</button>
          )}
        </details>
      )}
    </section>
  );
}
