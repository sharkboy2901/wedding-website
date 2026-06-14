'use strict';

const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const bcrypt     = require('bcryptjs');
const multer     = require('multer');
const rateLimit  = require('express-rate-limit');
const router     = express.Router();

const archiver  = require('archiver');

const db                = require('../db/database');
const { requireAdmin, redirectIfLoggedIn } = require('../middleware/auth');
const { validateCsrfFromBody } = require('../middleware/csrf');

const DATA_DIR   = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const IMAGES_DIR = path.join(__dirname, '..', 'public', 'images');

// Magic byte detection for site images (JPEG, PNG, WebP, GIF)
function detectSiteImageMime(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
      buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A) return 'image/png';
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'image/webp';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38 &&
      (buffer[4] === 0x37 || buffer[4] === 0x39) && buffer[5] === 0x61) return 'image/gif';
  return null;
}

// Multer for site images — memory storage so we can validate bytes before writing
const siteImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: function(req, file, cb) {
    var allowedMime = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    var allowedExt  = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    var ext = path.extname(file.originalname).toLowerCase();
    if (allowedMime.includes(file.mimetype) && allowedExt.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_TYPE'));
    }
  },
});

// Rate limiter for admin login: 10 attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs:              15 * 60 * 1000,
  max:                   10,
  standardHeaders:       true,
  legacyHeaders:         false,
  skipSuccessfulRequests: true,
  handler: function(req, res) {
    req.session.flash = { type: 'error', message: 'Too many login attempts. Please wait 15 minutes before trying again.' };
    res.redirect('/admin/login');
  },
});

const PENDING_DIR      = path.join(DATA_DIR, 'uploads', 'pending');
const APPROVED_DIR     = path.join(DATA_DIR, 'uploads', 'approved');
const NOT_APPROVED_DIR = path.join(DATA_DIR, 'uploads', 'not-approved');

// Prevent caching of admin pages
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  next();
});

// Safe redirect helper
function isSafeRedirect(url) {
  if (!url || typeof url !== 'string') return false;
  return /^\/(?!\/|\\)/.test(url);
}

// Async wrapper
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Dual-response helpers: JSON for fetch requests, redirect for normal form posts
function ajaxOk(req, res, message) {
  if (req.accepts('json') && req.headers['x-requested-with'] === 'xmlhttprequest') {
    return res.json({ ok: true, message: message || '' });
  }
  if (message) req.session.flash = { type: 'success', message };
  return res.redirect('/admin/dashboard');
}
function ajaxErr(req, res, httpStatus, message) {
  if (req.accepts('json') && req.headers['x-requested-with'] === 'xmlhttprequest') {
    return res.status(httpStatus || 400).json({ ok: false, message });
  }
  req.session.flash = { type: 'error', message };
  return res.redirect('/admin/dashboard');
}

// Allowed MIME types
const ALLOWED_SERVE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// UUID v4 filename pattern
const SAFE_FILENAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/i;

// Safe file-serve helper
function safeServeFile(res, dir, photo) {
  if (!SAFE_FILENAME_RE.test(photo.filename)) {
    console.warn('[Admin] Suspicious filename blocked:', photo.filename);
    return res.status(403).send('Forbidden');
  }
  if (!ALLOWED_SERVE_TYPES.has(photo.mime_type)) {
    return res.status(403).send('Forbidden');
  }
  const filePath = path.join(dir, photo.filename);
  if (!filePath.startsWith(dir + path.sep) && filePath !== dir) {
    return res.status(403).send('Forbidden');
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File not found on disk');
  }
  res.setHeader('Content-Type', photo.mime_type);
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(filePath);
}

// Safe file-move helper — preserves the image instead of deleting it.
// Used when a photo is declined or removed: the file is moved to the
// not-approved folder so it can still be downloaded later. Returns true on
// a successful move, false if the source is missing or the name is unsafe.
function safeMoveFile(srcDir, destDir, filename) {
  if (!SAFE_FILENAME_RE.test(filename)) return false;
  const src  = path.join(srcDir, filename);
  const dest = path.join(destDir, filename);
  if (!src.startsWith(srcDir + path.sep))   return false;
  if (!dest.startsWith(destDir + path.sep)) return false;
  if (!fs.existsSync(src)) return false;
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  fs.renameSync(src, dest);
  return true;
}

