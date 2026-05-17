'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const app     = express();
const PORT    = process.env.PORT || 3000;

// ── Config ────────────────────────────────────────────────────────────────────
const IMAGES_DIR  = path.join(__dirname, 'public', 'images');
const ADMIN_USER  = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS  = process.env.ADMIN_PASSWORD || '';

// Ensure images directory exists
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

// ── Multer (memory storage so we control destination filename) ────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.(jpe?g|png|webp|gif)$/i.test(file.originalname) ||
        /^image\//.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// ── HTTP Basic Auth middleware ─────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (!ADMIN_PASS) return next(); // open if no password set
  const auth = req.headers.authorization || '';
  const [scheme, encoded] = auth.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const colon   = decoded.indexOf(':');
    const user    = decoded.slice(0, colon);
    const pass    = decoded.slice(colon + 1);
    if (user === ADMIN_USER && pass === ADMIN_PASS) return next();
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="Wedding Admin"');
  res.status(401).send('Authentication required.');
}

// Sanitise an uploaded filename — only allow photo-N.jpeg style names
function safeName(raw) {
  const base = path.basename(raw || '').replace(/[^a-zA-Z0-9._-]/g, '');
  return /\.(jpe?g|png|webp|gif)$/i.test(base) ? base : null;
}

// ── Admin: Image Manager UI ───────────────────────────────────────────────────
app.get('/admin/images', requireAdmin, (_req, res) => {
  const files = fs.existsSync(IMAGES_DIR)
    ? fs.readdirSync(IMAGES_DIR)
        .filter(f => /\.(jpe?g|png|webp|gif)$/i.test(f))
        .sort()
    : [];

  const cards = files.map((f, i) => `
    <div class="card" id="card-${i}">
      <div class="card-thumb">
        <img src="/images/${encodeURIComponent(f)}?t=${Date.now()}" alt="${f}" loading="lazy" />
        <div class="card-index">${i + 1}</div>
      </div>
      <div class="card-body">
        <div class="filename">${f}</div>
        <form class="replace-form" data-slot="${f}">
          <label class="btn btn-gold">
            📷 Replace
            <input type="file" accept="image/*" class="file-input" />
          </label>
          <span class="status"></span>
        </form>
      </div>
    </div>`).join('');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Image Manager · Matthew &amp; Kristine</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --cream: #f5ede0; --brown: #3d2b1f; --gold: #b8945a;
      --green: #4caf50; --red: #e53935; --warm: #faf6f0;
    }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: var(--cream); color: var(--brown); min-height: 100vh; }
    header { background: var(--brown); color: var(--cream); padding: 18px 32px; display: flex; align-items: center; gap: 16px; }
    header h1 { font-size: 1.3rem; font-weight: 500; }
    header a { color: var(--gold); font-size: 0.8rem; text-decoration: none; margin-left: auto; }
    header a:hover { text-decoration: underline; }
    main { max-width: 1100px; margin: 0 auto; padding: 32px 24px; }
    .banner { background: #fff8e1; border: 1px solid #ffe082; border-radius: 8px; padding: 12px 16px; margin-bottom: 28px; font-size: 0.82rem; color: #6d4c00; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 18px; }
    .card { background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.09); }
    .card-thumb { position: relative; }
    .card-thumb img { width: 100%; height: 160px; object-fit: cover; display: block; }
    .card-index { position: absolute; top: 8px; left: 8px; background: rgba(0,0,0,0.55); color: #fff; font-size: 0.7rem; font-weight: 700; padding: 2px 7px; border-radius: 4px; }
    .card-body { padding: 12px; }
    .filename { font-size: 0.72rem; color: #888; margin-bottom: 10px; word-break: break-all; }
    .btn { display: inline-block; padding: 7px 14px; border-radius: 6px; cursor: pointer; font-size: 0.8rem; font-weight: 600; border: none; }
    .btn-gold { background: var(--gold); color: #fff; }
    .btn-gold:hover { background: #a07840; }
    .btn-green { background: var(--green); color: #fff; }
    .btn-green:hover { background: #388e3c; }
    .file-input { display: none; }
    .status { display: block; margin-top: 7px; font-size: 0.75rem; min-height: 16px; }
    .status.ok  { color: var(--green); font-weight: 600; }
    .status.err { color: var(--red); }
    .status.loading { color: #888; }
    /* Add new section */
    .add-section { margin-top: 40px; background: var(--warm); border: 1px solid rgba(184,148,90,0.25); border-radius: 10px; padding: 24px; }
    .add-section h2 { font-size: 1rem; margin-bottom: 16px; }
    .add-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-start; }
    .add-row input[type="text"] { flex: 1; min-width: 180px; padding: 8px 12px; border: 1px solid #ccc; border-radius: 6px; font-size: 0.85rem; }
    #add-label { display: inline-flex; align-items: center; gap: 6px; }
    #add-status { width: 100%; font-size: 0.8rem; margin-top: 8px; }
    #chosen-name { font-size: 0.78rem; color: #888; margin-top: 4px; }
  </style>
</head>
<body>
  <header>
    <span style="font-size:1.5rem">📷</span>
    <h1>Image Manager &mdash; Matthew &amp; Kristine</h1>
    <a href="/">← View site</a>
  </header>
  <main>
    <div class="banner">
      Photos are numbered in slideshow order. Click <strong>Replace</strong> on any card to swap in a new image — it takes effect immediately on the server.
      To make it permanent, push the <code>public/images/</code> folder to GitHub so Railway redeploys.
    </div>

    <div class="grid">${cards || '<p style="color:#888">No images found in public/images/</p>'}</div>

    <div class="add-section">
      <h2>➕ Add a new photo</h2>
      <form id="add-form">
        <div class="add-row">
          <input id="add-name" type="text" placeholder="photo-10.jpeg" />
          <label class="btn btn-gold" id="add-label" for="add-file-input">
            Choose image…
          </label>
          <input id="add-file-input" type="file" accept="image/*" style="display:none" />
          <button type="submit" class="btn btn-green">Upload</button>
        </div>
        <div id="chosen-name"></div>
        <div id="add-status"></div>
      </form>
    </div>
  </main>

  <script>
    // Replace existing photo
    document.querySelectorAll('.replace-form').forEach(form => {
      const slot   = form.dataset.slot;
      const input  = form.querySelector('.file-input');
      const status = form.querySelector('.status');
      const img    = form.closest('.card').querySelector('img');

      input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        status.textContent = 'Uploading…';
        status.className   = 'status loading';
        const fd = new FormData();
        fd.append('photo', file);
        fd.append('filename', slot);
        try {
          const r = await fetch('/admin/images/upload', { method: 'POST', body: fd });
          const j = await r.json();
          if (r.ok) {
            status.textContent = '✓ Done! Refreshing preview…';
            status.className   = 'status ok';
            setTimeout(() => { img.src = '/images/' + encodeURIComponent(slot) + '?t=' + Date.now(); }, 400);
          } else {
            status.textContent = '✗ ' + (j.error || 'Upload failed');
            status.className   = 'status err';
          }
        } catch (e) {
          status.textContent = '✗ Network error';
          status.className   = 'status err';
        }
        input.value = '';
      });
    });

    // Add new photo
    const addForm  = document.getElementById('add-form');
    const addFile  = document.getElementById('add-file-input');
    const addName  = document.getElementById('add-name');
    const addSt    = document.getElementById('add-status');
    const chosenNm = document.getElementById('chosen-name');

    addFile.addEventListener('change', () => {
      if (addFile.files[0]) {
        chosenNm.textContent = 'Selected: ' + addFile.files[0].name;
        if (!addName.value) addName.value = addFile.files[0].name;
      }
    });

    addForm.addEventListener('submit', async e => {
      e.preventDefault();
      const file = addFile.files[0];
      if (!file) { addSt.textContent = 'Please choose an image file first.'; return; }
      let name = addName.value.trim() || file.name;
      if (!/\\.(jpe?g|png|webp|gif)$/i.test(name)) name += '.jpeg';
      addSt.textContent = 'Uploading…';
      const fd = new FormData();
      fd.append('photo', file);
      fd.append('filename', name);
      try {
        const r = await fetch('/admin/images/upload', { method: 'POST', body: fd });
        const j = await r.json();
        addSt.textContent = r.ok
          ? '✓ Saved as ' + name + '. Reload the page to see it in the grid above.'
          : '✗ ' + (j.error || 'Upload failed');
        if (r.ok) { addForm.reset(); chosenNm.textContent = ''; }
      } catch (e) {
        addSt.textContent = '✗ Network error';
      }
    });
  </script>
</body>
</html>`);
});

// ── Admin: Image upload endpoint ───────────────────────────────────────────────
app.post('/admin/images/upload', requireAdmin, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });

  const rawName = (req.body && req.body.filename) ? req.body.filename : req.file.originalname;
  const name    = safeName(rawName);
  if (!name) return res.status(400).json({ error: 'Invalid filename' });

  const dest = path.join(IMAGES_DIR, name);
  try {
    fs.writeFileSync(dest, req.file.buffer);
    console.log('[Admin] Image saved:', name, `(${req.file.buffer.length} bytes)`);
    res.json({ ok: true, filename: name });
  } catch (err) {
    console.error('[Admin] Write error:', err);
    res.status(500).json({ error: 'Failed to save file' });
  }
});

// ── Static files & fallback ───────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[Server] Running on http://localhost:${PORT}`);
  console.log(`[Server] NODE_ENV = ${process.env.NODE_ENV || 'development'}`);
  console.log(`[Server] Image Manager → /admin/images`);
});
