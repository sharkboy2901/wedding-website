'use strict';

const express = require('express');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 15);

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const PENDING_DIR = path.join(ROOT, 'uploads', 'pending');
const APPROVED_DIR = path.join(ROOT, 'uploads', 'approved');
const DB_FILE = path.join(DATA_DIR, 'site-data.json');

for (const dir of [DATA_DIR, PENDING_DIR, APPROVED_DIR]) fs.mkdirSync(dir, { recursive: true });

function loadDb() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { photos: [], rsvps: [] }; }
}

function saveDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>\"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[ch]));
}

function layout(title, body) {
  const couple = process.env.COUPLE_NAMES || 'Matthew & Partner';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} | ${escapeHtml(couple)}</title><link rel="stylesheet" href="/styles.css"></head><body><header class="hero"><nav><a href="/">Home</a><a href="/rsvp">RSVP</a><a href="/upload">Upload Photos</a><a href="/gallery">Gallery</a><a href="/admin">Admin</a></nav><div><p class="eyebrow">We're getting married</p><h1>${escapeHtml(couple)}</h1><p>${escapeHtml(process.env.WEDDING_DATE || '6 June 2026')} · ${escapeHtml(process.env.VENUE_NAME || 'Trattoria Da Manuele')}</p></div></header><main>${body}</main><footer>With love · ${escapeHtml(couple)}</footer></body></html>`;
}

app.use(express.urlencoded({ extended: true }));
app.use('/styles.css', express.static(path.join(ROOT, 'public', 'css', 'styles.css')));
app.use('/approved', express.static(APPROVED_DIR));
app.use(session({ secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'), resave: false, saveUninitialized: false }));

const upload = multer({
  dest: PENDING_DIR,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype))
});

function isValidImage(filePath) {
  const b = fs.readFileSync(filePath);
  const isJpeg = b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const isPng = b.length > 8 && b.slice(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  const isWebp = b.length > 12 && b.slice(0,4).toString() === 'RIFF' && b.slice(8,12).toString() === 'WEBP';
  return isJpeg || isPng || isWebp;
}

function requireAdmin(req, res, next) {
  if (req.session.admin) return next();
  res.redirect('/admin/login');
}

app.get('/', (req, res) => {
  res.send(layout('Home', `<section class="card centre"><h2>Let's Celebrate Together</h2><p>Welcome to our wedding website. Please RSVP, share your photos, and check the gallery after approval.</p><div class="actions"><a class="btn" href="/rsvp">RSVP</a><a class="btn secondary" href="/upload">Upload a Photo</a></div></section>`));
});

app.get('/rsvp', (req, res) => {
  res.send(layout('RSVP', `<section class="card"><h2>RSVP</h2><form method="post"><label>Name<input name="name" required maxlength="100"></label><label>Email<input name="email" type="email" maxlength="200"></label><label>Will you attend?<select name="attending"><option value="yes">Yes</option><option value="no">No</option></select></label><label>Guests including yourself<input name="guests" type="number" min="1" max="10" value="1"></label><label>Dietary requirements<textarea name="dietary" maxlength="500"></textarea></label><label>Message<textarea name="message" maxlength="1000"></textarea></label><button class="btn" type="submit">Submit RSVP</button></form></section>`));
});

app.post('/rsvp', (req, res) => {
  const db = loadDb();
  db.rsvps.push({ id: crypto.randomUUID(), ...req.body, createdAt: new Date().toISOString() });
  saveDb(db);
  res.send(layout('RSVP received', `<section class="card centre"><h2>Thank you</h2><p>Your RSVP has been saved.</p><a class="btn" href="/">Back home</a></section>`));
});

app.get('/upload', (req, res) => {
  res.send(layout('Upload Photos', `<section class="card"><h2>Upload a Photo</h2><p>Only JPEG, PNG and WebP images are accepted. All photos require approval before appearing publicly.</p><form method="post" enctype="multipart/form-data"><label>Your name<input name="name" maxlength="100"></label><label>Caption<textarea name="caption" maxlength="500"></textarea></label><label>Photo<input type="file" name="photo" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" required></label><button class="btn" type="submit">Upload for Approval</button></form></section>`));
});

app.post('/upload', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).send(layout('Upload failed', '<section class="card"><h2>No valid image uploaded</h2><p>Please upload a JPEG, PNG or WebP image.</p></section>'));
  if (!isValidImage(req.file.path)) { fs.unlinkSync(req.file.path); return res.status(400).send(layout('Upload failed', '<section class="card"><h2>Rejected</h2><p>The file content is not a supported image.</p></section>')); }
  const ext = req.file.mimetype === 'image/png' ? '.png' : req.file.mimetype === 'image/webp' ? '.webp' : '.jpg';
  const filename = `${crypto.randomUUID()}${ext}`;
  fs.renameSync(req.file.path, path.join(PENDING_DIR, filename));
  const db = loadDb();
  db.photos.push({ id: crypto.randomUUID(), filename, originalName: req.file.originalname, mimeType: req.file.mimetype, name: req.body.name || '', caption: req.body.caption || '', status: 'pending', uploadedAt: new Date().toISOString() });
  saveDb(db);
  res.send(layout('Uploaded', '<section class="card centre"><h2>Uploaded</h2><p>Your photo is awaiting approval.</p><a class="btn" href="/gallery">View gallery</a></section>'));
});