// Does a not-approved photo's file still exist on disk?
function notApprovedFileExists(filename) {
  if (!SAFE_FILENAME_RE.test(filename)) return false;
  const filePath = path.join(NOT_APPROVED_DIR, filename);
  if (!filePath.startsWith(NOT_APPROVED_DIR + path.sep)) return false;
  return fs.existsSync(filePath);
}

// CSV cell escaper (prevents formula injection)
function escapeCsv(val) {
  if (val === null || val === undefined) return '';
  var str = String(val);
  if (/^[=+\-@|%]/.test(str)) str = "'" + str;
  return '"' + str.replace(/"/g, '""') + '"';
}

// -- AUTH --

router.get('/login', redirectIfLoggedIn, (req, res) => {
  const flash = req.session.flash || null;
  delete req.session.flash;
  res.render('admin/login', { flash });
});

router.post('/login', loginLimiter, redirectIfLoggedIn, asyncHandler(async (req, res) => {
  const { username, password, remember_me } = req.body;
  if (!username || !password) {
    req.session.flash = { type: 'error', message: 'Username and password are required.' };
    return res.redirect('/admin/login');
  }
  const admin = await db.getAdminByUsername(username.trim());
  if (!admin) {
    await bcrypt.compare(password, '$2a$12$invalidhashpadding000000000000000000000000000000000000000');
    req.session.flash = { type: 'error', message: 'Invalid username or password.' };
    return res.redirect('/admin/login');
  }
  const match = await bcrypt.compare(password, admin.password_hash);
  if (!match) {
    req.session.flash = { type: 'error', message: 'Invalid username or password.' };
    return res.redirect('/admin/login');
  }
  // Extend session to 30 days if "Remember me" checked, else keep default (2 h)
  if (remember_me === 'on') {
    req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days in ms
  }
  req.session.adminLoggedIn = true;
  req.session.adminUsername = admin.username;
  const returnTo = req.session.returnTo;
  delete req.session.returnTo;
  res.redirect(isSafeRedirect(returnTo) ? returnTo : '/admin/dashboard');
}));

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// -- DASHBOARD --

router.get('/', requireAdmin, (req, res) => res.redirect('/admin/dashboard'));

router.get('/dashboard', requireAdmin, asyncHandler(async (req, res) => {
  const [pendingPhotos, approvedPhotos, notApprovedPhotosRaw, photoStats, rsvpStats, allSettings] = await Promise.all([
    db.getPendingPhotos(),
    db.getAllApprovedPhotos(),
    db.getNotApprovedPhotos(),
    db.getPhotoStats(),
    db.getRsvpStats(),
    db.getAllSettings(),
  ]);

  // Flag whether each not-approved photo's file is still on disk. Old/test
  // entries (declined before files were preserved) have no file and can be
  // cleared with the "reset" action; entries with files can be downloaded.
  const notApprovedPhotos = notApprovedPhotosRaw.map(function(p) {
    return Object.assign({}, p, { file_exists: notApprovedFileExists(p.filename) });
  });
  const notApprovedDownloadable = notApprovedPhotos.filter(function(p) { return p.file_exists; }).length;
  const notApprovedOrphans      = notApprovedPhotos.length - notApprovedDownloadable;

  // Enumerate site-*.* and photo-*.* images from public/images/
  var siteImages = [];
  if (fs.existsSync(IMAGES_DIR)) {
    siteImages = fs.readdirSync(IMAGES_DIR).filter(function(f) {
      return /^(site|photo)-.*\.(jpg|jpeg|png|webp|gif)$/i.test(f);
    }).sort();
  }

  const siteSettings = {
    livestream_visible:  allSettings.livestream_visible  || '1',
    livestream_channel:  allSettings.livestream_channel  || (process.env.TWITCH_CHANNEL || ''),
    livestream_homepage: allSettings.livestream_homepage || '0',
  };

  // Which home page guests currently see: 'pre' (default) or 'post'.
  const homeMode = (allSettings.home_mode === 'post') ? 'post' : 'pre';

  const flash = req.session.flash || null;
  delete req.session.flash;
  res.render('admin/dashboard', {
    pendingPhotos,
    approvedPhotos,
    notApprovedPhotos,
    notApprovedDownloadable,
    notApprovedOrphans,
    photoStats,
    rsvpStats,
    siteSettings,
    siteImages,
    homeMode,
    flash,
    adminUsername: req.session.adminUsername,
  });
}));

// -- HOME MODE: switch between pre-wedding and post-wedding front page --

router.post('/home-mode', requireAdmin, asyncHandler(async (req, res) => {
  const mode = req.body.mode === 'post' ? 'post' : 'pre';
  await db.setSetting('home_mode', mode);
  req.session.flash = {
    type: 'success',
    message: mode === 'post'
      ? 'Front page switched to the POST-wedding celebration page.'
      : 'Front page switched to the PRE-wedding page.',
  };
  res.redirect('/admin/dashboard');
}));

// -- PHOTO: SERVE PENDING (admin only) --

router.get('/photo/:id/image', requireAdmin, asyncHandler(async (req, res) => {
  const photo = await db.getPhotoById(req.params.id);
  // Serve pending photos (awaiting review) and not-approved photos (status
  // 'rejected', files preserved). Approved photos are served via /uploads/approved.
  if (!photo || (photo.status !== 'pending' && photo.status !== 'rejected')) {
    return res.status(404).send('Not found');
  }

  // Validate filename and mime_type before any file access
  if (!SAFE_FILENAME_RE.test(photo.filename)) {
    console.warn('[Admin] Suspicious filename blocked:', photo.filename);
    return res.status(403).send('Forbidden');
  }
  if (!ALLOWED_SERVE_TYPES.has(photo.mime_type)) {
    return res.status(403).send('Forbidden');
  }

  const dir = photo.status === 'pending' ? PENDING_DIR : NOT_APPROVED_DIR;
  const localPath = path.join(dir, photo.filename);
  // Path traversal check
  if (!localPath.startsWith(dir + path.sep) && localPath !== dir) {
    return res.status(403).send('Forbidden');
  }

  if (fs.existsSync(localPath)) {
    safeServeFile(res, dir, photo);
  } else {
    return res.status(404).send('File not found on disk.');
  }
}));

// -- PHOTO: APPROVE --

router.post('/photo/:id/approve', requireAdmin, asyncHandler(async (req, res) => {
  const photo = await db.getPhotoById(req.params.id);
  if (!photo || photo.status !== 'pending') return ajaxErr(req, res, 400, 'Photo not found or already reviewed.');
  if (!SAFE_FILENAME_RE.test(photo.filename))  return ajaxErr(req, res, 400, 'Invalid photo filename.');

  const src  = path.join(PENDING_DIR, photo.filename);
  const dest = path.join(APPROVED_DIR, photo.filename);
  if (!fs.existsSync(src)) return ajaxErr(req, res, 404, 'Photo file not found on disk.');

  fs.renameSync(src, dest);
  await db.updatePhotoStatus(photo.id, 'approved');
  return ajaxOk(req, res, 'Photo approved and added to the gallery.');
}));

// -- PHOTO: DECLINE (pending only; file preserved in not-approved folder) --

router.post('/photo/:id/reject', requireAdmin, asyncHandler(async (req, res) => {
  const photo = await db.getPhotoById(req.params.id);
  if (!photo)                      return ajaxErr(req, res, 404, 'Photo not found.');
  if (photo.status !== 'pending')  return ajaxErr(req, res, 400, 'Photo is not in a pending state.');
  // Move (not delete) so it stays downloadable from the Not Approved section.
  safeMoveFile(PENDING_DIR, NOT_APPROVED_DIR, photo.filename);
  await db.updatePhotoStatus(photo.id, 'rejected');
  return ajaxOk(req, res, 'Photo moved to Not Approved.');
}));

// -- PHOTOS: BULK APPROVE / REJECT --

router.post('/photos/bulk-action', requireAdmin, asyncHandler(async (req, res) => {
  if (!validateCsrfFromBody(req)) return ajaxErr(req, res, 403, 'Invalid security token. Please try again.');

  var action = req.body.action;
  var ids    = req.body.photo_ids;

  if (!ids || !['approve', 'reject'].includes(action)) return ajaxErr(req, res, 400, 'Invalid bulk action.');

  if (!Array.isArray(ids)) ids = [ids];
  ids = ids.filter(function(id) { return typeof id === 'string' && id.trim(); });

  var approved = 0, rejected = 0, skipped = 0;
  for (var i = 0; i < ids.length; i++) {
    var photo = await db.getPhotoById(ids[i]);
    if (!photo || photo.status !== 'pending') { skipped++; continue; }

    if (action === 'approve') {
      if (!SAFE_FILENAME_RE.test(photo.filename)) { skipped++; continue; }
      var src  = path.join(PENDING_DIR,  photo.filename);
      var dest = path.join(APPROVED_DIR, photo.filename);
      if (!fs.existsSync(src)) { skipped++; continue; }
      fs.renameSync(src, dest);
      await db.updatePhotoStatus(photo.id, 'approved');
      approved++;
    } else {
      // Move (not delete) so declined photos stay downloadable.
      safeMoveFile(PENDING_DIR, NOT_APPROVED_DIR, photo.filename);
      await db.updatePhotoStatus(photo.id, 'rejected');
      rejected++;
    }
  }

  var parts = [];
  if (approved > 0) parts.push(approved + ' photo' + (approved !== 1 ? 's' : '') + ' approved');
  if (rejected > 0) parts.push(rejected + ' photo' + (rejected !== 1 ? 's' : '') + ' moved to Not Approved');
  if (skipped  > 0) parts.push(skipped  + ' skipped (not found or already reviewed)');

  var msg = parts.join(', ') + '.';
  return ajaxOk(req, res, msg);
}));

// -- PHOTO: REMOVE APPROVED (take out of public gallery; file preserved) --

router.post('/photo/:id/delete', requireAdmin, asyncHandler(async (req, res) => {
  const photo = await db.getPhotoById(req.params.id);
  if (!photo)                       return ajaxErr(req, res, 404, 'Photo not found.');
  if (photo.status !== 'approved')  return ajaxErr(req, res, 400, 'Only approved photos can be removed this way.');
  // Move (not delete) into the not-approved folder so it stays downloadable.
  safeMoveFile(APPROVED_DIR, NOT_APPROVED_DIR, photo.filename);
  await db.updatePhotoStatus(photo.id, 'rejected');
  return ajaxOk(req, res, 'Photo removed from the gallery (moved to Not Approved).');
}));

// -- PHOTO: FEATURE / UNFEATURE --

router.post('/photo/:id/feature', requireAdmin, asyncHandler(async (req, res) => {
  const photo = await db.getPhotoById(req.params.id);
  if (!photo || photo.status !== 'approved') return ajaxErr(req, res, 400, 'Photo not found or not approved.');
  await db.setPhotoFeatured(photo.id, true);
  return ajaxOk(req, res, 'Photo featured on the home page.');
}));

router.post('/photo/:id/unfeature', requireAdmin, asyncHandler(async (req, res) => {
  const photo = await db.getPhotoById(req.params.id);
  if (!photo || photo.status !== 'approved') return ajaxErr(req, res, 400, 'Photo not found or not approved.');
  await db.setPhotoFeatured(photo.id, false);
  return ajaxOk(req, res, 'Photo removed from home page.');
}));

// -- PHOTO: HIDE / UNHIDE FROM PUBLIC GALLERY --

router.post('/photo/:id/hide', requireAdmin, asyncHandler(async (req, res) => {
  const photo = await db.getPhotoById(req.params.id);
  if (!photo || photo.status !== 'approved') return ajaxErr(req, res, 400, 'Photo not found or not approved.');
  await db.setPhotoHidden(photo.id, true);
  return ajaxOk(req, res, 'Photo hidden from the public gallery.');
}));

router.post('/photo/:id/unhide', requireAdmin, asyncHandler(async (req, res) => {
  const photo = await db.getPhotoById(req.params.id);
  if (!photo || photo.status !== 'approved') return ajaxErr(req, res, 400, 'Photo not found or not approved.');
  await db.setPhotoHidden(photo.id, false);
  return ajaxOk(req, res, 'Photo is now visible in the gallery.');
}));

// -- SITE IMAGE UPLOAD (multi-file) --

router.post('/site-image/upload', requireAdmin, function(req, res, next) {
  siteImageUpload.array('site_images', 20)(req, res, function(err) {
    // CSRF check after multer parses the multipart body
    if (!validateCsrfFromBody(req)) {
      req.session.flash = { type: 'error', message: 'Security token invalid. Please try again.' };
      return res.redirect('/admin/dashboard');
    }
    if (err) {
      var errMsg = err.code === 'LIMIT_FILE_SIZE'
        ? 'One or more images exceeded the 10 MB size limit.'
        : 'Invalid file type. Only JPEG, PNG, WebP, and GIF images are accepted.';
      req.session.flash = { type: 'error', message: errMsg };
      return res.redirect('/admin/dashboard');
    }
    var files = req.files || [];
    if (files.length === 0) {
      req.session.flash = { type: 'error', message: 'No image files selected.' };
      return res.redirect('/admin/dashboard');
    }
    var extMap = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
    var saved = 0;
    var errors = [];
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var detectedMime = detectSiteImageMime(file.buffer);
      if (!detectedMime) {
        errors.push(file.originalname + ': not a recognised image.');
        continue;
      }
      var safeFilename = 'site-' + Date.now() + '-' + i + extMap[detectedMime];
      try {
        fs.writeFileSync(path.join(IMAGES_DIR, safeFilename), file.buffer);
        saved++;
      } catch (writeErr) {
        errors.push(file.originalname + ': failed to save.');
      }
    }
    if (errors.length > 0) {
      req.session.flash = { type: 'error', message: errors.join(' ') };
    } else {
      req.session.flash = { type: 'success', message: saved + ' image' + (saved !== 1 ? 's' : '') + ' uploaded.' };
    }
    res.redirect('/admin/dashboard');
  });
});

