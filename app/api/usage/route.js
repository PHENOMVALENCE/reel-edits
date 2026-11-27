import { serverConfig } from '../../../lib/server/config.js';
import { getStore } from '../../../lib/server/usage/store.js';
import { usageReport } from '../../../lib/server/usage/budget.js';
import { guard, json, errorResponse } from '../../../lib/server/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/usage?projectId=...  -> this month's totals, this project's totals, budgets and warnings
export async function GET(request) {
  try {
    const config = serverConfig();
    guard(request, config);
    const projectId = (new URL(request.url).searchParams.get('projectId') || '').replace(/[^\w-]/g, '').slice(0, 64) || null;
    return json(await usageReport(getStore(config), config, projectId));
  } catch (e) {
    return errorResponse(e);
  }
}
