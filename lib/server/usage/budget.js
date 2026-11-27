// Usage accounting and budget enforcement.
// Every Claude and transcription call is checked before it is sent and recorded after it returns.

import { randomUUID } from 'node:crypto';
import { claudeCost, transcriptionCost, priceFor } from '../../ai/pricing.js';

export class BudgetError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'BudgetError';
    this.code = 'budget_exceeded';
    this.status = 402;
    this.details = details;
  }
}

const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

// Effective budgets: user settings, clamped to the server's hard cap.
export async function effectiveBudgets(store, config) {
  const saved = await store.getBudgets();
  const base = config.budgets;
  const clamp = (v, d) => (Number.isFinite(v) && v >= 0 ? Math.min(v, base.hardCapUsd) : d);
  return {
    monthlyUsd: clamp(saved.monthlyUsd, base.monthlyUsd),
    projectUsd: clamp(saved.projectUsd, base.projectUsd),
    warnAt: Number.isFinite(saved.warnAt) && saved.warnAt > 0 && saved.warnAt <= 1 ? saved.warnAt : base.warnAt,
    audioMinutesMonthly: Number.isFinite(saved.audioMinutesMonthly) && saved.audioMinutesMonthly >= 0
      ? Math.min(saved.audioMinutesMonthly, base.audioMinutesMonthly * 10)
      : base.audioMinutesMonthly,
    hardCapUsd: base.hardCapUsd,
  };
}

export async function saveBudgets(store, config, input) {
  const pick = (k) => (input[k] === undefined || input[k] === null || input[k] === '' ? undefined : Number(input[k]));
  const next = {
    monthlyUsd: pick('monthlyUsd'),
    projectUsd: pick('projectUsd'),
    warnAt: pick('warnAt'),
    audioMinutesMonthly: pick('audioMinutesMonthly'),
  };
  for (const [k, v] of Object.entries(next)) {
    if (v !== undefined && (!Number.isFinite(v) || v < 0)) throw Object.assign(new Error(`${k} must be a non-negative number.`), { status: 400, code: 'bad_request' });
  }
  if (next.monthlyUsd > config.budgets.hardCapUsd || next.projectUsd > config.budgets.hardCapUsd) {
    throw Object.assign(new Error(`Budgets can't exceed the server's hard cap of $${config.budgets.hardCapUsd}.`), { status: 400, code: 'bad_request' });
  }
  await store.setBudgets(Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)));
  return effectiveBudgets(store, config);
}

export function summarize(events, { projectId, month = monthKey() } = {}) {
  const empty = () => ({
    requests: 0, failed: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    claudeUsd: 0, audioSeconds: 0, transcriptionUsd: 0, totalUsd: 0, models: {}, steps: {}, estimatedPrice: false,
  });
  const add = (acc, e) => {
    acc.requests++;
    if (e.status === 'error') acc.failed++;
    if (e.kind === 'claude') {
      acc.inputTokens += e.inputTokens || 0;
      acc.outputTokens += e.outputTokens || 0;
      acc.cacheReadTokens += e.cacheReadTokens || 0;
      acc.cacheWriteTokens += e.cacheWriteTokens || 0;
      acc.claudeUsd += e.costUsd || 0;
      if (e.model) acc.models[e.model] = (acc.models[e.model] || 0) + 1;
      if (e.estimatedPrice) acc.estimatedPrice = true;
    } else if (e.kind === 'transcription') {
      acc.audioSeconds += e.audioSeconds || 0;
      acc.transcriptionUsd += e.costUsd || 0;
    }
    if (e.step) {
      const s = (acc.steps[e.step] ||= { requests: 0, usd: 0 });
      s.requests++;
      s.usd += e.costUsd || 0;
    }
    acc.totalUsd += e.costUsd || 0;
  };
  const monthTotals = empty();
  const projectTotals = empty();
  for (const e of events) {
    if (e.at.slice(0, 7) === month) add(monthTotals, e);
    if (projectId && e.projectId === projectId) add(projectTotals, e);
  }
  for (const t of [monthTotals, projectTotals]) {
    for (const k of ['claudeUsd', 'transcriptionUsd', 'totalUsd']) t[k] = Math.round(t[k] * 1e6) / 1e6;
    for (const s of Object.values(t.steps)) s.usd = Math.round(s.usd * 1e6) / 1e6;
  }
  return { month, monthTotals, projectTotals };
}

