// Image generation service using Gemini native endpoint.
// Uses built-in fetch (no axios).

const API_KEY = process.env.API_KEY;
const IMAGE_MODEL = process.env.IMAGE_MODEL || 'gemini-2.5-flash-image';
const REQUEST_MS = 60000;
const RETRYABLE_STATUS = [500, 503, 429];

/**
 * Ordered list of image models to try: IMAGE_MODEL first, then IMAGE_FALLBACKS.
 * Duplicates are removed.
 * @returns {string[]}
 */
function imageModelChain() {
  const fallbacks = String(process.env.IMAGE_FALLBACKS || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  return [IMAGE_MODEL, ...fallbacks].filter(
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
  const err = new Error(`Image API error ${status} (model ${model}): ${text}`);
  err.status = status;
  if (status === 429) err.code = 'RATE_LIMIT';
  else if (status === 400) err.code = 'IMAGE_BLOCKED';
  else err.code = 'IMAGE_UNAVAILABLE';
  return err;
}

/**
 * Build the request body for image generation.
 */
function buildImageBody(prompt) {
  return JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  });
}

/**
 * Run one model attempt for image generation.
 * @returns {Promise<{image: string, text: string}>}
 */
async function imageAttempt(model, prompt) {
  if (!API_KEY) {
    const err = new Error('API key not configured');
    err.code = 'MISSING_API_KEY';
    throw err;
  }

  const controller = new AbortController();
  const requestTimer = setTimeout(() => controller.abort(), REQUEST_MS);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': API_KEY,
          'Content-Type': 'application/json',
        },
        body: buildImageBody(prompt),
        signal: controller.signal,
      }
    );

    clearTimeout(requestTimer);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw httpError(model, res.status, text);
    }

    const data = await res.json();
    const candidates = data?.candidates;
    if (!candidates || !candidates.length) {
      const err = new Error(`No candidates in image response (model ${model})`);
      err.code = 'SERVER_ERROR';
      throw err;
    }

    const parts = candidates[0]?.content?.parts || [];
    let imageData = null;
    let textContent = '';

    for (const part of parts) {
      if (part.inlineData) {
        const mime = part.inlineData.mimeType || 'image/png';
        const b64 = part.inlineData.data;
        if (b64) {
          imageData = `data:${mime};base64,${b64}`;
        }
      } else if (part.text) {
        textContent += part.text;
      }
    }

    if (!imageData) {
      const err = new Error(`No image data in response (model ${model})`);
      err.code = 'IMAGE_UNAVAILABLE';
      throw err;
    }

    return { image: imageData, text: textContent.trim() };
  } catch (err) {
    if (controller.signal.aborted) {
      const timeoutErr = new Error(
        `No response from image model ${model} within ${REQUEST_MS}ms`
      );
      timeoutErr.code = 'FIRST_RESPONSE_TIMEOUT';
      throw timeoutErr;
    }
    throw err;
  } finally {
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
  if (err.code === 'IMAGE_BLOCKED') return false;
  return isRetryableStatus(err.status);
}

/**
 * Final error after every model in the chain failed.
 * @param {Error} lastErr
 * @returns {Error}
 */
function exhaustedError(lastErr) {
  const detail = lastErr && lastErr.message ? ` (${lastErr.message})` : '';
  const err = new Error(`All image models failed${detail}`);
  err.code = 'IMAGE_UNAVAILABLE';
  err.cause = lastErr;
  return err;
}

/**
 * Generate an image from a prompt.
 * @param {string} prompt
 * @returns {Promise<{image: string, text: string}>}
 */
async function generateImage(prompt) {
  const models = imageModelChain();
  let lastErr;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await imageAttempt(model, prompt);
      } catch (err) {
        lastErr = err;
        if (!canFallback(err)) throw err;
        if (attempt === 0) {
          console.warn(
            `[image] model ${model} attempt ${attempt + 1} failed (${
              err.code || err.status
            }); retrying in 1s`
          );
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
      }
    }
    if (i === models.length - 1) break;
    console.warn(
      `[image] model ${model} failed (${lastErr.code || lastErr.status}); trying next model ${models[i + 1]}`
    );
  }

  throw exhaustedError(lastErr);
}

module.exports = { generateImage };