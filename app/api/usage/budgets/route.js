import { serverConfig } from '../../../../lib/server/config.js';
import { getStore } from '../../../../lib/server/usage/store.js';
import { saveBudgets } from '../../../../lib/server/usage/budget.js';
import { guard, json, errorResponse } from '../../../../lib/server/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PUT /api/usage/budgets {monthlyUsd, projectUsd, warnAt, audioMinutesMonthly}
// Values above the server's REEL_BUDGET_HARD_CAP_USD are rejected.
export async function PUT(request) {
  try {
    const config = serverConfig();
    guard(request, config);
    return json({ budgets: await saveBudgets(getStore(config), config, await request.json()) });
  } catch (e) {
    return errorResponse(e);
  }
}
