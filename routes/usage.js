// Usage route: GET /api/usage
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { getUsageHandler } = require('../middleware/usageLimit');

// Guest mode when no database is configured: skip JWT auth for /api/usage
const AUTH_ENABLED = !!process.env.MONGODB_URI;

function maybeAuth(req, res, next) {
  if (!AUTH_ENABLED) return next();
  return auth(req, res, next);
}

/**
 * GET /api/usage
 * Returns: { chatUsed, chatLimit, imageUsed, imageLimit, resetAt }
 */
router.get('/usage', maybeAuth, getUsageHandler);

module.exports = router;