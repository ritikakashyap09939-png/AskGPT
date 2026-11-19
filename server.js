// AskGPT - Multilingual AI Chatbot with Voice Chat
// Main server entry point

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const chatRouter = require('./routes/chat');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Global rate limiter
const globalLimiter = rateLimit({
  windowMs: 60000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'SERVER_ERROR' },
});
app.use(globalLimiter);

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// API routes - mount at /api so POST /api/chat works
app.use('/api', chatRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', model: process.env.MODEL_NAME || 'gpt-4o-mini' });
});

// Catch-all: serve index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`AskGPT server running on http://localhost:${PORT}`);
  console.log(`Model: ${process.env.MODEL_NAME || 'gpt-4o-mini'}`);
});