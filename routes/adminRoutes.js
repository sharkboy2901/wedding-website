'use strict';

const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const bcrypt     = require('bcryptjs');
const multer     = require('multer');
const rateLimit  = require('express-rate-limit');
const router     = express.Router();

const db                = require('../db/database');
const { requireAdmin, redirectIfLoggedIn } = require('../middleware/auth');
const { validateCsrfFromBody } = require('../middleware/csrf');
const { uploadToDrive, extractFolderId, normalizeFolderInput, streamFromDrive } = require('../lib/driveUpload');

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

const PENDING_DIR  = path.join(__dirname, '..', 'uploads', 'pending');
const APPROVED_DIR = path.join(__dirname, '..', 'uploads', 'approved');

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

// Safe file-delete helper
function safeDeleteFile(dir, filename) {
  if (!SAFE_FILENAME_RE.test(filename)) return;
  const filePath = path.join(dir, filename);
  if (!filePath.startsWith(dir + path.sep) && filePath !== dir) return;
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
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
  const { username, password } = req.body;
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
  const [pendingPhotos, approvedPhotos, photoStats, rsvpStats, allSettings] = await Promise.all([
    db.getPendingPhotos(),
    db.getAllApprovedPhotos(),
    db.getPhotoStats(),
    db.getRsvpStats(),
    db.getAllSettings(),
  ]);

  // Enumerate site-*.* and photo-*.* images from public/images/
  var siteImages = [];
  if (fs.existsSync(IMAGES_DIR)) {
    siteImages = fs.readdirSync(IMAGES_DIR).filter(function(f) {
      return /^(site|photo)-.*\.(jpg|jpeg|png|webp|gif)$/i.test(f);
    }).sort();
  }

  const siteSettings = {
    livestream_visible:       allSettings.livestream_visible       || '1',
    livestream_channel:       allSettings.livestream_channel       || (process.env.TWITCH_CHANNEL || ''),
    livestream_homepage:      allSettings.livestream_homepage      || '0',
    google_drive_folder_id:   allSettings.google_drive_folder_id  || process.env.GOOGLE_DRIVE_FOLDER_ID || '',
  };

  const flash = req.session.flash || null;
  delete req.session.flash;
  res.render('admin/dashboard', {
    pendingPhotos,
    approvedPhotos,
    photoStats,
    rsvpStats,
    siteSettings,
    siteImages,
    flash,
    adminUsername:   req.session.adminUsername,
    driveConfigured: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
  });
}));

// -- PHOTO: SERVE PENDING (admin only) --

router.get('/photo/:id/image', requireAdmin, asyncHandler(async (req, res) => {
  const photo = await db.getPhotoById(req.params.id);
  if (!photo || photo.status !== 'pending') {
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

  const localPath = path.join(PENDING_DIR, photo.filename);
  // Path traversal check
  if (!localPath.startsWith(PENDING_DIR + path.sep) && localPath !== PENDING_DIR) {
    return res.status(403).send('Forbidden');
  }

  if (fs.existsSync(localPath)) {
    safeServeFile(res, PENDING_DIR, photo);
  } else if (photo.drive_file_id) {
    await streamFromDrive(res, photo.drive_file_id, photo.mime_type);
  } else {
    return res.status(404).send('File not found on disk and no Drive backup available.');
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

  var successMsg = 'Photo approved and added to the gallery.';
  var folderId = (await db.getSetting('google_drive_folder_id')) || process.env.GOOGLE_DRIVE_FOLDER_ID || null;
  if (folderId) {
    var driveErr = null;
    var driveResult = await uploadToDrive(dest, photo.original_name || photo.filename, photo.mime_type, extractFolderId(folderId))
      .catch(function(e) { driveErr = e; return null; });
    if (driveResult) {
      successMsg += ' Saved to Google Drive.';
    } else {
      var driveDetail = 'unknown error';
      if (driveErr) {
        driveDetail = driveErr.message || driveDetail;
        if (driveErr.errors && driveErr.errors.length) driveDetail += ' — ' + driveErr.errors.map(function(e) { return e.message; }).join('; ');
      }
      successMsg += ' (Drive upload failed: ' + driveDetail + ')';
    }
  }

  return ajaxOk(req, res, successMsg);
}));

// -- PHOTO: REJECT (pending only, file deleted) --

router.post('/photo/:id/reject', requireAdmin, asyncHandler(async (req, res) => {
  const photo = await db.getPhotoById(req.params.id);
  if (!photo)                      return ajaxErr(req, res, 404, 'Photo not found.');
  if (photo.status !== 'pending')  return ajaxErr(req, res, 400, 'Photo is not in a pending state.');
  safeDeleteFile(PENDING_DIR, photo.filename);
  await db.updatePhotoStatus(photo.id, 'rejected');
  return ajaxOk(req, res, 'Photo rejected and removed.');
}));

// -- PHOTOS: BULK APPROVE / REJECT --

router.post('/photos/bulk-action', requireAdmin, asyncHandler(async (req, res) => {
  if (!validateCsrfFromBody(req)) return ajaxErr(req, res, 403, 'Invalid security token. Please try again.');

  var action = req.body.action;
  var ids    = req.body.photo_ids;

  if (!ids || !['approve', 'reject'].includes(action)) return ajaxErr(req, res, 400, 'Invalid bulk action.');

  if (!Array.isArray(ids)) ids = [ids];
  ids = ids.filter(function(id) { return typeof id === 'string' && id.trim(); });

  var folderId = null;
  if (action === 'approve') {
    folderId = await db.getSetting('google_drive_folder_id');
  }

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
      if (folderId) {
        var folderIdOnly  = extractFolderId(folderId);
        var displayName   = photo.original_name || photo.filename;
        var photoMime     = photo.mime_type;
        var photoDest     = dest;
        uploadToDrive(photoDest, displayName, photoMime, folderIdOnly).catch(function() {});
      }
      approved++;
    } else {
      safeDeleteFile(PENDING_DIR, photo.filename);
      await db.updatePhotoStatus(photo.id, 'rejected');
      rejected++;
    }
  }

  var parts = [];
  if (approved > 0) parts.push(approved + ' photo' + (approved !== 1 ? 's' : '') + ' approved');
  if (rejected > 0) parts.push(rejected + ' photo' + (rejected !== 1 ? 's' : '') + ' rejected');
  if (skipped  > 0) parts.push(skipped  + ' skipped (not found or already reviewed)');

  var msg = parts.join(', ') + '.';
  return ajaxOk(req, res, msg);
}));

