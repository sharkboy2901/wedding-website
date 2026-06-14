'use strict';

/* Gallery — two views, switchable via a toggle (top-right):
   • "Moving"  (default): three rows of photos + note tiles. Each row is a real
     horizontal scroller that auto-advances and that the visitor can drag with a
     finger; dragging one row pauses just that row while the others keep moving.
   • "Still": the full wall of photos + notes, static, in a random order
     (reshuffled on each page load).
   The page always opens on "Moving". Clicking any photo opens it in a lightbox.
   Progressive enhancement: with JS off, the plain gallery markup remains. */
(function () {
  var grid = document.querySelector('.gallery-grid');
  if (!grid) return;
  var originals = Array.prototype.slice.call(grid.querySelectorAll('.gallery-item'));
  if (originals.length === 0) return;

  /* ── Lightbox slide list (index travels with each tile + its clones) ─────── */
  var slides = originals.map(function (item, i) {
    item.setAttribute('data-gallery-index', i);
    var img = item.querySelector('img');
    var cap = item.querySelector('.gallery-caption');
    return {
      src:     img ? img.src : '',
      alt:     img ? img.alt : '',
      caption: cap ? cap.textContent.trim() : '',
    };
  });

  /* ── Note tiles (one per unique guest note) ─────────────────────────────── */
  var noteTiles = [];
  originals.forEach(function (item) {
    var msgEl = item.querySelector('.gallery-msg');
    if (!msgEl || !msgEl.textContent.trim()) return;
    var nameEl = item.querySelector('.gallery-name');
    var tile = document.createElement('div');
    tile.className = 'gallery-item gallery-item--note';
    var q = document.createElement('p');
    q.className = 'gallery-note-msg';
    q.textContent = msgEl.textContent.trim();
    tile.appendChild(q);
    if (nameEl && nameEl.textContent.trim()) {
      var nm = document.createElement('span');
      nm.className = 'gallery-note-name';
      nm.textContent = nameEl.textContent.trim();
      tile.appendChild(nm);
    }
    noteTiles.push(tile);
  });

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // Templates to clone from (we always render clones so tiles can appear in any
  // view/row freely). data-gallery-index is preserved by cloneNode.
  var pool = originals.concat(noteTiles);

  function cloneTile(t, focusable) {
    var c = t.cloneNode(true);
    var im = c.querySelector('img');
    if (im) im.loading = 'eager';   // off-screen tiles must still load/show
    if (!focusable) {
      c.setAttribute('aria-hidden', 'true');
      Array.prototype.forEach.call(c.querySelectorAll('button'), function (b) { b.tabIndex = -1; });
    }
    return c;
  }

  // Render via clones; remove the server-rendered originals.
  originals.forEach(function (it) { if (it.parentNode) it.parentNode.removeChild(it); });

  var rafId = null;
  var dragSuppressUntil = 0;   // briefly ignore the click that ends a mouse drag (so it doesn't open the lightbox)
  function stopRAF() { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
  function clearGrid() {
    stopRAF();
    grid.classList.remove('gallery-grid--rows', 'gallery-grid--wall');
    while (grid.firstChild) grid.removeChild(grid.firstChild);
  }

  /* ── VIEW 1: moving rows (auto-advance + manual drag) ───────────────────── */
  var SPEED = 36;            // px per second (auto-advance) — gentle, slightly quick
  var DIRS  = [-1, 1, -1];   // row directions: -1 ⇒ drifts right, +1 ⇒ drifts left
  var ROW_COUNT = 3;

  function renderRows() {
    clearGrid();
    grid.classList.add('gallery-grid--rows');

    var rowsWrap = document.createElement('div');
    rowsWrap.className = 'gallery-rows';

    var src = shuffle(pool);
    var rowsBase = [];
    var i;
    for (i = 0; i < ROW_COUNT; i++) rowsBase.push([]);
    if (src.length >= ROW_COUNT * 2) {
      src.forEach(function (t, idx) { rowsBase[idx % ROW_COUNT].push(t); }); // unique split
    } else {
      for (i = 0; i < ROW_COUNT; i++) rowsBase[i] = shuffle(src);
    }

    var rows = [];
    rowsBase.forEach(function (base, idx) {
      var row = document.createElement('div');
      row.className = 'gallery-row';
      var track = document.createElement('div');
      track.className = 'gallery-row-track';

      var n = base.length;
      var reps = Math.max(1, Math.ceil(12 / n));   // ~12 tiles per half to fill wide screens
      for (var copy = 0; copy < 2; copy++) {
        for (var rep = 0; rep < reps; rep++) {
          var primary = (copy === 0 && rep === 0);
          base.forEach(function (t) { track.appendChild(cloneTile(t, primary)); });
        }
      }
      row.appendChild(track);
      rowsWrap.appendChild(row);

      var state = { row: row, track: track, dir: DIRS[idx % DIRS.length], mode: 'auto', pos: 0, lastSL: 0, stable: 0 };
      function settle() { state.mode = 'settling'; state.lastSL = row.scrollLeft; state.stable = 0; }

      // Touch: let the browser scroll natively; just track when to resume.
      row.addEventListener('touchstart',  function () { state.mode = 'touch'; }, { passive: true });
      row.addEventListener('touchend',    settle, { passive: true });
      row.addEventListener('touchcancel', settle, { passive: true });
      row.addEventListener('wheel',       settle, { passive: true });

      // Mouse: click-and-drag to scroll (native scrollers don't drag with a mouse).
      var drag = false, startX = 0, startSL = 0;
      row.addEventListener('pointerdown', function (e) {
        if (e.pointerType !== 'mouse') { state.mode = 'touch'; return; }
        drag = true; startX = e.clientX; startSL = row.scrollLeft; state.mode = 'touch';
        row.classList.add('is-grabbing');
        try { row.setPointerCapture(e.pointerId); } catch (_) {}
      });
      row.addEventListener('pointermove', function (e) {
        if (!drag) return;
        var dx = e.clientX - startX;
        if (Math.abs(dx) > 3) dragSuppressUntil = performance.now() + 300;   // it's a drag, not a click
        row.scrollLeft = startSL - dx;
      });
      function endMouse(e) {
        if (e.pointerType !== 'mouse') { settle(); return; }
        if (!drag) return;
        drag = false; row.classList.remove('is-grabbing');
        try { row.releasePointerCapture(e.pointerId); } catch (_) {}
        settle();
      }
      row.addEventListener('pointerup', endMouse);
      row.addEventListener('pointercancel', endMouse);

      rows.push(state);
    });

    grid.appendChild(rowsWrap);

    var last = performance.now();
    function frame(now) {
      var dt = (now - last) / 1000; last = now;
      if (dt > 0.1) dt = 0.1;                       // clamp after tab was hidden
      rows.forEach(function (r) {
        var halfW = r.track.scrollWidth / 2;
        if (halfW <= 0) return;
        if (r.mode === 'touch') return;              // being dragged → hold still
        if (r.mode === 'settling') {
          // Let the native momentum/fling finish on its own; only resume the
          // auto-advance once the row has actually come to rest, so we never
          // fight the native scroll (that was the "wonky" feeling).
          var cur = r.row.scrollLeft;
          if (Math.abs(cur - r.lastSL) < 0.4) { r.stable++; } else { r.stable = 0; r.lastSL = cur; }
          if (r.stable >= 5) { r.mode = 'auto'; r.pos = r.row.scrollLeft; }   // sync float position
          return;
        }
        // Track the position as a float and write it out, so sub-pixel steps
        // accumulate even on 1× DPI desktops (where scrollLeft is whole-pixel).
        r.pos += r.dir * SPEED * dt;
        r.pos = ((r.pos % halfW) + halfW) % halfW;   // wrap within one half → seamless loop
        r.row.scrollLeft = r.pos;
      });
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);
  }

  /* ── VIEW 2: still wall (static, random order) ──────────────────────────── */
  function renderWall() {
    clearGrid();
    grid.classList.add('gallery-grid--wall');
    shuffle(pool).forEach(function (t) { grid.appendChild(cloneTile(t, true)); });
  }

  /* ── View toggle (top-right) ────────────────────────────────────────────── */
  var current = 'rows';
  var toggle = document.createElement('div');
  toggle.className = 'gallery-view-toggle';
  toggle.setAttribute('role', 'group');
  toggle.setAttribute('aria-label', 'Gallery view');
  toggle.innerHTML =
    '<button type="button" data-view="rows">&#8652; Moving</button>' +
    '<button type="button" data-view="wall">&#9638; Still</button>';
  grid.parentNode.insertBefore(toggle, grid);

  /* ── Elegant "you can scroll" hint (shown once per device) ──────────────── */
  var HINT_KEY = 'mk_gallery_hint_seen';
  var hint = document.createElement('div');
  hint.className = 'gallery-hint';
  hint.setAttribute('role', 'status');
  hint.innerHTML =
    '<span class="gallery-hint-arrow" aria-hidden="true">&#8249;</span>' +
    '<span class="gallery-hint-text">Drag or swipe to explore</span>' +
    '<span class="gallery-hint-arrow" aria-hidden="true">&#8250;</span>';
  grid.parentNode.insertBefore(hint, grid);

  var hintTimer = null, hintGone = false;
  function dismissHint() {
    if (hintGone) return;
    hintGone = true;
    clearTimeout(hintTimer);
    hint.classList.remove('is-visible');
    setTimeout(function () { if (hint.parentNode) hint.parentNode.removeChild(hint); }, 700);
  }
  function maybeShowHint() {
    if (hintGone) return;
    var seen = false;
    try { seen = localStorage.getItem(HINT_KEY) === '1'; } catch (_) {}
    if (seen) { dismissHint(); return; }
    try { localStorage.setItem(HINT_KEY, '1'); } catch (_) {}
    requestAnimationFrame(function () { hint.classList.add('is-visible'); });
    hintTimer = setTimeout(dismissHint, 6000);
  }
  // Any interaction with the rows dismisses it immediately.
  ['touchstart', 'pointerdown', 'wheel'].forEach(function (ev) {
    grid.addEventListener(ev, dismissHint, { passive: true });
  });

  function updateToggle(v) {
    Array.prototype.forEach.call(toggle.querySelectorAll('button'), function (b) {
      var on = b.getAttribute('data-view') === v;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function setView(v) {
    current = v;
    if (v === 'wall') { renderWall(); dismissHint(); }
    else { renderRows(); maybeShowHint(); }
    updateToggle(v);
  }
  toggle.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button');
    if (!b) return;
    var v = b.getAttribute('data-view');
    if (v && v !== current) setView(v);
  });

  setView('rows');   // always open on the moving rows

  /* ── Lightbox (delegated; works in both views) ──────────────────────────── */
  var lightbox = document.getElementById('lightbox');
  if (!lightbox) return;

  var lbImg    = document.getElementById('lightbox-img');
  var lbCap    = document.getElementById('lightbox-caption');
  var closeBtn = lightbox.querySelector('.lightbox-close');
  var prevBtn  = lightbox.querySelector('.lightbox-prev');
  var nextBtn  = lightbox.querySelector('.lightbox-next');
  var lbCurrent = 0;

  function openAt(idx) {
    lbCurrent = (idx + slides.length) % slides.length;
    var s = slides[lbCurrent];
    lbImg.src = s.src;
    lbImg.alt = s.alt;
    lbCap.textContent = s.caption;
    lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
    if (closeBtn) closeBtn.focus();
  }
  function close() {
    lightbox.hidden = true;
    document.body.style.overflow = '';
  }

  document.addEventListener('click', function (e) {
    if (performance.now() < dragSuppressUntil) return;   // ignore the click that ends a drag
    var btn = e.target.closest && e.target.closest('.gallery-thumb-btn');
    if (!btn) return;
    var item = btn.closest('.gallery-item');
    if (!item) return;
    var idx = parseInt(item.getAttribute('data-gallery-index'), 10);
    if (isNaN(idx)) return;
    openAt(idx);
  });

  if (closeBtn) closeBtn.addEventListener('click', close);
  if (prevBtn)  prevBtn.addEventListener('click', function () { openAt(lbCurrent - 1); });
  if (nextBtn)  nextBtn.addEventListener('click', function () { openAt(lbCurrent + 1); });

  lightbox.addEventListener('click', function (e) { if (e.target === lightbox) close(); });
  document.addEventListener('keydown', function (e) {
    if (lightbox.hidden) return;
    if (e.key === 'Escape')     close();
    if (e.key === 'ArrowLeft')  openAt(lbCurrent - 1);
    if (e.key === 'ArrowRight') openAt(lbCurrent + 1);
  });
})();
