import { STEPS } from '../../../../lib/server/claude/editorAgent.js';
import { cachedModels, resolveModel, classifyError } from '../../../../lib/server/claude/provider.js';
import { parseAgentInput } from '../../../../lib/server/agentInput.js';
import { serverConfig } from '../../../../lib/server/config.js';
import { getStore } from '../../../../lib/server/usage/store.js';
import { usageReport } from '../../../../lib/server/usage/budget.js';
import { guard, json, errorResponse } from '../../../../lib/server/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// POST /api/agent/{analyze|plan|review|section}
export async function POST(request, { params }) {
  try {
    const config = serverConfig();
    guard(request, config);
    const { step } = await params;
    const run = STEPS[step];
    if (!run) return json({ error: { code: 'not_found', message: `Unknown step "${step}".` } }, 404);
    const ctx = parseAgentInput(await request.json(), config, step);
    ctx.model = resolveModel(ctx.model, await cachedModels({ config }), config);
    const store = getStore(config);
    const result = await run(ctx, { store, config });
    const usage = await usageReport(store, config, ctx.projectId);
    return json({ step, data: result.data, model: result.model, warnings: result.warnings, usage: { project: usage.projectTotals, warnings: usage.warnings } });
  } catch (e) {
    return errorResponse(classifyError(e));
  }
}
