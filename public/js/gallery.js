'use strict';

/* Gallery — a "gliding slideshow wall": every photo is on screen at once in an
   equal-size tile grid, and every few seconds the whole wall shifts down by one
   position on a loop, so the tiles smoothly glide to their new spots (the last
   tile wraps back to the front). Plus a click-to-zoom lightbox.

   The glide uses the Web Animations API (element.animate) so it runs smoothly
   on every device, including phones that request reduced motion. Progressive
   enhancement: with JS off, the plain column gallery remains. */
(function () {
  var grid = document.querySelector('.gallery-grid');
  if (!grid) return;
  var items = Array.prototype.slice.call(grid.querySelectorAll('.gallery-item'));
  if (items.length === 0) return;

  /* ── Slide list for the lightbox (index stays with each element) ─────────── */
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

  /* ── Equal-size tile wall ───────────────────────────────────────────────── */
  grid.classList.add('gallery-grid--slideshow');

  /* ── Gliding loop (every tile moves down one position) ──────────────────── */
  var STEP_MS = 4000;   // time between steps
  var GLIDE_MS = 1100;  // how long the glide takes
  var order = items.slice();
  var paused = false;
  var animating = false;

  // Shift every tile forward one position; the last tile wraps back to the
  // front — so the whole wall cycles "down by one" on a loop.
  function rotateDown(arr) {
    var a = arr.slice();
    a.unshift(a.pop());
    return a;
  }

  function step() {
    if (paused || animating || order.length < 2) return;
    if (document.hidden) return;                 // don't animate on a hidden tab

    // FIRST: where each tile is now.
    var firstRects = order.map(function (it) { return it.getBoundingClientRect(); });

    // Re-order the tiles in the DOM (so the grid relays them out).
    var newOrder = rotateDown(order);
    newOrder.forEach(function (it) { grid.appendChild(it); });

    // LAST + INVERT + PLAY: glide each tile from its old spot to the new one.
    animating = true;
    var maxEnd = 0;
    newOrder.forEach(function (it, newIdx) {
      var oldIdx = order.indexOf(it);
      var firstR = firstRects[oldIdx];
      var lastR  = it.getBoundingClientRect();
      var dx = firstR.left - lastR.left;
      var dy = firstR.top  - lastR.top;
      if (dx || dy) {
        it.animate(
          [
            { transform: 'translate(' + dx + 'px,' + dy + 'px)' },
            { transform: 'translate(0,0)' }
          ],
          { duration: GLIDE_MS, easing: 'cubic-bezier(0.45, 0, 0.2, 1)' }
        );
        maxEnd = GLIDE_MS;
      }
    });
    order = newOrder;
    setTimeout(function () { animating = false; }, maxEnd + 30);
  }

  var timer = setInterval(step, STEP_MS);

  // Pause while hovering (so a tile is easy to click) and when the tab is hidden.
  grid.addEventListener('mouseenter', function () { paused = true; });
  grid.addEventListener('mouseleave', function () { paused = false; });

  /* ── Lightbox (delegated; index travels with each tile) ─────────────────── */
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
    paused = true;                 // hold the reshuffle while viewing
    if (closeBtn) closeBtn.focus();
  }
  function close() {
    lightbox.hidden = true;
    document.body.style.overflow = '';
    paused = false;
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