// -- PHOTO: DELETE APPROVED (remove from public gallery) --

router.post('/photo/:id/delete', requireAdmin, asyncHandler(async (req, res) => {
  const photo = await db.getPhotoById(req.params.id);
  if (!photo)                       return ajaxErr(req, res, 404, 'Photo not found.');
  if (photo.status !== 'approved')  return ajaxErr(req, res, 400, 'Only approved photos can be deleted this way.');
  safeDeleteFile(APPROVED_DIR, photo.filename);
  await db.updatePhotoStatus(photo.id, 'rejected');
  return ajaxOk(req, res, 'Photo deleted.');
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

// -- GOOGLE DRIVE SETTINGS --

router.post('/settings/drive', requireAdmin, asyncHandler(async (req, res) => {
  var raw = (req.body.google_drive_folder_url || '').trim();

  // Always store the full canonical URL (accepts either a full URL or a bare folder ID)
  var normalizedUrl = raw ? normalizeFolderInput(raw) : '';

  await db.setSetting('google_drive_folder_id', normalizedUrl);
  req.session.flash = { type: 'success', message: 'Google Drive settings saved.' };
  res.redirect('/admin/dashboard');
}));

// -- GOOGLE DRIVE: TEST CONNECTION --

router.post('/settings/drive/test', requireAdmin, asyncHandler(async (req, res) => {
  const { google } = require('googleapis');

  // Mirror the same priority as driveUpload.js: service account first, OAuth2 fallback
  function buildDriveClient() {
    // 1. Service account (preferred — credentials never expire)
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (raw) {
      try {
        const json  = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
        const creds = JSON.parse(json);
        const auth  = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/drive'] });
        return { drive: google.drive({ version: 'v3', auth }), mode: 'Service Account (' + creds.client_email + ')' };
      } catch (e) {
        return { error: 'Service account JSON is invalid: ' + e.message };
      }
    }
    // 2. OAuth2 refresh token (fallback for personal Gmail)
    const clientId     = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
    if (clientId && clientSecret && refreshToken) {
      try {
        const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
        oauth2.setCredentials({ refresh_token: refreshToken });
        return { drive: google.drive({ version: 'v3', auth: oauth2 }), mode: 'OAuth2' };
      } catch (e) {
        return { error: 'OAuth2 init failed: ' + e.message };
      }
    }
    return { error: 'No credentials found. Set GOOGLE_SERVICE_ACCOUNT_JSON in Railway environment variables.' };
  }

  var built = buildDriveClient();
  if (built.error) {
    req.session.flash = { type: 'error', message: 'Drive test failed — ' + built.error };
    return res.redirect('/admin/dashboard');
  }

  var folderId = (await db.getSetting('google_drive_folder_id')) || process.env.GOOGLE_DRIVE_FOLDER_ID || null;
  var folderIdOnly = folderId ? extractFolderId(folderId) : null;

  try {
    var params = { pageSize: 1, fields: 'files(id,name)', supportsAllDrives: true, includeItemsFromAllDrives: true };
    if (folderIdOnly) params.q = '"' + folderIdOnly + '" in parents';
    await built.drive.files.list(params);
    var msg = 'Drive connection OK (' + built.mode + ').';
    msg += folderIdOnly ? ' Folder is accessible.' : ' No folder set yet — paste a folder URL below and save.';
    req.session.flash = { type: 'success', message: msg };
  } catch (err) {
    var detail = err.message || 'unknown error';
    if (err.errors && err.errors.length) detail += ' — ' + err.errors.map(function(e) { return e.message; }).join('; ');
    if (err.response && err.response.data && err.response.data.error_description) detail += ' — ' + err.response.data.error_description;
    var hint = detail.indexOf('invalid_grant') !== -1
      ? ' Tip: OAuth2 token is expired/revoked. Remove GOOGLE_OAUTH_* env vars from Railway so the service account is used.'
      : detail.indexOf('notFound') !== -1 || detail.indexOf('404') !== -1
      ? ' Tip: share the Drive folder with the service account email address.'
      : '';
    req.session.flash = { type: 'error', message: 'Drive test failed (' + built.mode + '): ' + detail + hint };
  }

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