// -- SITE IMAGE DELETE --

router.post('/site-image/:filename/delete', requireAdmin, asyncHandler(async (req, res) => {
  const filename = req.params.filename;
  // Safety: only allow deletion of site-*.* files
  if (!/^site-[^/\\]+\.(jpg|jpeg|png|webp|gif)$/i.test(filename)) {
    req.session.flash = { type: 'error', message: 'Invalid filename.' };
    return res.redirect('/admin/dashboard');
  }
  const filePath = path.join(IMAGES_DIR, filename);
  // Path traversal check
  if (!filePath.startsWith(IMAGES_DIR + path.sep) && filePath !== IMAGES_DIR) {
    req.session.flash = { type: 'error', message: 'Invalid file path.' };
    return res.redirect('/admin/dashboard');
  }
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    req.session.flash = { type: 'success', message: 'Site image deleted.' };
  } else {
    req.session.flash = { type: 'error', message: 'File not found.' };
  }
  res.redirect('/admin/dashboard');
}));

// -- SITE IMAGE REPLACE --

router.post('/site-image/:filename/replace', requireAdmin, function(req, res, next) {
  siteImageUpload.single('replacement')(req, res, function(err) {
    if (!validateCsrfFromBody(req)) {
      req.session.flash = { type: 'error', message: 'Security token invalid. Please try again.' };
      return res.redirect('/admin/dashboard');
    }
    var filename = req.params.filename;
    if (!/^site-[^/\\]+\.(jpg|jpeg|png|webp|gif)$/i.test(filename) &&
        !/^photo-[^/\\]+\.(jpg|jpeg|png|webp|gif)$/i.test(filename)) {
      req.session.flash = { type: 'error', message: 'Invalid filename.' };
      return res.redirect('/admin/dashboard');
    }
    var existingPath = path.join(IMAGES_DIR, filename);
    if (!existingPath.startsWith(IMAGES_DIR + path.sep)) {
      req.session.flash = { type: 'error', message: 'Invalid file path.' };
      return res.redirect('/admin/dashboard');
    }
    if (err) {
      var errMsg = err.code === 'LIMIT_FILE_SIZE' ? 'Image too large (max 10 MB).' : 'Invalid file type.';
      req.session.flash = { type: 'error', message: errMsg };
      return res.redirect('/admin/dashboard');
    }
    if (!req.file) {
      req.session.flash = { type: 'error', message: 'No replacement file selected.' };
      return res.redirect('/admin/dashboard');
    }
    var detectedMime = detectSiteImageMime(req.file.buffer);
    if (!detectedMime) {
      req.session.flash = { type: 'error', message: 'Invalid file. Only JPEG, PNG, WebP, and GIF images are accepted.' };
      return res.redirect('/admin/dashboard');
    }
    try {
      fs.writeFileSync(existingPath, req.file.buffer);
      req.session.flash = { type: 'success', message: filename + ' replaced successfully.' };
    } catch (writeErr) {
      console.error('[Site image replace] Write error:', writeErr.message);
      req.session.flash = { type: 'error', message: 'Failed to save replacement image. Please try again.' };
    }
    res.redirect('/admin/dashboard');
  });
});

