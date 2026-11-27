import { cachedModels, classifyError } from '../../../../lib/server/claude/provider.js';
import { serverConfig } from '../../../../lib/server/config.js';
import { priceFor } from '../../../../lib/ai/pricing.js';
import { guard, json, errorResponse } from '../../../../lib/server/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const config = serverConfig();
    guard(request, config);
    const models = await cachedModels({ config });
    return json({
      defaultModel: config.defaultModel,
      models: models.map((m) => ({ ...m, price: priceFor(m.id, config.pricingOverrides) })),
    });
  } catch (e) {
    return errorResponse(classifyError(e));
  }
}
