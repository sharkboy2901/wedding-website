'use strict';

require('dotenv').config();

const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const helmet    = require('helmet');
const session   = require('express-session');
const FileStore = require('session-file-store')(session);
const rateLimit = require('express-rate-limit');
const db        = require('./db/database');

const publicRoutes = require('./routes/publicRoutes');
const adminRoutes  = require('./routes/adminRoutes');
const { csrfMiddleware } = require('./middleware/csrf');

const app  = express();
const PORT = process.env.PORT || 3000;

// Trust proxy -- needed for accurate rate limiting behind Nginx/Cloudflare
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Security headers (Helmet)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:       ["'self'"],
      scriptSrc:        ["'self'"],
      styleSrc:         ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:          ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:           ["'self'", 'data:'],
      connectSrc:       ["'self'"],
      objectSrc:        ["'none'"],
      frameAncestors:   ["'none'"],
      baseUri:          ["'self'"],
      formAction:       ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
  frameguard: { action: 'deny' },
}));

// Rate limiting -- global
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests. Please try again later.',
}));

// Rate limiting -- uploads (stricter: 20 per hour)
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'Upload limit reached. Please try again in an hour.',
});
app.use('/upload', uploadLimiter);

// Rate limiting -- admin login (strict: 10 per 15 min)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts. Please try again in 15 minutes.',
});
app.use('/admin/login', loginLimiter);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Body parsing
app.use(express.urlencoded({ extended: false, limit: '50kb' }));
app.use(express.json({ limit: '50kb' }));

// -- Session --

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.startsWith('CHANGE_ME')) {
  console.warn('[Security] WARNING: SESSION_SECRET is not set or is using the default value.');
  console.warn('[Security] Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
}

const sessionsDir = path.join(__dirname, 'data', 'sessions');
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}

app.use(session({
  store: new FileStore({
    path:         sessionsDir,
    ttl:          8 * 60 * 60,
    retries:      1,
    reapInterval: 60 * 60,
    logFn:        function() {},
  }),
  secret:            SESSION_SECRET || 'dev-insecure-fallback-change-me',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   8 * 60 * 60 * 1000,
  },
  name: 'weddingSid',
}));

// Static files -- public assets
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true,
}));

// Approved photos -- publicly accessible via UUID filenames
app.use('/uploads/approved', express.static(path.join(__dirname, 'uploads', 'approved'), {
  maxAge: '7d',
  setHeaders: function(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  },
}));

// Pending uploads are NOT served statically -- admin only via /admin/photo/:id/image

// CSRF protection
app.use(csrfMiddleware);

// Prevent search-engine indexing
app.use(function(req, res, next) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});

// Routes
app.use('/', publicRoutes);
app.use('/admin', adminRoutes);

// 404 handler
app.use(function(req, res) {
  res.status(404).render('error', {
    status: 404,
    title: 'Page Not Found',
    message: "The page you are looking for does not exist.",
    config: { coupleNames: process.env.COUPLE_NAMES || 'Matthew & Partner' },
  });
});

// Global error handler
app.use(function(err, req, res, next) {
  console.error('[Server Error]', err);
  res.status(500).render('error', {
    status: 500,
    title: 'Something Went Wrong',
    message: 'An unexpected error occurred. Please try again.',
    config: { coupleNames: process.env.COUPLE_NAMES || 'Matthew & Partner' },
  });
});

// Start server
db.ensureAdminExists(
  process.env.ADMIN_USERNAME || 'admin',
  process.env.ADMIN_PASSWORD || 'change-me-in-env'
).then(function() {
  app.listen(PORT, function() {
    console.log('[Server] Running on http://localhost:' + PORT);
    console.log('[Server] NODE_ENV = ' + (process.env.NODE_ENV || 'development'));
  });
}).catch(function(err) {
  console.error('[Startup] Failed to initialise admin account:', err);
  process.exit(1);
});
