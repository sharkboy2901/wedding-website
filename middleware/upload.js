'use strict';

const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const { v4: uuidv4 } = require('uuid');

// Allowed types (allowlist)
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

// Max file size from env, default 15 MB
const MAX_SIZE_MB    = parseInt(process.env.MAX_UPLOAD_MB || '15', 10);
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

// Magic byte validation
// Inspects raw file bytes to verify file type, ignoring whatever
// extension or MIME type the client claims.
function detectMimeFromBuffer(buffer) {
  if (!buffer || buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 &&
    buffer[2] === 0x4E && buffer[3] === 0x47 &&
    buffer[4] === 0x0D && buffer[5] === 0x0A &&
    buffer[6] === 0x1A && buffer[7] === 0x0A
  ) {
    return 'image/png';
  }

  // WebP: RIFF????WEBP
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 &&
    buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 &&
    buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

// Multer storage: memory first; we write to disk after full validation.
const storage = multer.memoryStorage();

const MAX_FILES = 10;

const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: MAX_SIZE_BYTES,
    files: MAX_FILES,
  },
  fileFilter: function(req, file, cb) {
    // First-pass: requires BOTH a matching MIME type AND a matching extension.
    // Real security relies on magic-byte inspection after buffering --
    // this is an early-exit to avoid buffering clearly wrong files.
    var ext     = path.extname(file.originalname).toLowerCase();
    var mimeOk  = ALLOWED_MIME_TYPES.has(file.mimetype);
    var extOk   = ALLOWED_EXTENSIONS.has(ext);
    if (!mimeOk || !extOk) {
      return cb(new Error('INVALID_TYPE'));
    }
    cb(null, true);
  },
}).array('photos', MAX_FILES);

// saveToDisk: write validated buffer to the pending folder with a safe UUID filename.
function saveToDisk(buffer, detectedMime) {
  var extMap = {
    'image/jpeg': '.jpg',
    'image/png':  '.png',
    'image/webp': '.webp',
  };
  var ext          = extMap[detectedMime];
  var safeFilename = uuidv4() + ext;
  var dest         = path.join(__dirname, '..', 'uploads', 'pending', safeFilename);
  fs.writeFileSync(dest, buffer);
  return safeFilename;
}

// validateFile: magic-byte check only, no disk write.
// Returns { ok, mimeType, error }
function validateFile(file) {
  if (file.size > MAX_SIZE_BYTES) {
    return { ok: false, error: 'File too large. Maximum size is ' + MAX_SIZE_MB + ' MB.' };
  }
  var detectedMime = detectMimeFromBuffer(file.buffer);
  if (!detectedMime || !ALLOWED_MIME_TYPES.has(detectedMime)) {
    return { ok: false, error: 'Invalid file type. Only JPEG, PNG, and WebP images are accepted.' };
  }
  return { ok: true, mimeType: detectedMime };
}

// validateAndSave: full validation pipeline (kept for backward compat).
// Returns { ok, filename, mimeType, error }
function validateAndSave(file) {
  var v = validateFile(file);
  if (!v.ok) return v;
  var filename = saveToDisk(file.buffer, v.mimeType);
  return { ok: true, filename: filename, mimeType: v.mimeType, size: file.size };
}

module.exports = { uploadMiddleware, validateAndSave, validateFile, saveToDisk, MAX_SIZE_MB, MAX_FILES };