// -- LIVESTREAM SETTINGS --

router.get('/livestream', requireAdmin, asyncHandler(async (req, res) => {
  const allSettings = await db.getAllSettings();
  const siteSettings = {
    livestream_visible:  allSettings.livestream_visible  || '1',
    livestream_channel:  allSettings.livestream_channel  || (process.env.TWITCH_CHANNEL || ''),
    livestream_homepage: allSettings.livestream_homepage || '0',
  };
  const flash = req.session.flash || null;
  delete req.session.flash;
  res.render('admin/livestream', { siteSettings, flash });
}));

router.post('/livestream', requireAdmin, asyncHandler(async (req, res) => {
  const channel  = (req.body.livestream_channel  || '').trim().substring(0, 25);
  const visible  = req.body.livestream_visible  === '1' ? '1' : '0';
  const homepage = req.body.livestream_homepage === '1' ? '1' : '0';

  if (channel && !/^[a-zA-Z0-9_]{1,25}$/.test(channel)) {
    req.session.flash = { type: 'error', message: 'Invalid Twitch channel name. Use only letters, numbers, and underscores (max 25 characters).' };
    return res.redirect('/admin/dashboard');
  }

  await Promise.all([
    db.setSetting('livestream_channel',  channel),
    db.setSetting('livestream_visible',  visible),
    db.setSetting('livestream_homepage', homepage),
  ]);

  req.session.flash = { type: 'success', message: 'Livestream settings saved.' };
  res.redirect('/admin/dashboard');
}));

