// User model
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: false,
    },
    // OAuth providers this account is linked to ("google", "github", or unset for email/password).
    provider: {
      type: String,
      default: null,
    },
    // Provider-specific user id (e.g. Google `sub`, GitHub user id).
    providerId: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);