function warningsFor(totals, budgets) {
  const out = [];
  const { monthTotals, projectTotals } = totals;
  if (budgets.monthlyUsd > 0 && monthTotals.totalUsd >= budgets.monthlyUsd * budgets.warnAt) {
    out.push(`This month's AI spend is $${monthTotals.totalUsd.toFixed(2)} of your $${budgets.monthlyUsd.toFixed(2)} budget.`);
  }
  if (budgets.projectUsd > 0 && projectTotals.totalUsd >= budgets.projectUsd * budgets.warnAt) {
    out.push(`This reel has used $${projectTotals.totalUsd.toFixed(2)} of its $${budgets.projectUsd.toFixed(2)} budget.`);
  }
  if (budgets.audioMinutesMonthly > 0 && monthTotals.audioSeconds / 60 >= budgets.audioMinutesMonthly * budgets.warnAt) {
    out.push(`Transcription: ${(monthTotals.audioSeconds / 60).toFixed(1)} of ${budgets.audioMinutesMonthly} minutes used this month.`);
  }
  return out;
}

export async function usageReport(store, config, projectId) {
  const data = await store.read();
  const budgets = await effectiveBudgets(store, config);
  const totals = summarize(data.events, { projectId });
  return { ...totals, budgets, warnings: warningsFor(totals, budgets), durable: config.usageDurable };
}

// Rough pre-flight estimate. Text at ~3.5 chars/token, each small frame ~250 tokens,
// plus the output the step usually produces (not the max_tokens ceiling).
export function estimateClaudeCost({ model, textChars = 0, images = 0, expectedOutputTokens = 4000 }, overrides) {
  const p = priceFor(model, overrides);
  const inputTokens = Math.ceil(textChars / 3.5) + images * 250;
  return Math.round(((inputTokens * p.input + expectedOutputTokens * p.output) / 1e6) * 1e6) / 1e6;
}

export async function assertWithinBudget(store, config, { projectId, estimateUsd = 0, audioSeconds = 0 }) {
  const budgets = await effectiveBudgets(store, config);
  const data = await store.read();
  const { monthTotals, projectTotals } = summarize(data.events, { projectId });
  if (budgets.monthlyUsd >= 0 && monthTotals.totalUsd + estimateUsd > budgets.monthlyUsd) {
    throw new BudgetError(
      `Monthly AI budget reached ($${monthTotals.totalUsd.toFixed(2)} spent of $${budgets.monthlyUsd.toFixed(2)}; this step needs about $${estimateUsd.toFixed(2)}). Raise the budget or use the free planner.`,
      { scope: 'monthly', spent: monthTotals.totalUsd, budget: budgets.monthlyUsd, estimateUsd },
    );
  }
  if (projectId && budgets.projectUsd >= 0 && projectTotals.totalUsd + estimateUsd > budgets.projectUsd) {
    throw new BudgetError(
      `This reel's AI budget is used up ($${projectTotals.totalUsd.toFixed(2)} of $${budgets.projectUsd.toFixed(2)}). Raise the per-reel budget or use the free planner.`,
      { scope: 'project', spent: projectTotals.totalUsd, budget: budgets.projectUsd, estimateUsd },
    );
  }
  if (audioSeconds && budgets.audioMinutesMonthly >= 0 && (monthTotals.audioSeconds + audioSeconds) / 60 > budgets.audioMinutesMonthly) {
    throw new BudgetError(
      `Monthly transcription limit reached (${(monthTotals.audioSeconds / 60).toFixed(1)} of ${budgets.audioMinutesMonthly} minutes).`,
      { scope: 'audio', spentMinutes: monthTotals.audioSeconds / 60, limitMinutes: budgets.audioMinutesMonthly },
    );
  }
  return budgets;
}

export async function recordClaudeUsage(store, config, { projectId, step, model, usage, status = 'ok', error }) {
  const u = usage || {};
  const { usd, estimatedPrice } = status === 'ok' ? claudeCost(u, model, config.pricingOverrides) : { usd: 0, estimatedPrice: false };
  return store.append({
    id: randomUUID(), at: new Date().toISOString(), kind: 'claude', projectId: projectId || null, step, model, status,
    inputTokens: u.input_tokens || 0, outputTokens: u.output_tokens || 0,
    cacheReadTokens: u.cache_read_input_tokens || 0, cacheWriteTokens: u.cache_creation_input_tokens || 0,
    costUsd: usd, estimatedPrice, ...(error ? { error: String(error).slice(0, 200) } : {}),
  });
}

export async function recordTranscriptionUsage(store, config, { projectId, provider, model, audioSeconds, status = 'ok', error }) {
  return store.append({
    id: randomUUID(), at: new Date().toISOString(), kind: 'transcription', projectId: projectId || null, step: 'transcription',
    provider, model, status, audioSeconds: status === 'ok' ? audioSeconds : 0,
    costUsd: status === 'ok' ? transcriptionCost(audioSeconds, provider) : 0,
    ...(error ? { error: String(error).slice(0, 200) } : {}),
  });
}
