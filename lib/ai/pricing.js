// Estimated API prices, USD per million tokens (Anthropic first-party list prices, Nov 2026).
// These are estimates for budgeting: your invoice in the Claude Console is the source of truth.
// Override or extend with REEL_PRICING_JSON, e.g. {"claude-opus-5-5":{"input":4,"output":20,"cacheRead":0.2}}.

export const CLAUDE_PRICES = {
  'claude-fable-5-2': { input: 8, output: 40, cacheRead: 0.2 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 1 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
};

// Unknown models are budgeted at the most expensive known rate so a budget is never under-enforced.
const CONSERVATIVE = { input: 10, output: 50, cacheRead: 1 };
const CACHE_WRITE_MULTIPLIER = 1.25; // 5-minute cache writes

// Transcription, USD per audio minute.
export const TRANSCRIPTION_PRICES = {
  'openai-whisper': 0.006,
  'whisper-cpp': 0,
};

export function priceFor(model, overrides = {}) {
  const table = { ...CLAUDE_PRICES, ...overrides };
  if (table[model]) return { ...table[model], estimated: false };
  // Dated or suffixed IDs resolve to their family entry.
  const family = Object.keys(table).sort((a, b) => b.length - a.length).find((id) => model?.startsWith(id));
  if (family) return { ...table[family], estimated: false };
  return { ...CONSERVATIVE, estimated: true };
}

export function claudeCost(usage, model, overrides) {
  const p = priceFor(model, overrides);
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const usd = (input * p.input + output * p.output + cacheRead * p.cacheRead + cacheWrite * p.input * CACHE_WRITE_MULTIPLIER) / 1e6;
  return { usd: round(usd), estimatedPrice: p.estimated };
}

export function transcriptionCost(seconds, provider, overrides = {}) {
  const perMinute = { ...TRANSCRIPTION_PRICES, ...overrides }[provider] ?? 0.006;
  return round((Math.max(0, seconds) / 60) * perMinute);
}

const round = (n) => Math.round(n * 1e6) / 1e6;
