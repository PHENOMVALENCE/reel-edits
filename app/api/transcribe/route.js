import { getTranscriber, TranscriptionError } from '../../../lib/server/transcription/index.js';
import { serverConfig } from '../../../lib/server/config.js';
import { getStore } from '../../../lib/server/usage/store.js';
import { assertWithinBudget, recordTranscriptionUsage } from '../../../lib/server/usage/budget.js';
import { transcriptionCost } from '../../../lib/ai/pricing.js';
import { guard, json, errorResponse } from '../../../lib/server/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const AUDIO_TYPES = new Set(['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/ogg', 'audio/flac']);

// POST /api/transcribe  multipart: file (audio chunk), seconds, projectId, provider?, language?
export async function POST(request) {
  const config = serverConfig();
  const store = getStore(config);
  let provider;
  let projectId = null;
  let seconds = 0;
  try {
    guard(request, config);
    const form = await request.formData();
    const file = form.get('file');
    projectId = String(form.get('projectId') || '').replace(/[^\w-]/g, '').slice(0, 64) || null;
    seconds = Math.max(0, Number(form.get('seconds')) || 0);
    const id = String(form.get('provider') || config.transcription.provider);
    const language = String(form.get('language') || '').slice(0, 8) || undefined;
    if (!file || typeof file === 'string') throw new TranscriptionError('bad_request', 'No audio file was sent.', { status: 400 });
    if (file.size > config.transcription.maxUploadBytes) throw new TranscriptionError('too_large', 'Audio chunk is too large.', { status: 413 });
    if (file.type && !AUDIO_TYPES.has(file.type)) throw new TranscriptionError('bad_request', `Unsupported audio type ${file.type}.`, { status: 400 });
    if (id === 'none') throw new TranscriptionError('not_configured', 'No transcription provider is configured.', { status: 503 });
    provider = getTranscriber(id, config);
    await assertWithinBudget(store, config, { projectId, estimateUsd: transcriptionCost(seconds, provider.id), audioSeconds: seconds });
    const transcript = await provider.transcribe({
      audio: await file.arrayBuffer(), filename: file.name || 'audio.wav', mimeType: file.type || 'audio/wav', language, config,
    });
    await recordTranscriptionUsage(store, config, { projectId, provider: provider.id, model: transcript.model, audioSeconds: transcript.durationSeconds || seconds });
    return json({ transcript });
  } catch (e) {
    if (provider && e.code !== 'budget_exceeded') {
      await recordTranscriptionUsage(store, config, { projectId, provider: provider.id, audioSeconds: seconds, status: 'error', error: e.code || e.message }).catch(() => {});
    }
    return errorResponse(e);
  }
}
