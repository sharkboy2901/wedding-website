'use strict';

/* Gallery Lightbox — loaded from external file to comply with CSP */
(function () {
  var items    = Array.from(document.querySelectorAll('.gallery-thumb-btn'));
  var lightbox = document.getElementById('lightbox');
  if (!lightbox || items.length === 0) return;

  var lbImg    = document.getElementById('lightbox-img');
  var lbCap    = document.getElementById('lightbox-caption');
  var closeBtn = document.querySelector('.lightbox-close');
  var prevBtn  = document.querySelector('.lightbox-prev');
  var nextBtn  = document.querySelector('.lightbox-next');
  var current  = 0;

  function openAt(idx) {
    current = idx;
    var item = items[idx];
    var img  = item.querySelector('img');
    var cap  = item.closest('.gallery-item').querySelector('.gallery-caption');
    lbImg.src    = img.src;
    lbImg.alt    = img.alt;
    lbCap.textContent = cap ? cap.textContent : '';
    lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
    if (closeBtn) closeBtn.focus();
  }

  function close() {
    lightbox.hidden = true;
    document.body.style.overflow = '';
    items[current].focus();
  }

  items.forEach(function (btn, idx) {
    btn.addEventListener('click', function () { openAt(idx); });
  });
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (prevBtn)  prevBtn.addEventListener('click',  function () { openAt((current - 1 + items.length) % items.length); });
  if (nextBtn)  nextBtn.addEventListener('click',  function () { openAt((current + 1) % items.length); });

  lightbox.addEventListener('click', function (e) { if (e.target === lightbox) close(); });
  document.addEventListener('keydown', function (e) {
    if (lightbox.hidden) return;
    if (e.key === 'Escape')     close();
    if (e.key === 'ArrowLeft')  openAt((current - 1 + items.length) % items.length);
    if (e.key === 'ArrowRight') openAt((current + 1) % items.length);
  });
})();

/* Gallery Mosaic — varied tile sizes based on each photo's natural shape.
   Progressive enhancement: turns the column layout into a CSS-grid masonry so
   portrait photos are taller, landscape photos are wider (spanning two
   columns), giving an organic "bigger / smaller" arrangement. Each image keeps
   its true aspect ratio (no cropping). Falls back to the plain layout if JS
   is off. */
(function () {
  var grid = document.querySelector('.gallery-grid');
  if (!grid) return;
  var items = Array.prototype.slice.call(grid.querySelectorAll('.gallery-item'));
  if (items.length === 0) return;

  var ROW = 10;  // must match grid-auto-rows in CSS
  var GAP = 14;  // must match grid gap in CSS

  function columnsCount() {
    var w = window.innerWidth;
    if (w >= 1100) return 4;
    if (w >= 768)  return 3;
    return 2;
  }

  // Wide tiles for clearly landscape photos — but only when there are enough
  // columns that a 2-column tile still leaves room for variety.
  function sizeItem(item) {
    var img = item.querySelector('img');
    var wide = false;
    if (img && img.naturalWidth && img.naturalHeight) {
      var ratio = img.naturalWidth / img.naturalHeight;
      wide = ratio >= 1.5 && columnsCount() >= 3;
    }
    item.classList.toggle('gallery-item--wide', wide);
  }

  // Row span = how many base rows this tile's real height occupies.
  function spanItem(item) {
    var h = item.offsetHeight; // layout height, unaffected by the float transform
    if (!h) return;
    var span = Math.max(1, Math.ceil((h + GAP) / (ROW + GAP)));
    item.style.gridRowEnd = 'span ' + span;
  }

  function layout() {
    grid.classList.add('gallery-grid--mosaic');
    items.forEach(sizeItem);
    // Measure after the new column widths have been applied.
    requestAnimationFrame(function () { items.forEach(spanItem); });
  }

  layout();

  // Re-measure each image once it has actually loaded (heights then accurate).
  items.forEach(function (item) {
    var img = item.querySelector('img');
    if (img && !img.complete) {
      img.addEventListener('load',  function () { sizeItem(item); spanItem(item); });
      img.addEventListener('error', function () { spanItem(item); });
    }
  });

  window.addEventListener('load', layout);

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layout, 150);
  });
})();
