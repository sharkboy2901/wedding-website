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

/* Gallery Ring — arrange every photo evenly around a circle and let the whole
   ring rotate slowly (the CSS animation does the spinning). Progressive
   enhancement: if JS is off, the plain column gallery remains. */
(function () {
  var grid = document.querySelector('.gallery-grid');
  if (!grid) return;
  var items = Array.prototype.slice.call(grid.querySelectorAll('.gallery-item'));
  if (items.length === 0) return;

  // Move all photos into a rotor element that CSS spins.
  grid.classList.add('gallery-ring');
  var rotor = document.createElement('div');
  rotor.className = 'gallery-ring-rotor';
  items.forEach(function (it) { rotor.appendChild(it); });
  grid.appendChild(rotor);

  function layout() {
    var W = grid.clientWidth;
    if (!W) return;
    var n = items.length;

    // Item size shrinks as the photo count grows so they don't overlap; radius
    // is a fixed fraction of the ring so photos sit comfortably inside it.
    var R = W * 0.33;
    var maxSize = Math.min(150, W * 0.30);
    var size = Math.min(maxSize, (2 * Math.PI * R / n) * 0.85);
    size = Math.max(46, size);
    if (R + size * 0.62 > W / 2) R = W / 2 - size * 0.62;  // keep inside the box

    grid.style.setProperty('--ring-item', size + 'px');

    items.forEach(function (it, i) {
      var theta = (360 / n) * i;
      it.style.width = size + 'px';
      // Centre the item on the ring centre, swing out to the rim at its angle.
      it.style.transform =
        'translate(-50%, -50%) rotate(' + theta + 'deg) translate(0, ' + (-R) + 'px)';
    });
  }

  layout();
  window.addEventListener('load', layout);

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layout, 150);
  });
})();
