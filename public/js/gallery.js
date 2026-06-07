'use strict';

/* Gallery — elegant varied-size mosaic (all photos shown at once) where each
   photo gently drifts around on its own (the CSS animation handles the motion),
   plus a click-to-zoom lightbox.

   - Mosaic: a CSS-grid masonry sized to each photo's real shape (portrait
     taller, landscape wider), keeping true aspect ratios. Every photo stays
     present at the same time.
   - Lightbox: delegated clicks open the right photo; navigation runs over the
     full photo list.
   Progressive enhancement: with JS off, the plain column gallery remains. */
(function () {
  var grid = document.querySelector('.gallery-grid');
  if (!grid) return;
  var items = Array.prototype.slice.call(grid.querySelectorAll('.gallery-item'));
  if (items.length === 0) return;

  /* ── Slide list for the lightbox ────────────────────────────────────────── */
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

  /* ── Mosaic layout (varied tile sizes; all photos visible) ──────────────── */
  var ROW = 10;  // must match grid-auto-rows in CSS
  var GAP = 18;  // must match grid gap in CSS

  function columnsCount() {
    var w = window.innerWidth;
    if (w >= 1100) return 4;
    if (w >= 768)  return 3;
    return 2;
  }
  function sizeItem(item) {
    var img = item.querySelector('img');
    var wide = false;
    if (img && img.naturalWidth && img.naturalHeight) {
      wide = (img.naturalWidth / img.naturalHeight) >= 1.5 && columnsCount() >= 3;
    }
    item.classList.toggle('gallery-item--wide', wide);
  }
  function spanItem(item) {
    var h = item.offsetHeight;  // layout height, unaffected by the drift transform
    if (!h) return;
    item.style.gridRowEnd = 'span ' + Math.max(1, Math.ceil((h + GAP) / (ROW + GAP)));
  }
  function mosaic() {
    grid.classList.add('gallery-grid--mosaic');
    items.forEach(sizeItem);
    requestAnimationFrame(function () { items.forEach(spanItem); });
  }

  mosaic();
  items.forEach(function (item) {
    var img = item.querySelector('img');
    if (img && !img.complete) {
      img.addEventListener('load',  function () { sizeItem(item); spanItem(item); });
      img.addEventListener('error', function () { spanItem(item); });
    }
  });
  window.addEventListener('load', mosaic);

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(mosaic, 150);
  });

  /* ── Lightbox (delegated) ───────────────────────────────────────────────── */
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
    if (closeBtn) closeBtn.focus();
  }
  function close() {
    lightbox.hidden = true;
    document.body.style.overflow = '';
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