app.get('/gallery', (req, res) => {
  const db = loadDb();
  const photos = db.photos.filter(p => p.status === 'approved');
  const grid = photos.length ? photos.map(p => `<figure><img src="/approved/${escapeHtml(p.filename)}" alt="Wedding photo"><figcaption>${escapeHtml(p.caption || p.name || 'Wedding photo')}</figcaption></figure>`).join('') : '<p>No approved photos yet.</p>';
  res.send(layout('Gallery', `<section class="card"><h2>Gallery</h2><div class="gallery">${grid}</div></section>`));
});

app.get('/admin/login', (req, res) => {
  res.send(layout('Admin Login', `<section class="card"><h2>Admin Login</h2><form method="post"><label>Username<input name="username" required></label><label>Password<input name="password" type="password" required></label><button class="btn" type="submit">Login</button></form></section>`));
});

app.post('/admin/login', (req, res) => {
  if (req.body.username === (process.env.ADMIN_USERNAME || 'admin') && req.body.password === (process.env.ADMIN_PASSWORD || 'change-this-password')) { req.session.admin = true; return res.redirect('/admin'); }
  res.status(401).send(layout('Login failed', '<section class="card"><h2>Login failed</h2><p>Invalid credentials.</p></section>'));
});

app.get('/admin/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

app.get('/admin', requireAdmin, (req, res) => {
  const db = loadDb();
  const pending = db.photos.filter(p => p.status === 'pending').map(p => `<article class="admin-item"><img src="/admin/pending/${escapeHtml(p.id)}" alt="Pending photo"><p><strong>${escapeHtml(p.name || 'Guest')}</strong><br>${escapeHtml(p.caption || '')}</p><form method="post" action="/admin/photos/${escapeHtml(p.id)}/approve"><button class="btn">Approve</button></form><form method="post" action="/admin/photos/${escapeHtml(p.id)}/reject"><button class="btn danger">Reject</button></form></article>`).join('') || '<p>No pending photos.</p>';
  const rsvps = db.rsvps.map(r => `<li>${escapeHtml(r.name)} — ${escapeHtml(r.attending)} — ${escapeHtml(r.guests || '')}</li>`).join('') || '<li>No RSVPs yet.</li>';
  res.send(layout('Admin', `<section class="card"><h2>Admin Dashboard</h2><p><a href="/admin/logout">Logout</a></p><h3>Pending Photos</h3>${pending}<h3>RSVPs</h3><ul>${rsvps}</ul></section>`));
});

app.get('/admin/pending/:id', requireAdmin, (req, res) => {
  const photo = loadDb().photos.find(p => p.id === req.params.id && p.status === 'pending');
  if (!photo) return res.sendStatus(404);
  res.sendFile(path.join(PENDING_DIR, photo.filename));
});

app.post('/admin/photos/:id/approve', requireAdmin, (req, res) => {
  const db = loadDb();
  const photo = db.photos.find(p => p.id === req.params.id && p.status === 'pending');
  if (photo) { fs.renameSync(path.join(PENDING_DIR, photo.filename), path.join(APPROVED_DIR, photo.filename)); photo.status = 'approved'; photo.reviewedAt = new Date().toISOString(); saveDb(db); }
  res.redirect('/admin');
});

app.post('/admin/photos/:id/reject', requireAdmin, (req, res) => {
  const db = loadDb();
  const photo = db.photos.find(p => p.id === req.params.id && p.status === 'pending');
  if (photo) { try { fs.unlinkSync(path.join(PENDING_DIR, photo.filename)); } catch {} photo.status = 'rejected'; photo.reviewedAt = new Date().toISOString(); saveDb(db); }
  res.redirect('/admin');
});

app.listen(PORT, () => console.log(`Wedding website running on port ${PORT}`));
