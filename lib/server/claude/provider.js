// Claude provider: the only module that talks to the Anthropic API.
// Server-side only. Credentials come from env (API key or workload identity) and never leave the server.

import Anthropic from '@anthropic-ai/sdk';
import { claudeCredentials, serverConfig } from '../config.js';
import { validateSchema } from '../../ai/validate.js';
import { assertWithinBudget, estimateClaudeCost, recordClaudeUsage } from '../usage/budget.js';

// Models that accept server-side refusal fallbacks (fallbacks: "default").
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5', 'claude-sonnet-5-5']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export class ClaudeError extends Error {
  constructor(code, message, { status = 502, retryable = false, cause } = {}) {
    super(message);
    this.name = 'ClaudeError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    if (cause) this.cause = cause;
  }
}

let cachedClient = null;
let cachedKey = '';

// opts.fetch is for tests: the real SDK runs against a fake transport.
export function createClaudeClient({ env = process.env, fetch, maxRetries } = {}) {
  const creds = claudeCredentials(env);
  const cfg = serverConfig(env);
  if (creds.mode === 'none') {
    throw new ClaudeError('not_configured', 'Claude is not connected. Set ANTHROPIC_API_KEY (or workload identity variables) on the server.', { status: 503 });
  }
  const common = { maxRetries: maxRetries ?? cfg.maxRetries, timeout: cfg.timeoutMs, ...(fetch ? { fetch } : {}) };
  // Pass the credential explicitly so the SDK never falls back to ANTHROPIC_AUTH_TOKEN or an OAuth profile on disk.
  return creds.mode === 'api_key'
    ? new Anthropic({ ...common, apiKey: creds.apiKey })
    : new Anthropic({ ...common, config: creds.config });
}

export function getClaudeClient(env = process.env) {
  const key = `${env.ANTHROPIC_API_KEY ? 'k' : ''}${env.ANTHROPIC_FEDERATION_RULE_ID || ''}`;
  if (!cachedClient || key !== cachedKey) {
    cachedClient = createClaudeClient({ env });
    cachedKey = key;
  }
  return cachedClient;
}

// Map SDK errors to stable codes the UI can explain. Uses the SDK's typed classes, not message text.
export function classifyError(e) {
  if (e instanceof ClaudeError) return e;
  if (e?.code === 'budget_exceeded') return e;
  if (e instanceof Anthropic.AuthenticationError) return new ClaudeError('auth', 'Claude rejected the API credentials. Check ANTHROPIC_API_KEY on the server.', { status: 502, cause: e });
  if (e instanceof Anthropic.PermissionDeniedError) return new ClaudeError('permission', 'This API key is not allowed to use that model or feature.', { status: 502, cause: e });
  if (e instanceof Anthropic.NotFoundError) return new ClaudeError('model_not_found', 'That Claude model is not available to this API key.', { status: 400, cause: e });
  if (e instanceof Anthropic.RateLimitError) return new ClaudeError('rate_limited', 'Claude rate limit reached. Try again in a minute.', { status: 429, retryable: true, cause: e });
  if (e instanceof Anthropic.BadRequestError) {
    const billing = /credit balance/i.test(e.message || '');
    return new ClaudeError(billing ? 'billing' : 'bad_request', billing
      ? 'Your Claude API credit balance is too low. Add credits or check billing in the Claude Console.'
      : `Claude could not process the request: ${e.message}`, { status: billing ? 402 : 400, cause: e });
  }
  if (e instanceof Anthropic.InternalServerError || e?.status === 529) return new ClaudeError('overloaded', 'Claude is temporarily overloaded or unavailable. Try again shortly.', { status: 503, retryable: true, cause: e });
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new ClaudeError('timeout', 'The request to Claude timed out.', { status: 504, retryable: true, cause: e });
  if (e instanceof Anthropic.APIConnectionError) return new ClaudeError('network', 'Could not reach the Claude API.', { status: 503, retryable: true, cause: e });
  if (e instanceof Anthropic.APIError) return new ClaudeError('api_error', `Claude API error ${e.status ?? ''}: ${e.message}`, { status: 502, cause: e });
  return new ClaudeError('internal', e?.message || 'Unexpected error calling Claude.', { status: 500, cause: e });
}

export async function listModels({ client = getClaudeClient(), config = serverConfig() } = {}) {
  const models = [];
  try {
    for await (const m of client.models.list({ limit: 100 })) {
      models.push({ id: m.id, name: m.display_name, created: m.created_at, contextWindow: m.max_input_tokens ?? null, maxOutput: m.max_tokens ?? null });
    }
  } catch (e) {
    throw classifyError(e);
  }
  const allowed = config.allowedModels.length ? models.filter((m) => config.allowedModels.includes(m.id)) : models;
  return allowed.filter((m) => /^claude-/.test(m.id));
}

export function resolveModel(requested, available, config = serverConfig()) {
  const ids = available?.map((m) => m.id);
  if (!requested) return config.defaultModel;
  if (config.allowedModels.length && !config.allowedModels.includes(requested)) {
    throw new ClaudeError('model_not_allowed', `Model ${requested} is not enabled on this server.`, { status: 400 });
  }
  if (ids && !ids.includes(requested)) throw new ClaudeError('model_not_found', `Model ${requested} is not available to this API key.`, { status: 400 });
  if (!/^claude-[a-z0-9-]+$/.test(requested)) throw new ClaudeError('bad_request', 'Invalid model id.', { status: 400 });
  return requested;
}

