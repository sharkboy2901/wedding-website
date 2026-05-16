'use strict';

/* ── Countdown Timer ────────────────────────────────────────────────────────── */
(function () {
  var countdownSection = document.querySelector('.countdown-section');
  var weddingDate = countdownSection ? countdownSection.getAttribute('data-wedding-date') : null;
  if (!weddingDate) return;

  var target = new Date(weddingDate + 'T00:00:00');
  var daysEl  = document.getElementById('cd-days');
  var hoursEl = document.getElementById('cd-hours');
  var minsEl  = document.getElementById('cd-mins');
  var secsEl  = document.getElementById('cd-secs');
  if (!daysEl) return;

  function pad(n) { return String(n).padStart(2, '0'); }

  function tick() {
    var now  = new Date();
    var diff = target - now;
    if (diff <= 0) {
      daysEl.textContent = hoursEl.textContent = minsEl.textContent = secsEl.textContent = '00';
      return;
    }
    daysEl.textContent  = String(Math.floor(diff / 86400000));
    hoursEl.textContent = pad(Math.floor((diff % 86400000) / 3600000));
    minsEl.textContent  = pad(Math.floor((diff % 3600000)  / 60000));
    secsEl.textContent  = pad(Math.floor((diff % 60000)    / 1000));
  }
  tick();
  setInterval(tick, 1000);
})();

/* ── Mobile Navigation Toggle ───────────────────────────────────────────────── */
(function () {
  var toggle = document.querySelector('.nav-toggle');
  var nav    = document.querySelector('.main-nav');
  if (!toggle || !nav) return;

  toggle.addEventListener('click', function () {
    var isOpen = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(isOpen));
    document.body.style.overflow = isOpen ? 'hidden' : '';
  });

  nav.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', function () {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    });
  });

  window.addEventListener('resize', function () {
    if (window.innerWidth >= 700) {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && nav.classList.contains('open')) {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
      toggle.focus();
    }
  });
})();
