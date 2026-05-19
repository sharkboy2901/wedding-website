'use strict';

const crypto  = require('crypto');
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const session = require('express-session');
const helmet  = require('helmet');

const db                 = require('./db/database');
const { csrfMiddleware } = require('./middleware/csrf');
const adminRouter        = require('./routes/adminRoutes');
const publicRouter       = require('./routes/publicRoutes');

const app  = express();
const PORT = process.env.PORT || 3000;

// -- Trust Railway's reverse proxy so req.ip reflects the real client IP --
app.set('trust proxy', 1);

// -- Security headers --
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'", "'unsafe-inline'"],
      styleSrc:       ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:        ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:         ["'self'", 'data:', 'blob:'],
      frameSrc:       ['https://player.twitch.tv', 'https://www.twitch.tv'],
      connectSrc:     ["'self'"],
      objectSrc:      ["'none'"],
      baseUri:        ["'self'"],
      formAction:     ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));

// -- View engine --
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// -- Body parsing --
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// -- Session --
var sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[Security] SESSION_SECRET env var not set — using a random ephemeral secret. ' +
               'Admin sessions will not survive server restarts. Set SESSION_SECRET in Railway.');
}
app.use(session({
  secret:            sessionSecret,
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   2 * 60 * 60 * 1000,
  },
}));

// -- CSRF protection --
app.use(csrfMiddleware);

// -- Static files --
// Serve approved guest photos (pending dir is NOT public)
app.use('/uploads/approved', express.static(path.join(__dirname, 'uploads', 'approved'), {
  index: false,
  dotfiles: 'deny',
}));

// Site assets (CSS, JS, images)
app.use(express.static(path.join(__dirname, 'public')));

// -- Routes --
app.use('/admin', adminRouter);
app.use('/', publicRouter);

// -- 404 handler --
app.use(function(req, res) {
  res.status(404).render('error', {
    status:  404,
    title:   'Page Not Found',
    message: 'The page you are looking for does not exist.',
    config:  { coupleNames: process.env.COUPLE_NAMES || 'Matthew & Kristine' },
  });
});

// -- Global error handler --
app.use(function(err, req, res, next) {  // eslint-disable-line no-unused-vars
  console.error('[Error]', err.message || err);
  const status = err.status || 500;
  res.status(status).render('error', {
    status:  status,
    title:   status === 404 ? 'Page Not Found' : 'Server Error',
    message: status === 404
      ? 'The page you are looking for does not exist.'
      : 'Something went wrong. Please try again.',
    config: { coupleNames: process.env.COUPLE_NAMES || 'Matthew & Kristine' },
  });
});

// -- Bootstrap & start --
(async function() {
  // Ensure upload directories exist
  ['uploads/pending', 'uploads/approved'].forEach(function(dir) {
    const p = path.join(__dirname, dir);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  });

  // Seed admin account from env vars (idempotent)
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || '';
  if (adminPass) {
    await db.ensureAdminExists(adminUser, adminPass);
  } else {
    console.warn('[Auth] ADMIN_PASSWORD not set -- admin login disabled until configured.');
  }

  app.listen(PORT, function() {
    console.log('[Server] Running on http://localhost:' + PORT);
    console.log('[Server] NODE_ENV = ' + (process.env.NODE_ENV || 'development'));
    console.log('[Server] Admin login: /admin/login');
  });
}());
