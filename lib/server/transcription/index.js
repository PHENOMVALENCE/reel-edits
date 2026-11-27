// Transcription provider abstraction.
// Claude's API has no speech-to-text endpoint, so audio goes to a dedicated provider and
// Claude receives the resulting transcript as text.
//
// A provider is { id, label, model, available(config), capabilities, transcribe({ audio, filename, mimeType, language, config, fetch }) }
// and returns the Transcript shape documented in lib/transcript.js.

import { openaiWhisper } from './openaiWhisper.js';
import { whisperCpp } from './whisperCpp.js';

const registry = new Map();

export function registerTranscriber(provider) {
  for (const k of ['id', 'label', 'transcribe', 'available']) {
    if (!provider[k]) throw new Error(`Transcription provider is missing "${k}".`);
  }
  registry.set(provider.id, provider);
}

registerTranscriber(openaiWhisper);
registerTranscriber(whisperCpp);

export function listTranscribers(config) {
  return [...registry.values()].map((p) => ({
    id: p.id, label: p.label, available: p.available(config), capabilities: p.capabilities, costPerMinute: p.costPerMinute,
  }));
}

export function getTranscriber(id, config) {
  const p = registry.get(id);
  if (!p) throw Object.assign(new Error(`Unknown transcription provider "${id}".`), { status: 400, code: 'bad_request' });
  if (!p.available(config)) throw Object.assign(new Error(`${p.label} is not configured on the server.`), { status: 503, code: 'not_configured' });
  return p;
}

export { TranscriptionError, providerHttpError, withRetry } from './errors.js';
