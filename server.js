// AskGPT - Multilingual AI Chatbot with Voice Chat
// Main server entry point

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const mongoose = require('mongoose');

const chatRouter = require('./routes/chat');
const authRouter = require('./routes/auth');
const chatsRouter = require('./routes/chats');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Render's proxy so rate limiting sees the real client IP
app.set('trust proxy', 1);

// Security headers (CSP allows the CDN scripts/styles/fonts used by index.html)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
        styleSrc: [
          "'self'",
          'https://fonts.googleapis.com',
          'https://cdnjs.cloudflare.com',
          "'unsafe-inline'",
        ],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// CORS: restrict to ALLOWED_ORIGIN, otherwise same-origin only
const allowedOrigin = process.env.ALLOWED_ORIGIN;
app.use(cors(allowedOrigin ? { origin: allowedOrigin } : { origin: false }));

app.use(express.json({ limit: '10mb' }));
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
app.use('/api/auth', authRouter);
app.use('/api/chats', chatsRouter);
app.use('/api', chatRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', model: process.env.MODEL_NAME || 'gpt-4o-mini' });
});

// Runtime config for the frontend (guest mode when no database)
app.get('/api/config', (req, res) => {
  res.json({ authEnabled: !!process.env.MONGODB_URI });
});

// Catch-all: serve index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`AskGPT server running on http://localhost:${PORT}`);
  console.log(`Model: ${process.env.MODEL_NAME || 'gpt-4o-mini'}`);
});

if (process.env.MONGODB_URI) {
  mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => console.log('MongoDB connected'))
    .catch((err) => console.error('MongoDB connection error:', err.message));
} else {
  console.warn('MONGODB_URI not set; running in guest mode (no login required, chats use localStorage).');
}