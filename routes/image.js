// Image generation route: POST /api/image
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const imageService = require('../services/image');
const auth = require('../middleware/auth');

// Guest mode when no database is configured: skip JWT auth for /api/image
const AUTH_ENABLED = !!process.env.MONGODB_URI;

function maybeAuth(req, res, next) {
  if (!AUTH_ENABLED) return next();
  return auth(req, res, next);
}

function logFailure(context, err, status) {
  const code = status || (err && (err.status || err.statusCode)) || 500;
  const message = err && err.message ? err.message : err;
  // Never log base64 data
  console.error(`[${context}] status=${code} message=${message}`);
}

// Safety keywords for harmful/illegal/sexual content
const SAFETY_KEYWORDS = [
  // Sexual content
  'porn', 'pornographic', 'xxx', 'sex', 'nude', 'naked', 'erotic', 'adult content',
  'sexual', 'genital', 'penis', 'vagina', 'breast', 'nipple', 'orgasm', 'masturbat',
  // Violence/gore
  'gore', 'blood', 'violent', 'murder', 'kill', 'suicide', 'self-harm', 'self harm',
  'torture', 'mutilat', 'decapitat', 'dismember',
  // Illegal activities
  'drug', 'cocaine', 'heroin', 'meth', 'lsd', 'ecstasy', 'weed', 'marijuana',
  'bomb', 'explosive', 'weapon', 'gun', 'rifle', 'knife', 'illegal',
  // Hate/harassment
  'nazi', 'hitler', 'kkk', 'white supremacist', 'hate speech',
  // Child safety
  'child porn', 'child sexual', 'minor', 'underage',
];

function checkSafety(prompt) {
  const lower = prompt.toLowerCase();
  for (const kw of SAFETY_KEYWORDS) {
    if (lower.includes(kw)) {
      return true;
    }
  }
  return false;
}

// Dedicated rate limiter for /api/image: 5 requests per minute per IP
const imageLimiter = rateLimit({
  windowMs: 60000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMIT' },
});

/**
 * POST /api/image
 * Body: { prompt }
 * Returns: { image: "data:<mime>;base64,<data>", text }
 */
router.post('/image', maybeAuth, imageLimiter, async (req, res) => {
  try {
    const { prompt } = req.body;

    if (typeof prompt !== 'string' || !prompt.trim()) {
      logFailure('image', new Error('INVALID_INPUT'), 400);
      return res.status(400).json({ error: 'INVALID_INPUT' });
    }

    const trimmed = prompt.trim();
    if (trimmed.length > 1000) {
      logFailure('image', new Error('PROMPT_TOO_LONG'), 400);
      return res.status(400).json({ error: 'PROMPT_TOO_LONG' });
    }

    // Safety check
    if (checkSafety(trimmed)) {
      logFailure('image', new Error('IMAGE_BLOCKED'), 400);
      return res.status(400).json({ error: 'IMAGE_BLOCKED' });
    }

    const result = await imageService.generateImage(trimmed);
    res.json(result);
  } catch (err) {
    logFailure('image', err);
    const code = err.code || 'SERVER_ERROR';
    if (code === 'RATE_LIMIT' || code === 'IMAGE_UNAVAILABLE' || code === 'IMAGE_BLOCKED' || code === 'MISSING_API_KEY' || code === 'INVALID_INPUT' || code === 'PROMPT_TOO_LONG') {
      return res.status(500).json({ error: code });
    }
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

module.exports = router;