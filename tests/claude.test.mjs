import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeCredentials } from '../lib/server/config.js';
import { createClaudeClient, connectionStatus, resolveModel, callStructured, ClaudeError } from '../lib/server/claude/provider.js';
import { reviewEdit, planEdit } from '../lib/server/claude/editorAgent.js';
import { parseAgentInput } from '../lib/server/agentInput.js';
import { MemoryStore } from '../lib/server/usage/store.js';
import { usageReport } from '../lib/server/usage/budget.js';
import { PLAN_SCHEMA } from '../lib/ai/schemas.js';
import { fakeFetch, jsonResponse, sseResponse, apiError, textMessage, samplePlan, testConfig, clip, photo } from './helpers.mjs';

const ENV = { ANTHROPIC_API_KEY: 'sk-ant-test' };
const client = (handlers, maxRetries = 0) => {
  const fetch = fakeFetch(handlers);
  return { client: createClaudeClient({ env: ENV, fetch, maxRetries }), fetch };
};
const assets = [clip('C1', 40), clip('C2', 55), photo('P1')];
const ctxBase = { projectId: 'p1', model: 'claude-opus-5-5', assets, transcripts: {}, music: null, brief: 'Beach', presetId: 'cinematic', targetSeconds: 60, title: '', endText: '' };

test('credentials: API key, workload identity, never the OAuth auth token', () => {
  assert.equal(claudeCredentials({ ANTHROPIC_API_KEY: 'k' }).mode, 'api_key');
  assert.equal(claudeCredentials({ ANTHROPIC_AUTH_TOKEN: 'oauth-token' }).mode, 'none');
  const wif = claudeCredentials({ ANTHROPIC_FEDERATION_RULE_ID: 'fdrl_1', ANTHROPIC_ORGANIZATION_ID: 'org', ANTHROPIC_IDENTITY_TOKEN_FILE: '/var/run/token' });
  assert.equal(wif.mode, 'workload_identity');
  assert.equal(wif.config.authentication.type, 'oidc_federation');
  assert.equal(wif.config.authentication.identity_token.path, '/var/run/token');
  assert.throws(() => createClaudeClient({ env: {} }), (e) => e.code === 'not_configured');
});