// -- PHOTOS: DOWNLOAD ALL APPROVED (as zip) --

router.get('/photos/download-all', requireAdmin, asyncHandler(async (req, res) => {
  const approvedPhotos = await db.getAllApprovedPhotos();

  // Build list of files that actually exist on disk before sending any headers
  var toAdd = [];
  if (approvedPhotos && approvedPhotos.length > 0) {
    for (var i = 0; i < approvedPhotos.length; i++) {
      var photo = approvedPhotos[i];
      if (!SAFE_FILENAME_RE.test(photo.filename)) continue;
      var filePath = path.join(APPROVED_DIR, photo.filename);
      if (!filePath.startsWith(APPROVED_DIR + path.sep) && filePath !== APPROVED_DIR) continue;
      if (fs.existsSync(filePath)) {
        toAdd.push({ filePath: filePath, name: photo.original_name || photo.filename });
      }
    }
  }

  if (toAdd.length === 0) {
    req.session.flash = { type: 'error', message: 'No approved photo files found on disk.' };
    return res.redirect('/admin/dashboard');
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="approved-photos-' + dateStr + '.zip"');
  res.setHeader('Cache-Control', 'no-store');

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', function(err) {
    console.error('[Download All] Archive error:', err.message);
    if (!res.headersSent) res.status(500).send('Archive failed.');
  });
  archive.pipe(res);

  for (var j = 0; j < toAdd.length; j++) {
    archive.file(toAdd[j].filePath, { name: toAdd[j].name });
  }

  await archive.finalize();
}));

