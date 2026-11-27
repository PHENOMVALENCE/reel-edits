// Server-only configuration, read from environment variables.
// Secrets live in .env.local for development and in the host's secret store in production.
// Nothing here is ever sent to the browser: routes return only derived, non-secret fields.

if (typeof window !== 'undefined') {
  throw new Error('lib/server modules must never be bundled into browser code.');
}

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' && v != null ? n : d;
};

export const DEFAULT_MODEL = 'claude-opus-5-5';

// Which supported credential the server will use for Claude. Deliberately narrow:
//   api_key            ANTHROPIC_API_KEY (a Claude Console API key)
//   workload_identity  short-lived tokens via Workload Identity Federation (a JWT file from your platform)
// ANTHROPIC_AUTH_TOKEN, OAuth profiles and Claude.ai sessions are never read.
export function claudeCredentials(env = process.env) {
  if (env.ANTHROPIC_API_KEY) return { mode: 'api_key', apiKey: env.ANTHROPIC_API_KEY };
  const rule = env.ANTHROPIC_FEDERATION_RULE_ID;
  const org = env.ANTHROPIC_ORGANIZATION_ID;
  const tokenFile = env.ANTHROPIC_IDENTITY_TOKEN_FILE;
  if (rule && org && tokenFile) {
    return {
      mode: 'workload_identity',
      config: {
        authentication: {
          type: 'oidc_federation',
          federation_rule_id: rule,
          ...(env.ANTHROPIC_SERVICE_ACCOUNT_ID ? { service_account_id: env.ANTHROPIC_SERVICE_ACCOUNT_ID } : {}),
          identity_token: { source: 'file', path: tokenFile },
        },
        organization_id: org,
        ...(env.ANTHROPIC_WORKSPACE_ID ? { workspace_id: env.ANTHROPIC_WORKSPACE_ID } : {}),
      },
    };
  }
  return { mode: 'none' };
}

export function serverConfig(env = process.env) {
  const hardCap = num(env.REEL_BUDGET_HARD_CAP_USD, 50);
  return {
    defaultModel: env.REEL_CLAUDE_MODEL || DEFAULT_MODEL,
    allowedModels: (env.REEL_CLAUDE_ALLOWED_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean),
    maxRetries: num(env.REEL_CLAUDE_MAX_RETRIES, 3),
    timeoutMs: num(env.REEL_CLAUDE_TIMEOUT_MS, 280_000),
    fallbacks: env.REEL_CLAUDE_FALLBACKS !== 'off',
    maxFrames: num(env.REEL_MAX_FRAMES, 64),
    maxFrameBytes: num(env.REEL_MAX_FRAME_BYTES, 400_000),
    maxOutputTokens: num(env.REEL_MAX_OUTPUT_TOKENS, 32_000),
    budgets: {
      monthlyUsd: Math.min(hardCap, num(env.REEL_BUDGET_MONTHLY_USD, 20)),
      projectUsd: Math.min(hardCap, num(env.REEL_BUDGET_PROJECT_USD, 2)),
      warnAt: num(env.REEL_BUDGET_WARN_AT, 0.8),
      audioMinutesMonthly: num(env.REEL_MAX_AUDIO_MINUTES_MONTHLY, 120),
      hardCapUsd: hardCap,
    },
    pricingOverrides: parseJson(env.REEL_PRICING_JSON, {}),
    accessToken: env.REEL_ACCESS_TOKEN || '',
    // In production the AI routes refuse to run open to the internet unless this is set on purpose.
    allowOpenApi: env.REEL_ALLOW_OPEN_API === '1' || env.NODE_ENV !== 'production',
    usageFile: env.REEL_USAGE_FILE || (env.VERCEL ? '/tmp/reel-usage.json' : '.data/usage.json'),
    usageDurable: !env.VERCEL || Boolean(env.REEL_USAGE_FILE),
    transcription: {
      provider: env.REEL_TRANSCRIPTION_PROVIDER || (env.OPENAI_API_KEY ? 'openai-whisper' : env.WHISPER_CPP_URL ? 'whisper-cpp' : 'none'),
      openaiKey: env.OPENAI_API_KEY || '',
      openaiModel: env.REEL_WHISPER_MODEL || 'whisper-1',
      whisperCppUrl: env.WHISPER_CPP_URL || '',
      maxUploadBytes: num(env.REEL_MAX_AUDIO_BYTES, 4_000_000),
    },
  };
}

function parseJson(s, fallback) {
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}
