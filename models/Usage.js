// Usage tracking model for daily limits
const mongoose = require('mongoose');

const usageSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      index: true,
    },
    date: {
      type: String,
      required: true,
    },
    chatCount: {
      type: Number,
      default: 0,
    },
    imageCount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: false }
);

// Unique index on key + date for atomic upserts
usageSchema.index({ key: 1, date: 1 }, { unique: true });

// TTL index: delete documents after 3 days (259200 seconds)
// Note: date field is a string, so we use createdAt from the document
// We'll use a separate TTL index on createdAt
usageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 259200 });

module.exports = mongoose.model('Usage', usageSchema);