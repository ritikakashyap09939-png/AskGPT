// Chat route: POST /api/chat
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const llm = require('../services/llm');
const SYSTEM_PROMPT = require('../config/systemPrompt');
const auth = require('../middleware/auth');

// Guest mode when no database is configured: skip JWT auth for /api/chat
const AUTH_ENABLED = !!process.env.MONGODB_URI;

function maybeAuth(req, res, next) {
  if (!AUTH_ENABLED) return next();
  return auth(req, res, next);
}

function logFailure(context, err, status) {
  const code = status || (err && (err.status || err.statusCode)) || 500;
  const message = err && err.message ? err.message : err;
  console.error(`[${context}] status=${code} message=${message}`);
}

// Dedicated rate limiter for /api/chat: 20 requests per minute per IP
const chatLimiter = rateLimit({
  windowMs: 60000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMIT' },
});

/**
 * POST /api/chat
 * Body: { messages: [{role, content}], inputMode: "text"|"voice", stream?: boolean }
 * Returns: { reply } or streaming text/event-stream
 */
router.post('/chat', maybeAuth, chatLimiter, async (req, res) => {
  try {
    const { messages, inputMode, stream } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      logFailure('chat', new Error('INVALID_INPUT'), 400);
      return res.status(400).json({ error: 'INVALID_INPUT' });
    }

// Validate each message
const MAX_LENGTH = 4000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function isValidContent(content) {
  if (typeof content === 'string') {
    return content.length <= MAX_LENGTH;
  }

  if (Array.isArray(content)) {
    if (content.length === 0) return false;

    return content.every((part) => {
      if (!part || typeof part !== 'object') return false;

      if (part.type === 'text') {
        return typeof part.text === 'string' && part.text.length <= MAX_LENGTH;
      }

      if (part.type === 'image_url') {
        const url = part.image_url && part.image_url.url;
        if (typeof url !== 'string') return false;

        const match = url.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
        if (!match) return false;
        if (ALLOWED_IMAGE_TYPES.indexOf(match[1]) === -1) return false;

        const bytes = Math.floor((match[2].length * 3) / 4);
        return bytes > 0 && bytes <= MAX_IMAGE_BYTES;
      }

      return false;
    });
  }

  return false;
}

for (const m of messages) {
  if (!m || typeof m !== 'object' || !isValidContent(m.content)) {
    logFailure('chat', new Error('INVALID_INPUT'), 400);
    return res.status(400).json({ error: 'INVALID_INPUT' });
  }
}

    // Build the full message list with system prompt first
    const fullMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages.slice(-15),
    ];

    if (stream) {
      // Server-Sent Events streaming
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      // Flush the headers immediately so proxies don't buffer the response
      res.flushHeaders();
      res.write(': ping\n\n');

      const controller = new AbortController();

      // Keep the connection alive while waiting for the first token
      const ping = setInterval(() => {
        if (!res.writableEnded) {
          try {
            res.write(': ping\n\n');
          } catch (err) {
            /* ignore write errors */
          }
        }
      }, 15000);

      res.on('close', () => {
        console.log(
          `[SSE] res 'close' event; writableEnded=${res.writableEnded}, destroyed=${res.destroyed}`
        );
        if (!res.writableEnded) {
          console.log('[SSE] client closed connection before completion; aborting upstream request');
          controller.abort();
        }
      });

      let fullReply = '';
      try {
        await llm.streamChatCompletion(
          fullMessages,
          (chunk) => {
            fullReply += chunk;
            res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
          },
          {
            signal: controller.signal,
          }
        );
        res.write(`data: ${JSON.stringify({ done: true, reply: fullReply })}\n\n`);
        res.end();
      } catch (err) {
        logFailure('stream', err);
        if (controller.signal.aborted) {
          console.log('[SSE] upstream request was aborted because the client disconnected');
          return;
        }
        res.write(`data: ${JSON.stringify({ error: err.code || 'SERVER_ERROR' })}\n\n`);
        res.end();
      } finally {
        clearInterval(ping);
      }
    } else {
      const reply = await llm.chatCompletion(fullMessages);
      res.json({ reply });
    }
  } catch (err) {
    logFailure('chat', err, 500);
    res.status(500).json({ error: err.code || 'SERVER_ERROR' });
  }
});

module.exports = router;