// LLM service abstraction using Node.js built-in fetch (no axios).
// Supports OpenAI-compatible chat completions with optional streaming (SSE).
// To switch providers, change API_BASE and MODEL_NAME in .env.
// If the primary model is unavailable, the next model in MODEL_FALLBACKS is used.

const API_KEY = process.env.API_KEY;
const MODEL_NAME = process.env.MODEL_NAME || 'gpt-4o-mini';
const API_BASE = (process.env.API_BASE || 'https://api.openai.com/v1').replace(/\/+$/, '');

// Retry with the next model if no response arrives within this time.
const FIRST_RESPONSE_MS = 20000;
// Hard cap for a single request once it has started responding.
const REQUEST_MS = 120000;
// Statuses that mean the provider (not the request) failed.
const RETRYABLE_STATUS = [500, 503, 429];

/**
 * Ordered list of models to try: MODEL_NAME first, then MODEL_FALLBACKS.
 * Duplicates are removed.
 * @returns {string[]}
 */
function modelChain() {
  const fallbacks = String(process.env.MODEL_FALLBACKS || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  return [MODEL_NAME, ...fallbacks].filter(
    (name, index, all) => all.indexOf(name) === index
  );
}

/**
 * @param {number} status
 * @returns {boolean}
 */
function isRetryableStatus(status) {
  return RETRYABLE_STATUS.indexOf(status) !== -1;
}

/**
 * @param {string} model
 * @param {number} status
 * @param {string} text
 * @returns {Error}
 */
function httpError(model, status, text) {
  const err = new Error(`LLM API error ${status} (model ${model}): ${text}`);
  err.status = status;
  err.code = status === 429 ? 'RATE_LIMIT' : 'SERVER_ERROR';
  return err;
}

/**
 * Build the request body for a chat completion.
 */
function buildBody(model, messages, options, stream) {
  return JSON.stringify({
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 1024,
    ...(stream ? { stream: true } : {}),
  });
}

/**
 * Run one model attempt for a non-streaming completion.
 * @returns {Promise<string>}
 */
async function completionAttempt(model, messages, options) {
  if (!API_KEY) {
    const err = new Error('API key not configured');
    err.code = 'MISSING_API_KEY';
    throw err;
  }

  const controller = new AbortController();
  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener('abort', () => controller.abort());
    }
  }

  let firstResponse = false;
  const requestTimer = setTimeout(() => controller.abort(), REQUEST_MS);
  const firstTimer = setTimeout(() => controller.abort(), FIRST_RESPONSE_MS);

  try {
    const res = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: buildBody(model, messages, options, false),
      signal: controller.signal,
    });

    // Headers arrived: a response exists, so the 20s first-response limit no longer applies.
    firstResponse = true;
    clearTimeout(firstTimer);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw httpError(model, res.status, text);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      const err = new Error(`No content in LLM response (model ${model})`);
      err.code = 'SERVER_ERROR';
      throw err;
    }
    return content;
  } catch (err) {
    if (options.signal && options.signal.aborted) {
      // Client disconnected: do not try another model.
      err.noFallback = true;
      throw err;
    }
    if (!firstResponse && controller.signal.aborted) {
      const timeoutErr = new Error(
        `No response from model ${model} within ${FIRST_RESPONSE_MS}ms`
      );
      timeoutErr.code = 'FIRST_RESPONSE_TIMEOUT';
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(firstTimer);
    clearTimeout(requestTimer);
  }
}

/**
 * Run one model attempt for a streaming completion.
 * @param {(chunk:string)=>void} onChunk
 * @returns {Promise<string>}
 */
async function streamAttempt(model, messages, onChunk, options) {
  if (!API_KEY) {
    const err = new Error('API key not configured');
    err.code = 'MISSING_API_KEY';
    throw err;
  }

  const controller = new AbortController();
  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener('abort', () => controller.abort());
    }
  }

  let emitted = false;
  let firstChunk = false;
  const requestTimer = setTimeout(() => controller.abort(), REQUEST_MS);
  const firstTimer = setTimeout(() => controller.abort(), FIRST_RESPONSE_MS);

  try {
    const res = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: buildBody(model, messages, options, true),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw httpError(model, res.status, text);
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
            if (!firstChunk) {
              firstChunk = true;
              clearTimeout(firstTimer);
            }
            emitted = true;
            fullText += delta;
            onChunk(delta);
          }
        } catch (e) {
          // ignore partial JSON
        }
      }
    }

    return fullText;
  } catch (err) {
    if (emitted) {
      // Some text already reached the user: never retry with another model.
      err.noFallback = true;
    }
    if (options.signal && options.signal.aborted) {
      // Client disconnected: do not try another model.
      err.noFallback = true;
      throw err;
    }
    if (!firstChunk && !emitted && controller.signal.aborted) {
      const timeoutErr = new Error(
        `No response from model ${model} within ${FIRST_RESPONSE_MS}ms`
      );
      timeoutErr.code = 'FIRST_RESPONSE_TIMEOUT';
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(firstTimer);
    clearTimeout(requestTimer);
  }
}

/**
 * Decide whether a failed attempt may be retried with the next model.
 * @param {Error} err
 * @returns {boolean}
 */
function canFallback(err) {
  if (!err) return false;
  if (err.noFallback) return false;
  if (err.code === 'MISSING_API_KEY') return false;
  if (err.code === 'FIRST_RESPONSE_TIMEOUT') return true;
  return isRetryableStatus(err.status);
}

/**
 * Final error after every model in the chain failed.
 * @param {Error} lastErr
 * @returns {Error}
 */
function exhaustedError(lastErr) {
  const detail = lastErr && lastErr.message ? ` (${lastErr.message})` : '';
  const err = new Error(`All models failed${detail}`);
  err.code = 'SERVER_ERROR';
  err.cause = lastErr;
  return err;
}

/**
 * Send a chat completion request (non-streaming).
 * @param {Array<{role:string, content:string}>} messages
 * @param {object} options
 * @returns {Promise<string>}
 */
async function chatCompletion(messages, options = {}) {
  const models = modelChain();
  let lastErr;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await completionAttempt(model, messages, options);
      } catch (err) {
        lastErr = err;
        if (!canFallback(err)) throw err;
        if (attempt === 0) {
          console.warn(`[llm] model ${model} attempt ${attempt + 1} failed (${err.code || err.status}); retrying in 1s`);
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
      }
    }
    if (i === models.length - 1) break;
    console.warn(
      `[llm] model ${model} failed (${lastErr.code || lastErr.status}); trying next model ${models[i + 1]}`
    );
  }

  throw exhaustedError(lastErr);
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
  const models = modelChain();
  let lastErr;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await streamAttempt(model, messages, onChunk, options);
      } catch (err) {
        lastErr = err;
        if (!canFallback(err)) throw err;
        if (attempt === 0) {
          console.warn(`[llm] model ${model} attempt ${attempt + 1} failed (${err.code || err.status}); retrying in 1s`);
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
      }
    }
    if (i === models.length - 1) break;
    console.warn(
      `[llm] model ${model} failed (${lastErr.code || lastErr.status}); trying next model ${models[i + 1]}`
    );
  }

  throw exhaustedError(lastErr);
}

module.exports = { chatCompletion, streamChatCompletion };