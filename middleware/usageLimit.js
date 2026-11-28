// Usage limit middleware
// Checks and atomically increments daily usage counters
const mongoose = require('mongoose');

const DAILY_CHAT_LIMIT = parseInt(process.env.DAILY_CHAT_LIMIT || '40', 10);
const DAILY_IMAGE_LIMIT = parseInt(process.env.DAILY_IMAGE_LIMIT || '5', 10);
const GUEST_DAILY_LIMIT = parseInt(process.env.GUEST_DAILY_LIMIT || '15', 10);

// In-memory store for guest mode (no MongoDB)
const guestUsageMap = new Map();

function getUtcDate() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getNextMidnightISO() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCHours(24, 0, 0, 0);
  return tomorrow.toISOString();
}

function getClientKey(req) {
  // If authenticated, use userId
  if (req.userId) {
    return `user:${req.userId}`;
  }
  // Otherwise use IP
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  return `ip:${ip}`;
}

function getLimits(req) {
  const isGuest = !req.userId;
  if (isGuest) {
    return {
      chatLimit: GUEST_DAILY_LIMIT,
      imageLimit: GUEST_DAILY_LIMIT,
    };
  }
  return {
    chatLimit: DAILY_CHAT_LIMIT,
    imageLimit: DAILY_IMAGE_LIMIT,
  };
}

async function checkAndIncrementMongo(key, date, type) {
  const Usage = mongoose.model('Usage');
  const field = type === 'chat' ? 'chatCount' : 'imageCount';

  const doc = await Usage.findOneAndUpdate(
    { key, date },
    { $inc: { [field]: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return {
    used: doc[field],
    limit: type === 'chat' ? DAILY_CHAT_LIMIT : DAILY_IMAGE_LIMIT,
  };
}

async function decrementMongo(key, date, type) {
  const Usage = mongoose.model('Usage');
  const field = type === 'chat' ? 'chatCount' : 'imageCount';

  await Usage.findOneAndUpdate(
    { key, date },
    { $inc: { [field]: -1 } }
  );
}

function checkAndIncrementMemory(key, date, type) {
  const mapKey = `${key}:${date}`;
  let entry = guestUsageMap.get(mapKey);
  if (!entry) {
    entry = { chatCount: 0, imageCount: 0 };
    guestUsageMap.set(mapKey, entry);
  }

  const field = type === 'chat' ? 'chatCount' : 'imageCount';
  entry[field] += 1;

  return {
    used: entry[field],
    limit: type === 'chat' ? GUEST_DAILY_LIMIT : GUEST_DAILY_LIMIT,
  };
}

function decrementMemory(key, date, type) {
  const mapKey = `${key}:${date}`;
  const entry = guestUsageMap.get(mapKey);
  if (entry) {
    const field = type === 'chat' ? 'chatCount' : 'imageCount';
    entry[field] = Math.max(0, entry[field] - 1);
  }
}

async function getUsageMongo(key, date) {
  const Usage = mongoose.model('Usage');
  const doc = await Usage.findOne({ key, date }).lean();
  if (!doc) {
    return { chatUsed: 0, imageUsed: 0 };
  }
  return { chatUsed: doc.chatCount || 0, imageUsed: doc.imageCount || 0 };
}

function getUsageMemory(key, date) {
  const mapKey = `${key}:${date}`;
  const entry = guestUsageMap.get(mapKey);
  if (!entry) {
    return { chatUsed: 0, imageUsed: 0 };
  }
  return { chatUsed: entry.chatCount || 0, imageUsed: entry.imageCount || 0 };
}

// Middleware factory: type is 'chat' or 'image'
function usageLimit(type) {
  return async (req, res, next) => {
    try {
      const key = getClientKey(req);
      const date = getUtcDate();
      const limits = getLimits(req);
      const limit = type === 'chat' ? limits.chatLimit : limits.imageLimit;

      let result;
      if (mongoose.connection.readyState === 1) {
        result = await checkAndIncrementMongo(key, date, type);
      } else {
        result = checkAndIncrementMemory(key, date, type);
      }

      // Store for potential refund on provider error
      req.usageKey = key;
      req.usageDate = date;
      req.usageType = type;

      if (result.used > result.limit) {
        // Refund the increment since we're rejecting
        if (mongoose.connection.readyState === 1) {
          await decrementMongo(key, date, type);
        } else {
          decrementMemory(key, date, type);
        }

        const resetAt = getNextMidnightISO();
        return res.status(429).json({
          error: 'DAILY_LIMIT',
          resetAt,
          limit: result.limit,
          used: result.used - 1,
        });
      }

      // Attach usage info to response headers
      res.set('X-Usage-Limit', String(result.limit));
      res.set('X-Usage-Remaining', String(Math.max(0, result.limit - result.used)));
      res.set('X-Usage-Reset', getNextMidnightISO());

      next();
    } catch (err) {
      console.error('[usageLimit] error:', err.message);
      // On middleware error, allow request to proceed (fail-open)
      next();
    }
  };
}

// GET /api/usage handler
async function getUsageHandler(req, res) {
  try {
    const key = getClientKey(req);
    const date = getUtcDate();
    const limits = getLimits(req);

    let usage;
    if (mongoose.connection.readyState === 1) {
      usage = await getUsageMongo(key, date);
    } else {
      usage = getUsageMemory(key, date);
    }

    res.json({
      chatUsed: usage.chatUsed,
      chatLimit: limits.chatLimit,
      imageUsed: usage.imageUsed,
      imageLimit: limits.imageLimit,
      resetAt: getNextMidnightISO(),
    });
  } catch (err) {
    console.error('[getUsageHandler] error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
}

// Refund usage (call when provider returns error)
async function refundUsage(req) {
  if (!req.usageKey || !req.usageDate || !req.usageType) return;

  if (mongoose.connection.readyState === 1) {
    await decrementMongo(req.usageKey, req.usageDate, req.usageType);
  } else {
    decrementMemory(req.usageKey, req.usageDate, req.usageType);
  }
}

module.exports = {
  usageLimit,
  getUsageHandler,
  refundUsage,
  DAILY_CHAT_LIMIT,
  DAILY_IMAGE_LIMIT,
  GUEST_DAILY_LIMIT,
};