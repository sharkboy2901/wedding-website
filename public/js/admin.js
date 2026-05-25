'use strict';

(function () {

  /* ── Confirm dialogs ──────────────────────────────────────────────────────── */

  document.querySelectorAll('.reject-form').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!confirm('Reject and permanently delete this photo? This cannot be undone.')) {
        e.preventDefault();
      }
    });
  });

  document.querySelectorAll('.delete-form').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!confirm('Remove this photo from the public gallery? This cannot be undone.')) {
        e.preventDefault();
      }
    });
  });

  document.querySelectorAll('.rsvp-delete-form').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      var nameEl = form.closest('tr') && form.closest('tr').querySelector('td strong');
      var label  = nameEl ? nameEl.textContent.trim() : 'this entry';
      if (!confirm('Permanently delete the RSVP from ' + label + '? This cannot be undone.')) {
        e.preventDefault();
      }
    });
  });

  /* ── Bulk selection ──────────────────────────────────────────────────────── */

  var bulkBar        = document.getElementById('bulk-bar');
  var bulkBarCount   = document.getElementById('bulk-bar-count');
  var bulkForm       = document.getElementById('bulk-form');
  var bulkActionInput = document.getElementById('bulk-action-input');
  var bulkApproveBtn = document.getElementById('bulk-approve-btn');
  var bulkRejectBtn  = document.getElementById('bulk-reject-btn');
  var bulkClearBtn   = document.getElementById('bulk-clear-btn');
  var selectAllBtn   = document.getElementById('select-all-btn');

  function getCheckboxes() {
    return Array.from(document.querySelectorAll('.photo-checkbox'));
  }

  function updateBulkBar() {
    var checked = getCheckboxes().filter(function (cb) { return cb.checked; });
    if (!bulkBar) return;
    if (checked.length === 0) {
      bulkBar.hidden = true;
    } else {
      bulkBar.hidden = false;
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
      var all     = getCheckboxes();
      var checked = all.filter(function (cb) { return cb.checked; });
      var select  = checked.length < all.length;
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
      if (!confirm('Reject and permanently delete ' + checked.length + ' photo' + (checked.length !== 1 ? 's' : '') + '? This cannot be undone.')) return;
    }

    // Remove any previously added photo_ids inputs
    bulkForm.querySelectorAll('input[name="photo_ids"]').forEach(function (el) { el.remove(); });

    checked.forEach(function (cb) {
      var input = document.createElement('input');
      input.type  = 'hidden';
      input.name  = 'photo_ids';
      input.value = cb.value;
      bulkForm.appendChild(input);
    });

    bulkActionInput.value = action;
    bulkForm.submit();
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

  var lightbox   = document.getElementById('admin-lightbox');
  var lbImg      = document.getElementById('admin-lightbox-img');
  var lbCap      = document.getElementById('admin-lightbox-caption');
  var lbClose    = document.getElementById('admin-lightbox-close');
  var lbPrev     = document.getElementById('admin-lightbox-prev');
  var lbNext     = document.getElementById('admin-lightbox-next');

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

  previewBtns.forEach(function (btn, idx) {
    btn.addEventListener('click', function (e) {
      // Don't open lightbox if user was just ticking the checkbox overlay
      if (e.target.closest('.admin-photo-select-wrap')) return;
      openAt(idx);
    });
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

})();
