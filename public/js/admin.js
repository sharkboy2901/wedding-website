'use strict';

(function () {

  var CSRF = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';

  /* ── Toast ───────────────────────────────────────────────────────────────── */

  var toastContainer = document.getElementById('toast-container');

  function showToast(type, message) {
    if (!toastContainer) return;
    var t = document.createElement('div');
    t.className = 'admin-toast admin-toast--' + type;
    t.textContent = message;
    toastContainer.appendChild(t);
    t.offsetHeight; // force reflow for transition
    t.classList.add('admin-toast--show');
    setTimeout(function () {
      t.classList.remove('admin-toast--show');
      setTimeout(function () { t.remove(); }, 300);
    }, 4500);
  }

  /* ── Fetch helper ────────────────────────────────────────────────────────── */

  function doAction(url, extraBody) {
    var params = '_csrf=' + encodeURIComponent(CSRF);
    if (extraBody) params += '&' + extraBody;
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'X-Requested-With': 'xmlhttprequest',
      },
      body: params,
    }).then(function (r) { return r.json(); });
  }

  /* ── Card fade-out ───────────────────────────────────────────────────────── */

  function fadeRemove(card, cb) {
    card.style.transition = 'opacity 0.25s, transform 0.25s';
    card.style.opacity = '0';
    card.style.transform = 'scale(0.95)';
    setTimeout(function () { card.remove(); if (cb) cb(); }, 260);
  }

  /* ── Pending count update ────────────────────────────────────────────────── */

  function updatePendingBadge(delta) {
    var badge = document.querySelector('#pending-heading .badge--warning');
    var statEl = null;
    document.querySelectorAll('.admin-stat').forEach(function (s) {
      if ((s.querySelector('.admin-stat-label') || {}).textContent === 'Pending Photos') {
        statEl = s.querySelector('.admin-stat-num');
      }
    });
    if (badge) {
      var n = parseInt(badge.textContent, 10) + delta;
      if (n <= 0) badge.remove(); else badge.textContent = n;
    }
    if (statEl) statEl.textContent = Math.max(0, parseInt(statEl.textContent, 10) + delta);
  }

  /* ── Re-render approved card action buttons after state change ───────────── */

  function esc(str) {
    return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  }

  function renderApprovedActions(card) {
    var id       = card.dataset.photoId;
    var featured = card.dataset.featured === 'true';
    var hidden   = card.dataset.hidden   === 'true';
    var actionsDiv = card.querySelector('.admin-photo-actions');
    if (!actionsDiv) return;

    var csrfField = '<input type="hidden" name="_csrf" value="' + esc(CSRF) + '">';
    var html = '';

    if (!hidden) {
      if (!featured) {
        html += '<form action="/admin/photo/' + esc(id) + '/feature" method="post" class="photo-action-form">' + csrfField +
                '<button type="submit" class="btn-feature btn--full-width">&#9733; Feature on Home</button></form>';
      } else {
        html += '<form action="/admin/photo/' + esc(id) + '/unfeature" method="post" class="photo-action-form">' + csrfField +
                '<button type="submit" class="btn-unfeature btn--full-width">&#9734; Remove from Home</button></form>';
      }
      html += '<form action="/admin/photo/' + esc(id) + '/hide" method="post" class="photo-action-form">' + csrfField +
              '<button type="submit" class="btn-hide btn--full-width">&#128683; Hide from Gallery</button></form>';
    } else {
      html += '<form action="/admin/photo/' + esc(id) + '/unhide" method="post" class="photo-action-form">' + csrfField +
              '<button type="submit" class="btn-unhide btn--full-width">&#128065; Show in Gallery</button></form>';
    }

    html += '<form action="/admin/photo/' + esc(id) + '/delete" method="post" class="photo-action-form">' + csrfField +
            '<button type="submit" class="btn-reject btn--full-width">Remove</button></form>';

    actionsDiv.innerHTML = html;
    actionsDiv.querySelectorAll('.photo-action-form').forEach(attachActionForm);
  }

  /* ── Re-render approved card badges ─────────────────────────────────────── */

  function renderApprovedBadges(card) {
    var featured = card.dataset.featured === 'true';
    var hidden   = card.dataset.hidden   === 'true';

    card.classList.toggle('admin-photo-card--featured', featured && !hidden);
    card.classList.toggle('admin-photo-card--hidden',   hidden);

    var prevFeat = card.querySelector('.admin-featured-badge');
    var prevHid  = card.querySelector('.admin-hidden-badge');
    if (prevFeat) prevFeat.remove();
    if (prevHid)  prevHid.remove();

    var anchor = card.querySelector('.admin-photo-preview-btn, .admin-photo-thumb');
    if (hidden) {
      var b = document.createElement('div');
      b.className = 'admin-hidden-badge';
      b.textContent = '🚫 Hidden from guests';
      card.insertBefore(b, anchor);
    } else if (featured) {
      var b = document.createElement('div');
      b.className = 'admin-featured-badge';
      b.textContent = '★ Featured on Home';
      card.insertBefore(b, anchor);
    }

    var metaBadge = card.querySelector('.admin-photo-meta .badge');
    if (metaBadge) {
      if (hidden) {
        metaBadge.className = 'badge badge--hidden';
        metaBadge.textContent = '🚫 Hidden';
      } else {
        metaBadge.className = 'badge badge--approved';
        metaBadge.textContent = 'Approved';
      }
    }
  }

  /* ── Single-photo form interception ─────────────────────────────────────── */

  function attachActionForm(form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var url    = form.action;
      var btn    = form.querySelector('button[type="submit"]');
      var card   = form.closest('.admin-photo-card');
      var origTxt = btn ? btn.textContent : '';

      // Confirm potentially surprising actions. Nothing is permanently deleted —
      // declined/removed photos are moved to the Not Approved section.
      if (/\/reject$/.test(url)) {
        if (!confirm('Move this photo to Not Approved? It will be kept (not deleted) and you can still download it.')) return;
      }
      if (/\/delete$/.test(url)) {
        if (!confirm('Remove this photo from the gallery? It will be moved to Not Approved (kept, not deleted).')) return;
      }

      if (btn) { btn.disabled = true; btn.textContent = '…'; }

      doAction(url).then(function (data) {
        if (!data.ok) {
          if (btn) { btn.disabled = false; btn.textContent = origTxt; }
          showToast('error', data.message || 'Something went wrong.');
          return;
        }

        // -- Pending section: approve or reject → remove card --
        if (/\/approve$/.test(url) || /\/reject$/.test(url)) {
          if (card) fadeRemove(card, function () { updatePendingBadge(-1); });
          showToast('success', data.message || 'Done.');
          return;
        }

        // -- Approved section: remove → remove card (moved to Not Approved) --
        if (/\/delete$/.test(url)) {
          if (card) fadeRemove(card);
          showToast('success', data.message || 'Removed.');
          return;
        }

        // -- Approved section: feature / unfeature / hide / unhide → update card --
        if (card) {
          if (/\/feature$/.test(url))   card.dataset.featured = 'true';
          if (/\/unfeature$/.test(url)) card.dataset.featured = 'false';
          if (/\/hide$/.test(url))      card.dataset.hidden   = 'true';
          if (/\/unhide$/.test(url))    card.dataset.hidden   = 'false';
          renderApprovedBadges(card);
          renderApprovedActions(card);
        }
        showToast('success', data.message || 'Done.');
      }).catch(function () {
        if (btn) { btn.disabled = false; btn.textContent = origTxt; }
        showToast('error', 'Network error. Please try again.');
      });
    });
  }

  document.querySelectorAll('.photo-action-form').forEach(attachActionForm);

  /* ── Bulk selection ──────────────────────────────────────────────────────── */

  var bulkBar         = document.getElementById('bulk-bar');
  var bulkBarCount    = document.getElementById('bulk-bar-count');
  var bulkActionInput = document.getElementById('bulk-action-input');
  var bulkApproveBtn  = document.getElementById('bulk-approve-btn');
  var bulkRejectBtn   = document.getElementById('bulk-reject-btn');
  var bulkClearBtn    = document.getElementById('bulk-clear-btn');
  var selectAllBtn    = document.getElementById('select-all-btn');

  function getCheckboxes() {
    return Array.from(document.querySelectorAll('.photo-checkbox'));
  }

  function updateBulkBar() {
    var checked = getCheckboxes().filter(function (cb) { return cb.checked; });
    if (!bulkBar) return;
    bulkBar.hidden = checked.length === 0;
    if (checked.length > 0) {
      bulkBarCount.textContent = checked.length + ' photo' + (checked.length !== 1 ? 's' : '') + ' selected';
    }
    if (selectAllBtn) {
      var all = getCheckboxes();
      selectAllBtn.textContent = (checked.length === all.length && all.length > 0) ? 'Deselect all' : 'Select all';
    }
  }

  document.querySelectorAll('.photo-checkbox').forEach(function (cb) {
    cb.addEventListener('change', function () {
      var card = cb.closest('.admin-photo-card--selectable');
      if (card) card.classList.toggle('admin-photo-card--selected', cb.checked);
      updateBulkBar();
    });
  });

  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', function () {
      var all    = getCheckboxes();
      var select = all.filter(function (cb) { return cb.checked; }).length < all.length;
      all.forEach(function (cb) {
        cb.checked = select;
        var card = cb.closest('.admin-photo-card--selectable');
        if (card) card.classList.toggle('admin-photo-card--selected', select);
      });
      updateBulkBar();
    });
  }

  function submitBulk(action) {
    var checked = getCheckboxes().filter(function (cb) { return cb.checked; });
    if (checked.length === 0) return;
    if (action === 'reject') {
      if (!confirm('Move ' + checked.length + ' photo' + (checked.length !== 1 ? 's' : '') + ' to Not Approved? They will be kept (not deleted) and remain downloadable.')) return;
    }

    var ids = checked.map(function (cb) { return cb.value; });
    var body = 'action=' + encodeURIComponent(action) +
               ids.map(function (id) { return '&photo_ids=' + encodeURIComponent(id); }).join('');

    if (bulkApproveBtn) bulkApproveBtn.disabled = true;
    if (bulkRejectBtn)  bulkRejectBtn.disabled  = true;

    doAction('/admin/photos/bulk-action', body.replace(/^_csrf=[^&]+&?/, '')).then(function (data) {
      if (!data.ok) {
        showToast('error', data.message || 'Bulk action failed.');
        if (bulkApproveBtn) bulkApproveBtn.disabled = false;
        if (bulkRejectBtn)  bulkRejectBtn.disabled  = false;
        return;
      }
      // Remove all selected pending cards
      checked.forEach(function (cb) {
        var card = cb.closest('.admin-photo-card');
        if (card) fadeRemove(card);
      });
      updatePendingBadge(-checked.length);
      updateBulkBar();
      showToast('success', data.message || 'Done.');
      if (bulkApproveBtn) bulkApproveBtn.disabled = false;
      if (bulkRejectBtn)  bulkRejectBtn.disabled  = false;
    }).catch(function () {
      showToast('error', 'Network error. Please try again.');
      if (bulkApproveBtn) bulkApproveBtn.disabled = false;
      if (bulkRejectBtn)  bulkRejectBtn.disabled  = false;
    });
  }

  if (bulkApproveBtn) bulkApproveBtn.addEventListener('click', function () { submitBulk('approve'); });
  if (bulkRejectBtn)  bulkRejectBtn.addEventListener('click',  function () { submitBulk('reject'); });
  if (bulkClearBtn) {
    bulkClearBtn.addEventListener('click', function () {
      getCheckboxes().forEach(function (cb) {
        cb.checked = false;
        var card = cb.closest('.admin-photo-card--selectable');
        if (card) card.classList.remove('admin-photo-card--selected');
      });
      updateBulkBar();
    });
  }

  /* ── Admin photo lightbox ────────────────────────────────────────────────── */

  var lightbox = document.getElementById('admin-lightbox');
  var lbImg    = document.getElementById('admin-lightbox-img');
  var lbCap    = document.getElementById('admin-lightbox-caption');
  var lbClose  = document.getElementById('admin-lightbox-close');
  var lbPrev   = document.getElementById('admin-lightbox-prev');
  var lbNext   = document.getElementById('admin-lightbox-next');

  if (!lightbox) return;

  var previewBtns = [];
  var currentIdx  = 0;

  function rebuildPreviewList() {
    previewBtns = Array.from(document.querySelectorAll('.admin-photo-preview-btn'));
  }
  rebuildPreviewList();

  function openAt(idx) {
    if (previewBtns.length === 0) return;
    currentIdx = (idx + previewBtns.length) % previewBtns.length;
    var btn = previewBtns[currentIdx];
    lbImg.src = btn.getAttribute('data-src');
    lbImg.alt = btn.getAttribute('aria-label') || '';
    lbCap.textContent = btn.getAttribute('data-caption') || '';
    lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
    lbClose.focus();
  }

  function closeLightbox() {
    lightbox.hidden = true;
    document.body.style.overflow = '';
    if (previewBtns[currentIdx]) previewBtns[currentIdx].focus();
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.admin-photo-preview-btn');
    if (!btn) return;
    if (e.target.closest('.admin-photo-select-wrap')) return;
    rebuildPreviewList();
    var idx = previewBtns.indexOf(btn);
    if (idx !== -1) openAt(idx);
  });

  lbClose.addEventListener('click', closeLightbox);
  lbPrev.addEventListener('click', function () { openAt(currentIdx - 1); });
  lbNext.addEventListener('click', function () { openAt(currentIdx + 1); });
  lightbox.addEventListener('click', function (e) { if (e.target === lightbox) closeLightbox(); });

  document.addEventListener('keydown', function (e) {
    if (lightbox.hidden) return;
    if (e.key === 'Escape')     closeLightbox();
    if (e.key === 'ArrowLeft')  openAt(currentIdx - 1);
    if (e.key === 'ArrowRight') openAt(currentIdx + 1);
  });

  /* ── RSVP delete confirm (kept for RSVP table) ───────────────────────────── */

  document.querySelectorAll('.rsvp-delete-form').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      var nameEl = form.closest('tr') && form.closest('tr').querySelector('td strong');
      var label  = nameEl ? nameEl.textContent.trim() : 'this entry';
      if (!confirm('Permanently delete the RSVP from ' + label + '? This cannot be undone.')) {
        e.preventDefault();
      }
    });
  });

})();
