import { listTranscribers } from '../../../../lib/server/transcription/index.js';
import { serverConfig } from '../../../../lib/server/config.js';
import { json } from '../../../../lib/server/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const config = serverConfig();
  return json({ default: config.transcription.provider, providers: listTranscribers(config) });
}