// -- PHOTOS: DOWNLOAD ALL NOT-APPROVED (as zip) --

router.get('/photos/download-all-unapproved', requireAdmin, asyncHandler(async (req, res) => {
  const notApproved = await db.getNotApprovedPhotos();

  var toAdd = [];
  if (notApproved && notApproved.length > 0) {
    for (var i = 0; i < notApproved.length; i++) {
      var photo = notApproved[i];
      if (!SAFE_FILENAME_RE.test(photo.filename)) continue;
      var filePath = path.join(NOT_APPROVED_DIR, photo.filename);
      if (!filePath.startsWith(NOT_APPROVED_DIR + path.sep) && filePath !== NOT_APPROVED_DIR) continue;
      if (fs.existsSync(filePath)) {
        toAdd.push({ filePath: filePath, name: photo.original_name || photo.filename });
      }
    }
  }

  if (toAdd.length === 0) {
    req.session.flash = { type: 'error', message: 'No not-approved photo files found on disk.' };
    return res.redirect('/admin/dashboard');
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="not-approved-photos-' + dateStr + '.zip"');
  res.setHeader('Cache-Control', 'no-store');

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', function(err) {
    console.error('[Download Not-Approved] Archive error:', err.message);
    if (!res.headersSent) res.status(500).send('Archive failed.');
  });
  archive.pipe(res);

  for (var j = 0; j < toAdd.length; j++) {
    archive.file(toAdd[j].filePath, { name: toAdd[j].name });
  }

  await archive.finalize();
}));

