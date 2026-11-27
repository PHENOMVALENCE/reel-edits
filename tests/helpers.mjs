// Test helpers: a fake HTTP transport for the real Anthropic SDK, and fixtures.
import { FPS } from '../lib/catalog.js';

export const clip = (id, seconds) => ({ id, kind: 'video', durationFrames: seconds * FPS, orientation: 'portrait' });
export const photo = (id) => ({ id, kind: 'photo', orientation: 'landscape' });

// Turn a Messages API response into the SSE stream the SDK's .stream() expects.
export function sse(message) {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  let out = ev('message_start', {
    message: { id: message.id || 'msg_test', type: 'message', role: 'assistant', model: message.model || 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: message.usage?.input_tokens ?? 100, output_tokens: 1, cache_read_input_tokens: message.usage?.cache_read_input_tokens ?? 0, cache_creation_input_tokens: message.usage?.cache_creation_input_tokens ?? 0 } },
  });
  message.content.forEach((block, index) => {
    if (block.type === 'text') {
      out += ev('content_block_start', { index, content_block: { type: 'text', text: '' } });
      out += ev('content_block_delta', { index, delta: { type: 'text_delta', text: block.text } });
    } else if (block.type === 'tool_use') {
      out += ev('content_block_start', { index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } });
      out += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
    }
    out += ev('content_block_stop', { index });
  });
  out += ev('message_delta', { delta: { stop_reason: message.stop_reason || 'end_turn', stop_sequence: null }, usage: { output_tokens: message.usage?.output_tokens ?? 50 } });
  out += ev('message_stop', {});
  return out;
}

// A scripted transport. Each handler receives { url, method, body } and returns a Response.
export function fakeFetch(handlers) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = String(url);
    const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url: u, method: init.method || 'GET', body });
    const h = handlers.shift();
    if (!h) throw new Error(`Unexpected request to ${u}`);
    return h({ url: u, method: init.method, body });
  };
  fn.calls = calls;
  return fn;
}

export const jsonResponse = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'retry-after-ms': '1', ...headers } });
export const sseResponse = (message) => new Response(sse(message), { status: 200, headers: { 'content-type': 'text/event-stream' } });
export const apiError = (status, type, message) => jsonResponse({ type: 'error', error: { type, message } }, status);

export const textMessage = (obj, extra = {}) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }], ...extra });

export function samplePlan() {
  return {
    title: 'Beach day',
    endText: 'Follow for more',
    sections: [
      { id: 'hook', purpose: 'grab attention', shots: [{ asset: 'C1', start: 2, length: 3, transition: 'cut', effect: 'punch_in', reason: 'big splash' }] },
      {
        id: 'build', purpose: 'the day', shots: [
          { asset: 'C2', start: 0, length: 10, transition: 'fade', effect: 'none', reason: 'walk' },
          { asset: 'P1', start: 0, length: 3, transition: 'cut', effect: 'ken_burns', reason: 'still' },
          { asset: 'C1', start: 10, length: 15, transition: 'cut', effect: 'slow_push', reason: 'swim' },
        ],
      },
      { id: 'outro', purpose: 'sunset', shots: [{ asset: 'C2', start: 20, length: 30, transition: 'cut', effect: 'none', reason: 'sunset' }] },
    ],
    captions: { style: 'karaoke', emphasis: ['sunset'], maxWordsPerLine: 3, position: 'lower' },
    audio: { musicVolume: 0.8, clipVolume: 0.2, speechVolume: 1, duckUnderSpeech: true },
    notes: 'Opens on the splash.',
  };
}

export const testConfig = (over = {}) => ({
  defaultModel: 'claude-opus-5-5', allowedModels: [], maxRetries: 0, timeoutMs: 10000, fallbacks: true,
  maxFrames: 64, maxFrameBytes: 400000, maxOutputTokens: 32000,
  budgets: { monthlyUsd: 20, projectUsd: 2, warnAt: 0.8, audioMinutesMonthly: 120, hardCapUsd: 50 },
  pricingOverrides: {}, accessToken: '', allowOpenApi: true, usageDurable: true,
  transcription: { provider: 'none', openaiKey: '', openaiModel: 'whisper-1', whisperCppUrl: '', maxUploadBytes: 4000000 },
  ...over,
});
