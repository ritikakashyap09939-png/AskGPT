// Chat route: POST /api/chat
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const llm = require('../services/llm');
const SYSTEM_PROMPT = require('../config/systemPrompt');
const auth = require('../middleware/auth');

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
router.post('/chat', auth, chatLimiter, async (req, res) => {
  try {
    const { messages, inputMode, stream } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
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
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      const controller = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded) controller.abort();
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
        console.error('Stream error:', err.message);
        if (controller.signal.aborted) {
          // Client disconnected; do not write anything
          return;
        }
        res.write(`data: ${JSON.stringify({ error: err.code || 'SERVER_ERROR' })}\n\n`);
        res.end();
      }
    } else {
      const reply = await llm.chatCompletion(fullMessages);
      res.json({ reply });
    }
  } catch (err) {
    console.error('Chat route error:', err.message);
    res.status(500).json({ error: err.code || 'SERVER_ERROR' });
  }
});

module.exports = router;