test('connection test lists models and never exposes the key', async () => {
  const { client: c, fetch } = client([() => jsonResponse({ data: [
    { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-10-01T00:00:00Z', type: 'model', max_input_tokens: 1000000, max_tokens: 128000 },
    { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', created_at: '2026-10-01T00:00:00Z', type: 'model' },
  ], has_more: false, first_id: 'claude-opus-5-5', last_id: 'claude-sonnet-5-5' })]);
  const s = await connectionStatus({ test: true, client: c, env: ENV });
  assert.equal(s.state, 'connected');
  assert.deepEqual(s.models.map((m) => m.id), ['claude-opus-5-5', 'claude-sonnet-5-5']);
  assert.equal(s.models[0].contextWindow, 1000000);
  assert.ok(!JSON.stringify(s).includes('sk-ant-test'));
  assert.match(fetch.calls[0].url, /\/v1\/models/);
});

test('connection test reports a bad key as an auth error', async () => {
  const { client: c } = client([() => apiError(401, 'authentication_error', 'invalid x-api-key')]);
  const s = await connectionStatus({ test: true, client: c, env: ENV });
  assert.equal(s.state, 'error');
  assert.equal(s.error.code, 'auth');
});

test('model selection: default, available, allow-list', () => {
  const available = [{ id: 'claude-opus-5-5' }, { id: 'claude-sonnet-5-5' }];
  assert.equal(resolveModel(null, available, testConfig()), 'claude-opus-5-5');
  assert.equal(resolveModel('claude-sonnet-5-5', available, testConfig()), 'claude-sonnet-5-5');
  assert.throws(() => resolveModel('claude-fable-5-2', available, testConfig()), (e) => e.code === 'model_not_found');
  assert.throws(() => resolveModel('claude-sonnet-5-5', available, testConfig({ allowedModels: ['claude-opus-5-5'] })), (e) => e.code === 'model_not_allowed');
});

test('structured editing response is validated, and usage is recorded with cost', async () => {
  const store = new MemoryStore();
  const { client: c, fetch } = client([() => sseResponse(textMessage(samplePlan(), { usage: { input_tokens: 10000, output_tokens: 2000, cache_read_input_tokens: 5000 } }))]);
  const res = await planEdit(ctxBase, { client: c, store, config: testConfig() });
  assert.equal(res.data.sections.length, 3);
  const body = fetch.calls[0].body;
  assert.equal(body.model, 'claude-opus-5-5');
  assert.deepEqual(body.thinking, { type: 'adaptive' });
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.equal(body.output_config.effort, 'high');
  assert.equal(body.fallbacks, 'default');
  assert.equal(body.system[0].cache_control.type, 'ephemeral');
  assert.equal(body.stream, true);
  const report = await usageReport(store, testConfig(), 'p1');
  assert.equal(report.projectTotals.inputTokens, 10000);
  assert.equal(report.projectTotals.outputTokens, 2000);
  assert.equal(report.projectTotals.cacheReadTokens, 5000);
  // 10k * $4 + 2k * $20 + 5k * $0.20, per million tokens
  assert.equal(report.projectTotals.claudeUsd, 0.081);
  assert.deepEqual(Object.keys(report.projectTotals.models), ['claude-opus-5-5']);
});

test('an invalid structured reply is retried once with the validation errors', async () => {
  const store = new MemoryStore();
  const bad = { ...samplePlan(), captions: { style: 'sparkles' } };
  const { client: c, fetch } = client([() => sseResponse(textMessage(bad)), () => sseResponse(textMessage(samplePlan()))]);
  const res = await callStructured({ step: 'plan', projectId: 'p1', model: 'claude-opus-5-5', system: 's', messages: [{ role: 'user', content: 'plan' }], schema: PLAN_SCHEMA, client: c, store, config: testConfig() });
  assert.equal(res.data.title, 'Beach day');
  assert.equal(res.warnings.length, 1);
  assert.match(JSON.stringify(fetch.calls[1].body.messages.at(-1)), /failed validation/);
});

test('two invalid replies fail with invalid_output', async () => {
  const { client: c } = client([() => sseResponse(textMessage('not json')), () => sseResponse(textMessage({ nope: 1 }))]);
  await assert.rejects(
    callStructured({ step: 'plan', model: 'claude-opus-5-5', system: 's', messages: [{ role: 'user', content: 'x' }], schema: PLAN_SCHEMA, client: c, store: new MemoryStore(), config: testConfig() }),
    (e) => e.code === 'invalid_output',
  );
});

test('transient failures are retried by the SDK, then succeed', async () => {
  const store = new MemoryStore();
  const { client: c, fetch } = client([
    () => apiError(529, 'overloaded_error', 'Overloaded'),
    () => apiError(500, 'api_error', 'boom'),
    () => sseResponse(textMessage(samplePlan())),
  ], 2);
  const res = await planEdit(ctxBase, { client: c, store, config: testConfig() });
  assert.equal(res.data.sections[0].id, 'hook');
  assert.equal(fetch.calls.length, 3);
  const { events } = await store.read();
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'ok');
});

test('failed requests map to clear errors and are logged at zero cost', async () => {
  for (const [status, type, code] of [[401, 'authentication_error', 'auth'], [429, 'rate_limit_error', 'rate_limited'], [404, 'not_found_error', 'model_not_found'], [529, 'overloaded_error', 'overloaded']]) {
    const store = new MemoryStore();
    const { client: c } = client([() => apiError(status, type, 'x')]);
    await assert.rejects(planEdit(ctxBase, { client: c, store, config: testConfig() }), (e) => e instanceof ClaudeError && e.code === code);
    const { events } = await store.read();
    assert.equal(events[0].status, 'error');
    assert.equal(events[0].costUsd, 0);
  }
  const { client: c } = client([() => apiError(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.')]);
  await assert.rejects(planEdit(ctxBase, { client: c, store: new MemoryStore(), config: testConfig() }), (e) => e.code === 'billing');
});

test('a refusal stops the step instead of returning a partial plan', async () => {
  const { client: c } = client([() => sseResponse({ content: [{ type: 'text', text: '' }], stop_reason: 'refusal' })]);
  await assert.rejects(planEdit(ctxBase, { client: c, store: new MemoryStore(), config: testConfig() }), (e) => e.code === 'refusal');
});

test('budget enforcement blocks the call before anything is sent', async () => {
  const store = new MemoryStore();
  const fetch = fakeFetch([]);
  const c = createClaudeClient({ env: ENV, fetch, maxRetries: 0 });
  const config = testConfig({ budgets: { monthlyUsd: 20, projectUsd: 0.001, warnAt: 0.8, audioMinutesMonthly: 120, hardCapUsd: 50 } });
  await assert.rejects(planEdit(ctxBase, { client: c, store, config }), (e) => e.code === 'budget_exceeded' && e.details.scope === 'project');
  assert.equal(fetch.calls.length, 0);
});

test('review step runs the validate_timeline tool, then returns the improved plan', async () => {
  const store = new MemoryStore();
  const plan = samplePlan();
  const { client: c, fetch } = client([
    () => sseResponse({ content: [{ type: 'tool_use', id: 'toolu_1', name: 'validate_timeline', input: plan }], stop_reason: 'tool_use' }),
    () => sseResponse(textMessage({ ...plan, changes: ['Tightened the hook'] })),
  ]);
  const res = await reviewEdit({ ...ctxBase, currentPlan: plan }, { client: c, store, config: testConfig() });
  assert.deepEqual(res.data.changes, ['Tightened the hook']);
  const second = fetch.calls[1].body;
  assert.equal(second.tools[0].name, 'validate_timeline');
  assert.equal(second.tools[0].strict, true);
  assert.deepEqual(second.tool_choice, { type: 'auto' });
  const result = second.messages.at(-1).content[0];
  assert.equal(result.type, 'tool_result');
  const parsed = JSON.parse(result.content);
  assert.equal(parsed.durationSeconds, 60);
  assert.equal((await store.read()).events.length, 2);
});

test('agent input from the browser is validated', () => {
  const config = testConfig();
  assert.throws(() => parseAgentInput({ assets: [] }, config, 'plan'), /No assets/);
  assert.throws(() => parseAgentInput({ assets: [{ id: 'C1', kind: 'video', durationFrames: 300 }], frames: [{ dataUrl: 'data:text/html;base64,AAAA' }] }, config, 'analyze'), /JPEG/);
  assert.throws(() => parseAgentInput({ assets: [{ id: 'C1', kind: 'video' }], currentPlan: { title: 1 } }, config, 'review'), /malformed/);
  const ctx = parseAgentInput({ assets: [{ id: 'c1', kind: 'video', durationFrames: 300 }, { id: '../x' }], targetSeconds: 500, presetId: 'evil', brief: 'x'.repeat(5000) }, config, 'plan');
  assert.deepEqual(ctx.assets.map((a) => a.id), ['C1']);
  assert.equal(ctx.targetSeconds, 120);
  assert.equal(ctx.presetId, 'hype');
  assert.equal(ctx.brief.length, 1000);
});
