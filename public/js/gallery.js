'use strict';

/* Gallery — elegant varied-size mosaic that gently auto-scrolls as a looping
   wall, plus a click-to-zoom lightbox.

   - Mosaic: a CSS-grid masonry sized to each photo's real shape (portrait
     taller, landscape wider), keeping true aspect ratios.
   - Auto-scrolling wall: the mosaic is wrapped in a fixed-height viewport with
     a second identical copy stacked beneath it; the pair scrolls upward and
     loops seamlessly. Pauses on hover. Only enabled when there are enough
     photos to fill more than the viewport.
   - Lightbox: delegated clicks so both the original and the duplicated copy
     open the right photo; navigation runs over the unique photo list.
   Progressive enhancement: with JS off, the plain column gallery remains. */
(function () {
  var grid = document.querySelector('.gallery-grid');
  if (!grid) return;
  var items = Array.prototype.slice.call(grid.querySelectorAll('.gallery-item'));
  if (items.length === 0) return;

  /* ── Unique slide list for the lightbox (built before any cloning) ───────── */
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

  /* ── Mosaic layout ──────────────────────────────────────────────────────── */
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
    var h = item.offsetHeight;
    if (!h) return;
    item.style.gridRowEnd = 'span ' + Math.max(1, Math.ceil((h + GAP) / (ROW + GAP)));
  }
  function mosaic() {
    grid.classList.add('gallery-grid--mosaic');
    items.forEach(sizeItem);
    items.forEach(spanItem);
  }

  /* ── Auto-scrolling wall ────────────────────────────────────────────────── */
  var scroller = null, track = null, clone = null;

  function teardown() {
    if (!scroller) return;
    scroller.parentNode.insertBefore(grid, scroller); // move the real grid back
    scroller.parentNode.removeChild(scroller);
    scroller = null; track = null; clone = null;
  }

  function apply() {
    teardown();
    mosaic();

    var viewportH = Math.min(window.innerHeight * 0.8, 860);
    // Not enough photos to fill the viewport → leave the mosaic static.
    if (grid.offsetHeight <= viewportH + 40) return;

    scroller = document.createElement('div');
    scroller.className = 'gallery-scroller';
    track = document.createElement('div');
    track.className = 'gallery-scroll-track';

    grid.parentNode.insertBefore(scroller, grid);
    track.appendChild(grid);

    var copyHeight = grid.offsetHeight;
    clone = grid.cloneNode(true);                 // inherits the computed spans
    clone.setAttribute('aria-hidden', 'true');
    Array.prototype.forEach.call(clone.querySelectorAll('button'), function (b) { b.tabIndex = -1; });
    track.appendChild(clone);
    scroller.appendChild(track);

    var distance = copyHeight + 18;               // one copy + the gap between copies
    var dur = Math.max(25, Math.round(distance / 45)); // ~45px per second
    track.style.setProperty('--scroll-distance', distance + 'px');
    track.style.setProperty('--scroll-dur', dur + 's');
  }

  function init() { apply(); }
  if (document.readyState === 'complete') { init(); }
  else { window.addEventListener('load', init); }

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(apply, 200);
  });

  /* ── Lightbox (delegated — works on the original and the cloned copy) ────── */
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
