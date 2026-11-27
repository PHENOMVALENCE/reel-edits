import { connectionStatus } from '../../../../lib/server/claude/provider.js';
import { guard, json, errorResponse } from '../../../../lib/server/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/claude/status          -> configured?, credential type (never the credential itself)
// GET /api/claude/status?test=1   -> also makes a live call (lists models) and reports latency
export async function GET(request) {
  try {
    const test = new URL(request.url).searchParams.get('test') === '1';
    if (test) guard(request);
    return json(await connectionStatus({ test }));
  } catch (e) {
    return errorResponse(e);
  }
}
