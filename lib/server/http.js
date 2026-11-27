// Helpers shared by the API route handlers.

import { timingSafeEqual } from 'node:crypto';
import { serverConfig } from './config.js';

export function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
}

export function errorResponse(e) {
  const status = Number(e?.status) || 500;
  const body = { error: { code: e?.code || 'internal', message: status >= 500 && !e?.code ? 'Server error.' : e.message } };
  if (e?.details) body.error.details = e.details;
  if (e?.retryable) body.error.retryable = true;
  if (status >= 500) console.error('[reel-edits api]', e?.code || '', e?.message, e?.cause?.message || '');
  return json(body, status);
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

// Optional shared app password for the AI routes (REEL_ACCESS_TOKEN). It protects your Claude
// budget on a public URL. It is the app's own token, unrelated to any Claude credential.
export function guard(request, config = serverConfig()) {
  if (config.accessToken) {
    const got = request.headers.get('x-reel-access-token') || '';
    if (!safeEqual(got, config.accessToken)) {
      throw Object.assign(new Error('Enter the app access token in AI settings.'), { status: 401, code: 'access_token' });
    }
    return;
  }
  if (!config.allowOpenApi) {
    throw Object.assign(new Error('AI routes are disabled in production until REEL_ACCESS_TOKEN is set (or REEL_ALLOW_OPEN_API=1).'), { status: 403, code: 'open_api_blocked' });
  }
}
