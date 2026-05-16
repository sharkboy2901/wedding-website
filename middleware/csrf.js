'use strict';

/**
 * Lightweight session-based CSRF protection.
 *
 * How it works:
 *  1. On every request, a random token is generated and stored in the session
 *     (if one doesn't exist yet). It is exposed to EJS templates via
 *     res.locals.csrfToken so forms can embed it as a hidden field.
 *  2. On state-changing requests (POST/PUT/PATCH/DELETE) the submitted token
 *     (from req.body._csrf) is compared to the session token using a
 *     timing-safe comparison. Mismatch → 403.
 *  3. Multipart/form-data requests (file uploads) are NOT validated here
 *     because multer hasn't parsed the body yet at middleware time.
 *     Those routes call validateCsrfFromBody() manually after multer runs.
 */

const crypto = require('crypto');

const SESSION_KEY  = '_csrfToken';
const FIELD_NAME   = '_csrf';
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateToken(session) {
  if (!session[SESSION_KEY]) {
    session[SESSION_KEY] = crypto.randomBytes(32).toString('hex');
  }
  return session[SESSION_KEY];
}

/**
 * Timing-safe comparison of the session token vs a submitted token.
 * Returns false (rather than throwing) on any length mismatch or bad input.
 */
function tokensMatch(sessionToken, submittedToken) {
  if (
    typeof sessionToken  !== 'string' || sessionToken.length  === 0 ||
    typeof submittedToken !== 'string' || submittedToken.length === 0
  ) return false;

  // Pad the shorter string so timingSafeEqual doesn't throw on length mismatch
  const len = Math.max(sessionToken.length, submittedToken.length);
  const a = Buffer.alloc(len, 0);
  const b = Buffer.alloc(len, 0);
  Buffer.from(sessionToken).copy(a);
  Buffer.from(submittedToken).copy(b);
  return crypto.timingSafeEqual(a, b) && sessionToken.length === submittedToken.length;
}

function csrfError(res) {
  return res.status(403).render('error', {
    status:  403,
    title:   'Forbidden',
    message: 'Invalid or missing security token. Please go back and try again.',
    config:  { coupleNames: process.env.COUPLE_NAMES || 'Matthew & [Partner Name]' },
  });
}

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * Main CSRF middleware. Attach after body-parsing middleware.
 * Skips multipart/form-data (handled per-route via validateCsrfFromBody).
 */
function csrfMiddleware(req, res, next) {
  // Expose token to all EJS templates
  res.locals.csrfToken = generateToken(req.session);

  if (!STATE_CHANGING.has(req.method)) return next();

  // Multer hasn't run yet for file uploads — skip here, checked in route
  const contentType = (req.headers['content-type'] || '').toLowerCase();
  if (contentType.includes('multipart/form-data')) return next();

  const sessionToken   = req.session[SESSION_KEY];
  const submittedToken = req.body[FIELD_NAME] || req.headers['x-csrf-token'];

  if (!tokensMatch(sessionToken, submittedToken)) {
    return csrfError(res);
  }

  next();
}

/**
 * Call this inside a route handler AFTER multer (or any multipart parser)
 * has populated req.body. Returns true if valid, false if not.
 *
 * Usage:
 *   uploadMiddleware(req, res, async (err) => {
 *     if (!validateCsrfFromBody(req)) { return res.status(403)... }
 *     ...
 *   });
 */
function validateCsrfFromBody(req) {
  const sessionToken   = req.session[SESSION_KEY];
  const submittedToken = req.body[FIELD_NAME];
  return tokensMatch(sessionToken, submittedToken);
}

module.exports = { csrfMiddleware, validateCsrfFromBody };
