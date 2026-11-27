// Error mapping and retry shared by transcription providers.

export class TranscriptionError extends Error {
  constructor(code, message, { status = 502, retryable = false } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

// Shared HTTP error mapping for providers.
export async function providerHttpError(res, label) {
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 200);
  } catch { /* ignore */ }
  if (res.status === 401 || res.status === 403) return new TranscriptionError('auth', `${label} rejected the credentials.`, { status: 502 });
  if (res.status === 413) return new TranscriptionError('too_large', `${label}: audio chunk too large.`, { status: 413 });
  if (res.status === 429) return new TranscriptionError('rate_limited', `${label} rate limit reached.`, { status: 429, retryable: true });
  if (res.status >= 500) return new TranscriptionError('unavailable', `${label} is unavailable (${res.status}).`, { status: 503, retryable: true });
  return new TranscriptionError('bad_request', `${label} error ${res.status}: ${detail}`, { status: 400 });
}

// Retry transient provider failures with exponential backoff.
export async function withRetry(fn, { retries = 2, baseMs = 500, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (e) {
      const retryable = e.retryable || e.name === 'TypeError' /* fetch network failure */;
      if (!retryable || attempt >= retries) throw e;
      await sleep(baseMs * 2 ** attempt);
      attempt++;
    }
  }
}
