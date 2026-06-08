'use strict';

/* Gallery — "Custom Wall Design 2": two horizontal rows of photos and note
   tiles sliding continuously in opposite directions (top row → right, bottom
   row → left), looping seamlessly, plus a click-to-zoom lightbox.

   Photos keep their natural width at a fixed row height; each guest note is a
   wider card. Photos and notes are mixed at random across the two rows. The
   rows pause on hover and while the lightbox is open. Progressive enhancement:
   with JS off, the plain column gallery remains. */
(function () {
  var grid = document.querySelector('.gallery-grid');
  if (!grid) return;
  var items = Array.prototype.slice.call(grid.querySelectorAll('.gallery-item'));
  if (items.length === 0) return;

  var GAP = 12;  // must match the row-track gap in CSS

  /* ── Slides for the lightbox (index travels with each photo + its clones) ── */
  var slides = items.map(function (item, i) {
    item.setAttribute('data-gallery-index', i);
    var img = item.querySelector('img');
    var cap = item.querySelector('.gallery-caption');
    return {
      src:     img ? img.src : '',
      alt:     img ? img.alt : '',
      caption: cap ? cap.textContent.trim() : '',
    };
  });

  /* ── Note tiles — each unique guest note as a wider card ────────────────── */
  var noteTiles = [];
  items.forEach(function (item) {
    var msgEl = item.querySelector('.gallery-msg');
    if (!msgEl || !msgEl.textContent.trim()) return;
    var nameEl = item.querySelector('.gallery-name');
    var tile = document.createElement('div');
    tile.className = 'gallery-item gallery-item--note';
    var quote = document.createElement('p');
    quote.className = 'gallery-note-msg';
    quote.textContent = msgEl.textContent.trim();
    tile.appendChild(quote);
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

  /* ── Mix photos + notes, then split across THREE rows ───────────────────────
     With enough tiles, each photo/note is placed in exactly one row (no
     duplicates anywhere on the wall). For a very small gallery we fall back to
     filling every row with the whole set so the rows still look full — even
     then a single row never repeats a tile, so no two identical tiles sit next
     to each other. */
  var ROW_COUNT = 3;
  var pool = shuffle(items.concat(noteTiles));
  var rowsBase = [];
  var ri;
  for (ri = 0; ri < ROW_COUNT; ri++) rowsBase.push([]);

  if (pool.length >= ROW_COUNT * 2) {
    pool.forEach(function (t, i) { rowsBase[i % ROW_COUNT].push(t); });   // unique split
  } else {
    for (ri = 0; ri < ROW_COUNT; ri++) {
      rowsBase[ri] = shuffle(pool).map(function (t) { return ri === 0 ? t : t.cloneNode(true); });
    }
  }

  grid.classList.add('gallery-grid--rows');
  var rowsWrap = document.createElement('div');
  rowsWrap.className = 'gallery-rows';

  var DIRECTIONS = ['gallery-row--right', 'gallery-row--left', 'gallery-row--right'];
  var rows = rowsBase.map(function (base, idx) {
    var row = document.createElement('div');
    row.className = 'gallery-row ' + DIRECTIONS[idx % DIRECTIONS.length];
    var track = document.createElement('div');
    track.className = 'gallery-row-track';
    row.appendChild(track);
    rowsWrap.appendChild(row);
    return { track: track, base: base };
  });
  grid.appendChild(rowsWrap);

  // Lay out a row: the base tiles once, then enough duplicates to fill the
  // width and loop seamlessly. Base tiles stay clickable/focusable; the loop
  // duplicates are hidden from keyboard/AT to avoid repeated tab stops.
  function layoutRow(r) {
    if (!r.base.length) return;
    while (r.track.firstChild) r.track.removeChild(r.track.firstChild);
    r.base.forEach(function (t) { r.track.appendChild(t); });

    var copyW = r.track.scrollWidth;
    if (!copyW) return;
    var viewport = (r.track.parentNode && r.track.parentNode.clientWidth) || window.innerWidth;
    var copies = Math.max(2, Math.ceil((viewport + copyW) / copyW));
    for (var k = 1; k < copies; k++) {
      r.base.forEach(function (t) {
        var c = t.cloneNode(true);
        c.setAttribute('aria-hidden', 'true');
        Array.prototype.forEach.call(c.querySelectorAll('button'), function (b) { b.tabIndex = -1; });
        r.track.appendChild(c);
      });
    }
    var distance = copyW + GAP;                 // animate by exactly one copy
    r.track.style.setProperty('--row-distance', distance + 'px');
    r.track.style.setProperty('--row-dur', Math.max(18, Math.round(distance / 38)) + 's');
  }

  function layoutAll() { rows.forEach(layoutRow); }

  if (document.readyState === 'complete') layoutAll();
  else window.addEventListener('load', layoutAll);

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layoutAll, 200);
  });

  /* ── Lightbox (delegated; works for originals and clones) ───────────────── */
  var lightbox = document.getElementById('lightbox');
  if (!lightbox) return;

  var lbImg    = document.getElementById('lightbox-img');
  var lbCap    = document.getElementById('lightbox-caption');
  var closeBtn = lightbox.querySelector('.lightbox-close');
  var prevBtn  = lightbox.querySelector('.lightbox-prev');
  var nextBtn  = lightbox.querySelector('.lightbox-next');
  var current  = 0;

  function openAt(idx) {
    current = (idx + slides.length) % slides.length;
    var s = slides[current];
    lbImg.src = s.src;
    lbImg.alt = s.alt;
    lbCap.textContent = s.caption;
    lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
    rowsWrap.classList.add('is-paused');
    if (closeBtn) closeBtn.focus();
  }
  function close() {
    lightbox.hidden = true;
    document.body.style.overflow = '';
    rowsWrap.classList.remove('is-paused');
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.gallery-thumb-btn');
    if (!btn) return;
    var item = btn.closest('.gallery-item');
    if (!item) return;
    var idx = parseInt(item.getAttribute('data-gallery-index'), 10);
    if (isNaN(idx)) return;
    openAt(idx);
  });

  if (closeBtn) closeBtn.addEventListener('click', close);
  if (prevBtn)  prevBtn.addEventListener('click', function () { openAt(current - 1); });
  if (nextBtn)  nextBtn.addEventListener('click', function () { openAt(current + 1); });

  lightbox.addEventListener('click', function (e) { if (e.target === lightbox) close(); });
  document.addEventListener('keydown', function (e) {
    if (lightbox.hidden) return;
    if (e.key === 'Escape')     close();
    if (e.key === 'ArrowLeft')  openAt(current - 1);
    if (e.key === 'ArrowRight') openAt(current + 1);
  });
})();
