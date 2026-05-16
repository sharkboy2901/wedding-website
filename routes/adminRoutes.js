'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const router = express.Router();

const db = require('../db/database');
const { requireAdmin, redirectIfLoggedIn } = require('../middleware/auth');

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

router.post('/login', redirectIfLoggedIn, asyncHandler(async (req, res) => {
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
  const [pendingPhotos, approvedPhotos, photoStats, rsvpStats] = await Promise.all([
    db.getPendingPhotos(),
    db.getApprovedPhotos(),
    db.getPhotoStats(),
    db.getRsvpStats(),
  ]);
  const flash = req.session.flash || null;
  delete req.session.flash;
  res.render('admin/dashboard', {
    pendingPhotos,
    approvedPhotos,
    photoStats,
    rsvpStats,
    flash,
    adminUsername: req.session.adminUsername,
  });
}));

// -- PHOTO: SERVE PENDING (admin only) --

router.get('/photo/:id/image', requireAdmin, asyncHandler(async (req, res) => {
  const photo = await db.getPhotoById(req.params.id);
  if (!photo || photo.status !== 'pending') {
    return res.status(404).send('Not found');
  }
  safeServeFile(res, PENDING_DIR, photo);
}));

// -- PHOTO: APPROVE --

router.post('/photo/:id/approve', requireAdmin, asyncHandler(async (req, res) => {
  const photo = await db.getPhotoById(req.params.id);
  if (!photo || photo.status !== 'pending') {
    req.session.flash = { type: 'error', message: 'Photo not found or already reviewed.' };
    return res.redirect('/admin/dashboard');
  }
  if (!SAFE_FILENAME_RE.test(photo.filename)) {
    req.session.flash = { type: 'error', message: 'Invalid photo filename.' };
    return res.redirect('/admin/dashboard');
  }
  const src  = path.join(PENDING_DIR, photo.filename);
  const dest = path.join(APPROVED_DIR, photo.filename);
  if (!fs.existsSync(src)) {
    req.session.flash = { type: 'error', message: 'Photo file not found on disk.' };
    return res.redirect('/admin/dashboard');
  }
  fs.renameSync(src, dest);
  await db.updatePhotoStatus(photo.id, 'approved');
  req.session.flash = { type: 'success', message: 'Photo approved and added to the gallery.' };
  res.redirect('/admin/dashboard');
}));

// -- PHOTO: REJECT (pending only, file deleted) --

router.post('/photo/:id/reject', requireAdmin, asyncHandler(async (req, res) => {
  const photo = await db.getPhotoById(req.params.id);
  if (!photo) {
    req.session.flash = { type: 'error', message: 'Photo not found.' };
    return res.redirect('/admin/dashboard');
  }
  if (photo.status !== 'pending') {
    req.session.flash = { type: 'error', message: 'Photo is not in a pending state.' };
    return res.redirect('/admin/dashboard');
  }
  safeDeleteFile(PENDING_DIR, photo.filename);
  await db.updatePhotoStatus(photo.id, 'rejected');
  req.session.flash = { type: 'success', message: 'Photo rejected and removed.' };
  res.redirect('/admin/dashboard');
}));

// -- PHOTO: DELETE APPROVED (remove from public gallery) --

router.post('/photo/:id/delete', requireAdmin, asyncHandler(async (req, res) => {
  const photo = await db.getPhotoById(req.params.id);
  if (!photo) {
    req.session.flash = { type: 'error', message: 'Photo not found.' };
    return res.redirect('/admin/dashboard');
  }
  if (photo.status !== 'approved') {
    req.session.flash = { type: 'error', message: 'Only approved photos can be removed via this action.' };
    return res.redirect('/admin/dashboard');
  }
  safeDeleteFile(APPROVED_DIR, photo.filename);
  await db.updatePhotoStatus(photo.id, 'rejected');
  req.session.flash = { type: 'success', message: 'Photo removed from the public gallery.' };
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
