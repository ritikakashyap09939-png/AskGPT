// Chat route: POST /api/chat
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const llm = require('../services/llm');
const SYSTEM_PROMPT = require('../config/systemPrompt');

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
router.post('/chat', chatLimiter, async (req, res) => {
  try {
    const { messages, inputMode, stream } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'INVALID_INPUT' });
    }

    // Validate each message
    const MAX_LENGTH = 4000;
    for (const m of messages) {
      if (typeof m.content !== 'string' || m.content.length > MAX_LENGTH) {
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