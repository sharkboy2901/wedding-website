'use strict';

/* ── Guest Photo Upload — drag-and-drop UI ────────────────────────────────── */
(function () {
  const form       = document.getElementById('upload-form');
  if (!form) return;

  const fileInput  = document.getElementById('photo');
  const dropZone   = document.getElementById('drop-zone');
  const dzContent  = document.getElementById('drop-zone-content');
  const dzPreview  = document.getElementById('drop-preview');
  const previewImg = document.getElementById('preview-img');
  const previewNm  = document.getElementById('preview-name');
  const removeBtn  = document.getElementById('preview-remove');
  const submitBtn  = document.getElementById('submit-btn');

  if (!fileInput || !dropZone) return;

  // Read config from data attributes on the form element
  const MAX_MB    = parseInt(form.getAttribute('data-max-mb') || '15', 10);
  const MAX_BYTES = MAX_MB * 1024 * 1024;
  const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

  function showPreview(file) {
    if (!ALLOWED_TYPES.has(file.type)) {
      alert('Invalid file type. Please choose a JPEG, PNG, or WebP image.');
      clearSelection();
      return;
    }
    if (file.size > MAX_BYTES) {
      alert('File is too large. Maximum size is ' + MAX_MB + ' MB.');
      clearSelection();
      return;
    }
    const reader = new FileReader();
    reader.onload = function (e) {
      previewImg.src = e.target.result;
      previewNm.textContent = file.name;
      dzContent.hidden = true;
      dzPreview.hidden = false;
    };
    reader.readAsDataURL(file);
  }

  function clearSelection() {
    fileInput.value = '';
    previewImg.src  = '';
    previewNm.textContent = '';
    dzContent.hidden = false;
    dzPreview.hidden = true;
  }

  // Click drop zone to open file picker
  dropZone.addEventListener('click', function (e) {
    if (e.target === removeBtn) return;
    fileInput.click();
  });
  dropZone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });

  fileInput.addEventListener('change', function (e) {
    if (e.target.files && e.target.files[0]) showPreview(e.target.files[0]);
  });

  removeBtn.addEventListener('click', function (e) { e.stopPropagation(); clearSelection(); });

  // Drag and drop
  ['dragenter', 'dragover'].forEach(function (ev) {
    dropZone.addEventListener(ev, function (e) { e.preventDefault(); dropZone.classList.add('drag-over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dropZone.addEventListener(ev, function (e) { e.preventDefault(); dropZone.classList.remove('drag-over'); });
  });
  dropZone.addEventListener('drop', function (e) {
    var file = e.dataTransfer.files[0];
    if (file) {
      try {
        var dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
      } catch (_) {}
      showPreview(file);
    }
  });

  // Prevent double-submit
  form.addEventListener('submit', function () {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Uploading…';
    }
  });
})();
