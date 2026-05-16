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
    lbCap.innerHTML = cap ? cap.innerHTML : '';
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