export async function connectionStatus({ test = false, client, env = process.env } = {}) {
  const creds = claudeCredentials(env);
  const config = serverConfig(env);
  const base = {
    configured: creds.mode !== 'none',
    credential: creds.mode,
    defaultModel: config.defaultModel,
    accessTokenRequired: Boolean(config.accessToken),
    openApiBlocked: !config.accessToken && !config.allowOpenApi,
    usageDurable: config.usageDurable,
  };
  if (!base.configured || !test) return { ...base, state: base.configured ? 'untested' : 'not_configured' };
  const started = Date.now();
  try {
    const models = await listModels({ client: client || getClaudeClient(env), config });
    return { ...base, state: 'connected', latencyMs: Date.now() - started, models };
  } catch (e) {
    const err = classifyError(e);
    return { ...base, state: 'error', error: { code: err.code, message: err.message } };
  }
}

function extractJsonText(message) {
  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, text };
  }
}

function countPayload(content) {
  let textChars = 0;
  let images = 0;
  const walk = (c) => {
    if (typeof c === 'string') textChars += c.length;
    else if (Array.isArray(c)) c.forEach(walk);
    else if (c?.type === 'image') images++;
    else if (c?.type === 'text') textChars += c.text.length;
    else if (c?.type === 'tool_result') walk(c.content);
    else if (c?.content) walk(c.content);
  };
  walk(content);
  return { textChars, images };
}

/**
 * One structured Claude call (optionally with a tool loop), budget-checked and usage-recorded.
 *  - system: stable instructions (cached)
 *  - messages: Anthropic.MessageParam[]
 *  - schema: JSON schema for the final answer (output_config.format)
 *  - tools / runTool: optional client tools; runTool(name, input) returns a JSON-able result
 */
export async function callStructured({
  step, projectId, model, system, messages, schema, effort = 'high', maxTokens, expectedOutputTokens = 6000,
  tools, runTool, maxToolRounds = 3, client, store, config = serverConfig(),
}) {
  const c = client || getClaudeClient();
  const max = Math.min(maxTokens || config.maxOutputTokens, config.maxOutputTokens);
  const convo = [...messages];
  const warnings = [];
  let schemaRetries = 0;
  let last = null;

  for (let round = 0; round <= maxToolRounds + 1; round++) {
    const { textChars, images } = countPayload([system, convo]);
    const estimateUsd = estimateClaudeCost({ model, textChars, images, expectedOutputTokens }, config.pricingOverrides);
    await assertWithinBudget(store, config, { projectId, estimateUsd });

    const useFallbacks = config.fallbacks && FALLBACK_MODELS.has(model);
    const params = {
      model,
      max_tokens: max,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: convo,
      thinking: { type: 'adaptive' },
      output_config: { effort, format: { type: 'json_schema', schema } },
      ...(tools?.length ? { tools, tool_choice: { type: 'auto' } } : {}),
      ...(useFallbacks ? { betas: [FALLBACK_BETA], fallbacks: 'default' } : {}),
    };

    let message;
    try {
      // Streaming keeps long plans clear of HTTP timeouts; finalMessage() assembles the result.
      message = await c.beta.messages.stream(params).finalMessage();
    } catch (e) {
      const err = classifyError(e);
      await recordClaudeUsage(store, config, { projectId, step, model, status: 'error', error: err.code });
      throw err;
    }
    last = message;
    await recordClaudeUsage(store, config, { projectId, step, model: message.model || model, usage: message.usage });

    if (message.stop_reason === 'refusal') {
      throw new ClaudeError('refusal', 'Claude declined to plan this footage. The free planner can still make a reel.', { status: 422 });
    }
    if (message.stop_reason === 'max_tokens') {
      throw new ClaudeError('truncated', 'Claude ran out of room before finishing the plan. Try fewer clips or a shorter reel.', { status: 502, retryable: true });
    }

    if (message.stop_reason === 'tool_use' && runTool) {
      const uses = message.content.filter((b) => b.type === 'tool_use');
      convo.push({ role: 'assistant', content: message.content });
      const results = [];
      for (const use of uses) {
        try {
          results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(await runTool(use.name, use.input)) });
        } catch (e) {
          results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: String(e.message || e) });
        }
      }
      convo.push({ role: 'user', content: results });
      if (round >= maxToolRounds) {
        convo.push({ role: 'user', content: 'Tool budget used. Give your final answer now as JSON matching the schema.' });
      }
      continue;
    }

    const parsed = extractJsonText(message);
    const errors = parsed.ok ? validateSchema(schema, parsed.value) : ['reply was not valid JSON'];
    if (!errors.length) {
      return { data: parsed.value, model: message.model || model, usage: message.usage, warnings, id: message.id };
    }
    // One corrective retry: show Claude exactly what failed validation.
    if (schemaRetries++ >= 1) {
      throw new ClaudeError('invalid_output', `Claude's plan failed validation: ${errors.slice(0, 3).join('; ')}`, { status: 502, retryable: true });
    }
    warnings.push('Claude reply failed validation once and was retried.');
    convo.push({ role: 'assistant', content: message.content });
    convo.push({ role: 'user', content: `That reply failed validation: ${errors.slice(0, 5).join('; ')}. Reply again with JSON that matches the schema exactly.` });
  }
  throw new ClaudeError('invalid_output', 'Claude did not produce a final answer.', { status: 502, cause: last });
}

// Models list, cached for 10 minutes per server instance.
let modelsCache = { at: 0, models: null };
export async function cachedModels(opts = {}) {
  if (modelsCache.models && Date.now() - modelsCache.at < 600_000) return modelsCache.models;
  const models = await listModels(opts);
  modelsCache = { at: Date.now(), models };
  return models;
}
export function clearModelsCache() {
  modelsCache = { at: 0, models: null };
}
