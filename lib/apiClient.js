// Browser client for the Reel Edits server routes. Holds no Claude credentials:
// the server owns those. The optional access token is the app's own password (REEL_ACCESS_TOKEN).

export class ApiError extends Error {
  constructor(status, error) {
    super(error?.message || `Request failed (${status}).`);
    this.status = status;
    this.code = error?.code || 'error';
    this.retryable = Boolean(error?.retryable);
    this.details = error?.details;
  }
}

export function createApi({ base = '', getAccessToken = () => '', fetchImpl } = {}) {
  const f = fetchImpl || ((...a) => fetch(...a));
  async function call(path, init = {}) {
    const headers = new Headers(init.headers || {});
    const token = getAccessToken();
    if (token) headers.set('x-reel-access-token', token);
    let res;
    try {
      res = await f(`${base}${path}`, { ...init, headers });
    } catch {
      throw new ApiError(0, { code: 'network', message: 'Could not reach the Reel Edits server.' });
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, body.error);
    return body;
  }
  const post = (path, data) => call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  return {
    status: (test = false) => call(`/api/claude/status${test ? '?test=1' : ''}`),
    models: () => call('/api/claude/models'),
    agent: (step, payload) => post(`/api/agent/${step}`, payload),
    transcribers: () => call('/api/transcribe/providers'),
    transcribe: ({ wav, seconds, projectId, provider, language }) => {
      const form = new FormData();
      form.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
      form.append('seconds', String(seconds));
      if (projectId) form.append('projectId', projectId);
      if (provider) form.append('provider', provider);
      if (language) form.append('language', language);
      return call('/api/transcribe', { method: 'POST', body: form });
    },
    usage: (projectId) => call(`/api/usage${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`),
    saveBudgets: (budgets) => call('/api/usage/budgets', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(budgets) }),
  };
}
