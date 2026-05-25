'use strict';

/* ── Guest Photo Upload — multi-file drag-and-drop UI ────────────────────── */
(function () {
  var form     = document.getElementById('upload-form');
  if (!form) return;

  var fileInput   = document.getElementById('photos');
  var dropZone    = document.getElementById('drop-zone');
  var dzContent   = document.getElementById('drop-zone-content');
  var previewGrid = document.getElementById('preview-grid');
  var submitBtn   = document.getElementById('submit-btn');

  if (!fileInput || !dropZone || !previewGrid) return;

  var MAX_MB    = parseInt(form.getAttribute('data-max-mb')    || '15', 10);
  var MAX_FILES = parseInt(form.getAttribute('data-max-files') || '10', 10);
  var MAX_BYTES = MAX_MB * 1024 * 1024;
  var ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

  var currentFiles = []; // ordered array of File objects

  // No-op kept for call-site compatibility — fetch submission no longer needs it
  function syncFileInput() {}

  function renderPreviews() {
    previewGrid.innerHTML = '';

    if (currentFiles.length === 0) {
      previewGrid.hidden = true;
      dzContent.hidden   = false;
      return;
    }

    dzContent.hidden   = true;
    previewGrid.hidden = false;

    // Summary bar
    var bar = document.createElement('div');
    bar.className = 'preview-bar';

    var countEl = document.createElement('span');
    countEl.className   = 'preview-count';
    countEl.textContent = currentFiles.length + ' photo' + (currentFiles.length !== 1 ? 's' : '') + ' selected';

    var clearBtn = document.createElement('button');
    clearBtn.type        = 'button';
    clearBtn.className   = 'preview-clear-btn';
    clearBtn.textContent = 'Clear all';
    clearBtn.addEventListener('click', function (e) { e.stopPropagation(); clearAll(); });

    bar.appendChild(countEl);
    bar.appendChild(clearBtn);
    previewGrid.appendChild(bar);

    // Thumbnail grid
    var grid = document.createElement('div');
    grid.className = 'preview-thumbnails';

    currentFiles.forEach(function (file, idx) {
      var card = document.createElement('div');
      card.className = 'preview-card';

      var rmBtn = document.createElement('button');
      rmBtn.type      = 'button';
      rmBtn.className = 'preview-card-remove';
      rmBtn.setAttribute('aria-label', 'Remove ' + file.name);
      rmBtn.textContent = '×';
      rmBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        currentFiles.splice(idx, 1);
        syncFileInput();
        renderPreviews();
      });

      var img = document.createElement('img');
      img.className = 'preview-thumb';
      img.alt       = file.name;
      var reader    = new FileReader();
      reader.onload = function (e) { img.src = e.target.result; };
      reader.readAsDataURL(file);

      var nameEl = document.createElement('span');
      nameEl.className   = 'preview-card-name';
      nameEl.textContent = file.name.length > 18 ? file.name.substring(0, 15) + '…' : file.name;

      card.appendChild(rmBtn);
      card.appendChild(img);
      card.appendChild(nameEl);
      grid.appendChild(card);
    });

    // "Add more" tile — only shown when below the limit
    if (currentFiles.length < MAX_FILES) {
      var addTile = document.createElement('button');
      addTile.type      = 'button';
      addTile.className = 'preview-add-more';
      addTile.setAttribute('aria-label', 'Add more photos');
      addTile.innerHTML = '+<span>Add more</span>';
      addTile.addEventListener('click', function (e) { e.stopPropagation(); fileInput.click(); });
      grid.appendChild(addTile);
    }

    previewGrid.appendChild(grid);
  }

  function clearAll() {
    currentFiles = [];
    fileInput.value = '';
    renderPreviews();
  }

  function addFiles(newFiles) {
    var errors = [];
    Array.from(newFiles).forEach(function (file) {
      if (currentFiles.length >= MAX_FILES) {
        errors.push('Maximum ' + MAX_FILES + ' photos per submission — extra files were skipped.');
        return;
      }
      if (!ALLOWED_TYPES.has(file.type)) {
        errors.push('“' + file.name + '” is not a JPEG, PNG, or WebP image.');
        return;
      }
      if (file.size > MAX_BYTES) {
        errors.push('“' + file.name + '” exceeds the ' + MAX_MB + ' MB limit.');
        return;
      }
      // Deduplicate by name + size
      var isDup = currentFiles.some(function (f) { return f.name === file.name && f.size === file.size; });
      if (!isDup) currentFiles.push(file);
    });
    if (errors.length > 0) alert(errors.join('\n'));
    syncFileInput();
    renderPreviews();
  }

  // Open file picker on drop zone click (but not on remove/clear buttons)
  dropZone.addEventListener('click', function (e) {
    if (e.target.closest('.preview-card-remove') || e.target.closest('.preview-clear-btn') || e.target.closest('.preview-add-more')) return;
    if (currentFiles.length < MAX_FILES) fileInput.click();
  });
  dropZone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });

  fileInput.addEventListener('change', function (e) {
    var files = Array.from(e.target.files || []);
    // Reset input BEFORE addFiles so the subsequent syncFileInput() sticks
    try { fileInput.value = ''; } catch (_) {}
    if (files.length > 0) addFiles(files);
  });

  // Drag and drop
  ['dragenter', 'dragover'].forEach(function (ev) {
    dropZone.addEventListener(ev, function (e) { e.preventDefault(); dropZone.classList.add('drag-over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dropZone.addEventListener(ev, function (e) { e.preventDefault(); dropZone.classList.remove('drag-over'); });
  });
  dropZone.addEventListener('drop', function (e) {
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (currentFiles.length === 0) return;

    if (submitBtn) {
      submitBtn.disabled    = true;
      submitBtn.textContent = 'Uploading…';
    }

    // Build FormData directly from currentFiles — no DataTransfer needed,
    // so this works on all mobile browsers.
    var fd = new FormData(form); // picks up _csrf, uploader_name, uploader_message
    fd.delete('photos');
    currentFiles.forEach(function (f) { fd.append('photos', f); });

    fetch('/upload', { method: 'POST', body: fd })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        // Works for both success redirect (server redirects → fetch follows → success page HTML)
        // and error (server renders upload page with error flash HTML).
        document.open(); document.write(html); document.close();
      })
      .catch(function () {
        if (submitBtn) {
          submitBtn.disabled    = false;
          submitBtn.textContent = 'Upload Photos';
        }
      });
  });
})();