// -- PHOTOS: RESET NOT-APPROVED COUNTER --
// Safely clears only the old/test entries whose image file no longer exists
// on disk. Entries that still have a stored file (i.e. real not-approved
// photos you can still download) are left untouched — so this can never
// delete an actual uploaded image.

router.post('/photos/reset-unapproved', requireAdmin, asyncHandler(async (req, res) => {
  const notApproved = await db.getNotApprovedPhotos();
  var removed = 0, kept = 0;
  for (var i = 0; i < notApproved.length; i++) {
    var photo = notApproved[i];
    if (notApprovedFileExists(photo.filename)) {
      kept++;                       // real file present — preserve it
    } else {
      await db.deletePhotoRecord(photo.id);
      removed++;
    }
  }

  var msg;
  if (removed === 0) {
    msg = 'Nothing to reset — no old/test entries found.';
  } else {
    msg = 'Reset complete: cleared ' + removed + ' old entr' + (removed !== 1 ? 'ies' : 'y') + '.';
    if (kept > 0) msg += ' Kept ' + kept + ' not-approved photo' + (kept !== 1 ? 's' : '') + ' that still have files.';
  }
  req.session.flash = { type: 'success', message: msg };
  res.redirect('/admin/dashboard');
}));

// -- RSVPs: LIST --

router.get('/rsvps', requireAdmin, asyncHandler(async (req, res) => {
  const [rsvps, rsvpStats] = await Promise.all([
    db.getAllRsvps(),
    db.getRsvpStats(),
  ]);
  const flash = req.session.flash || null;
  delete req.session.flash;
  res.render('admin/rsvps', { rsvps, rsvpStats, flash });
}));

// -- RSVPs: DELETE --

router.post('/rsvp/:id/delete', requireAdmin, asyncHandler(async (req, res) => {
  const removed = await db.deleteRsvp(req.params.id);
  if (removed === 0) {
    req.session.flash = { type: 'error', message: 'RSVP not found.' };
  } else {
    req.session.flash = { type: 'success', message: 'RSVP deleted.' };
  }
  res.redirect('/admin/rsvps');
}));

// -- RSVPs: CSV EXPORT --

router.get('/rsvps/export.csv', requireAdmin, asyncHandler(async (req, res) => {
  const rsvps = await db.getAllRsvps();
  const headers = ['Name', 'Attending', 'Guests', 'Email', 'Dietary Requirements', 'Song Request', 'Message', 'Submitted'];
  const rows = rsvps.map(function(r) {
    return [
      escapeCsv(r.name),
      escapeCsv(r.attending),
      escapeCsv(r.attending === 'yes' ? r.guest_count : ''),
      escapeCsv(r.email),
      escapeCsv(r.dietary_requirements),
      escapeCsv(r.song_request),
      escapeCsv(r.message),
      escapeCsv(r.created_at ? new Date(r.created_at).toISOString() : ''),
    ].join(',');
  });
  const csv = [headers.join(',')].concat(rows).join('\r\n');
  const filename = 'rsvps-' + new Date().toISOString().slice(0, 10) + '.csv';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  res.setHeader('Cache-Control', 'no-store');
  // UTF-8 BOM for Excel compatibility
  res.send('\xEF\xBB\xBF' + csv);
}));

module.exports = router;
