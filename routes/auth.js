// Auth routes: signup, login, OAuth (Google/GitHub), me
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const auth = require('../middleware/auth');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;

function appUrl() {
  return String(process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');
}

function oauthConfigured(clientId, clientSecret) {
  return !!(clientId && clientSecret);
}

// ---------------------- OAuth helpers ----------------------

function setOAuthCookie(res, name, value, path) {
  const secure = appUrl().startsWith('https://') ? '; Secure' : '';
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'HttpOnly',
    `Path=${path}`,
    'Max-Age=600',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearOAuthCookie(res, name, path) {
  const secure = appUrl().startsWith('https://') ? '; Secure' : '';
  const parts = [`${name}=`, 'HttpOnly', `Path=${path}`, 'Max-Age=0', 'SameSite=Lax'];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function getCookie(req, name) {
  const header = req.headers.cookie || '';
  const parts = header.split(';');
  for (let i = 0; i < parts.length; i += 1) {
    const idx = parts[i].indexOf('=');
    if (idx === -1) continue;
    if (parts[i].slice(0, idx).trim() === name) {
      return decodeURIComponent(parts[i].slice(idx + 1).trim());
    }
  }
  return null;
}

function randomState() {
  return crypto.randomBytes(16).toString('hex');
}

function redirectWithToken(res, token) {
  res.redirect('/#token=' + encodeURIComponent(token));
}

function redirectAuthError(res) {
  res.redirect('/#auth_error=1');
}

/**
 * Find the user by email, or create a new OAuth account.
 * @returns {Promise<import('mongoose').Document>}
 */
async function findOrCreateOAuthUser(email, provider, providerId) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;

  let user = await User.findOne({ email: normalized });
  if (user) return user;

  return User.create({
    email: normalized,
    provider,
    providerId: providerId ? String(providerId) : null,
  });
}

// ---------------------- Google OAuth ----------------------

router.get('/google', (req, res) => {
  if (!oauthConfigured(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)) {
    return redirectAuthError(res);
  }

  const state = randomState();
  setOAuthCookie(res, 'askgpt_oauth_state_google', state, '/api/auth/google');

  const redirectUri = appUrl() + '/api/auth/google/callback';
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });

  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
});

router.get('/google/callback', async (req, res) => {
  const cookieState = getCookie(req, 'askgpt_oauth_state_google');
  const queryState = req.query.state;
  const code = req.query.code;

  clearOAuthCookie(res, 'askgpt_oauth_state_google', '/api/auth/google');

  if (!cookieState || !queryState || cookieState !== queryState || !code) {
    return redirectAuthError(res);
  }

  try {
    const redirectUri = appUrl() + '/api/auth/google/callback';
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    const tokenData = await tokenRes.json().catch(() => ({}));
    const accessToken = tokenData && tokenData.access_token;
    if (!accessToken) return redirectAuthError(res);

    const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + accessToken },
    });
    const info = await infoRes.json().catch(() => ({}));

    const verified = info.email_verified === true || info.email_verified === 'true';
    if (!info.email || !verified) return redirectAuthError(res);

    const user = await findOrCreateOAuthUser(info.email, 'google', info.sub);
    if (!user) return redirectAuthError(res);

    return redirectWithToken(res, signToken(user));
  } catch (err) {
    console.error('Google OAuth error:', err.message);
    return redirectAuthError(res);
  }
});

// ---------------------- GitHub OAuth ----------------------

router.get('/github', (req, res) => {
  if (!oauthConfigured(GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET)) {
    return redirectAuthError(res);
  }

  const state = randomState();
  setOAuthCookie(res, 'askgpt_oauth_state_github', state, '/api/auth/github');

  const redirectUri = appUrl() + '/api/auth/github/callback';
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'read:user user:email',
    state,
  });

  res.redirect('https://github.com/login/oauth/authorize?' + params.toString());
});

router.get('/github/callback', async (req, res) => {
  const cookieState = getCookie(req, 'askgpt_oauth_state_github');
  const queryState = req.query.state;
  const code = req.query.code;

  clearOAuthCookie(res, 'askgpt_oauth_state_github', '/api/auth/github');

  if (!cookieState || !queryState || cookieState !== queryState || !code) {
    return redirectAuthError(res);
  }

  try {
    const redirectUri = appUrl() + '/api/auth/github/callback';
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = await tokenRes.json().catch(() => ({}));
    const accessToken = tokenData && tokenData.access_token;
    if (!accessToken) return redirectAuthError(res);

    const ghHeaders = {
      Authorization: 'Bearer ' + accessToken,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'AskGPT',
    };

    const userRes = await fetch('https://api.github.com/user', { headers: ghHeaders });
    const ghUser = await userRes.json().catch(() => ({}));
    if (!ghUser || ghUser.id == null) return redirectAuthError(res);

    let email = ghUser.email || null;
    if (!email) {
      const emailsRes = await fetch('https://api.github.com/user/emails', { headers: ghHeaders });
      const emails = await emailsRes.json().catch(() => []);
      if (Array.isArray(emails)) {
        const primary =
          emails.find((e) => e && e.primary && e.verified) ||
          emails.find((e) => e && e.verified);
        if (primary && primary.email) email = primary.email;
      }
    }

    if (!email) return redirectAuthError(res);

    const user = await findOrCreateOAuthUser(email, 'github', ghUser.id);
    if (!user) return redirectAuthError(res);

    return redirectWithToken(res, signToken(user));
  } catch (err) {
    console.error('GitHub OAuth error:', err.message);
    return redirectAuthError(res);
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMIT' },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function signToken(user) {
  return jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
}

function publicUser(user) {
  return { email: user.email };
}

router.post('/signup', authLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'INVALID_EMAIL' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'WEAK_PASSWORD' });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ error: 'EMAIL_EXISTS' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ email, passwordHash });

    return res.status(201).json({
      token: signToken(user),
      user: publicUser(user),
    });
  } catch (err) {
    console.error('Signup error:', err.message);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.post('/login', authLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!EMAIL_RE.test(email) || !password) {
      return res.status(400).json({ error: 'INVALID_INPUT' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    }

    // OAuth-only accounts have no password; reject with the same generic error.
    if (!user.passwordHash) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    }

    return res.json({
      token: signToken(user),
      user: publicUser(user),
    });
  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
    return res.json({ user: publicUser(user) });
  } catch (err) {
    console.error('Me error:', err.message);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

module.exports = router;