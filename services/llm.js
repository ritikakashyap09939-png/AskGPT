// LLM service abstraction using Node.js built-in fetch (no axios).
// Supports OpenAI-compatible chat completions with optional streaming (SSE).
// To switch providers, change API_BASE and MODEL_NAME in .env.

const API_KEY = process.env.API_KEY;
const MODEL_NAME = process.env.MODEL_NAME || 'gpt-4o-mini';
const API_BASE = (process.env.API_BASE || 'https://api.openai.com/v1').replace(/\/+$/, '');

/**
 * Send a chat completion request (non-streaming).
 * @param {Array<{role:string, content:string}>} messages
 * @param {object} options
 * @returns {Promise<string>}
 */
async function chatCompletion(messages, options = {}) {
  if (!API_KEY) {
    const err = new Error('API key not configured');
    err.code = 'MISSING_API_KEY';
    throw err;
  }

  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 1024,
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`LLM API error ${res.status}: ${text}`);
    err.code = res.status === 429 ? 'RATE_LIMIT' : 'SERVER_ERROR';
    throw err;
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    const err = new Error('No content in LLM response');
    err.code = 'SERVER_ERROR';
    throw err;
  }
  return content;
}

/**
 * Stream a chat completion, calling onChunk for each piece of text.
 * Uses Server-Sent Events (SSE) parsing compatible with OpenAI format.
 * Aborts if the client disconnects.
 * @param {Array<{role:string, content:string}>} messages
 * @param {(chunk:string)=>void} onChunk
 * @param {object} options
 * @param {AbortSignal} [options.signal] - external abort signal (client disconnect)
 * @returns {Promise<string>}
 */
async function streamChatCompletion(messages, onChunk, options = {}) {
  if (!API_KEY) {
    const err = new Error('API key not configured');
    err.code = 'MISSING_API_KEY';
    throw err;
  }

  const controller = new AbortController();
  const externalSignal = options.signal;
  if (externalSignal) {
    externalSignal.addEventListener('abort', () => controller.abort());
  }

  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 1024,
      stream: true,
    }),
    signal: controller.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`LLM API error ${res.status}: ${text}`);
    err.code = 'SERVER_ERROR';
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') {
        return fullText;
      }
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          onChunk(delta);
        }
      } catch (e) {
        // ignore partial JSON
      }
    }
  }

  return fullText;
}

module.exports = { chatCompletion, streamChatCompletion };