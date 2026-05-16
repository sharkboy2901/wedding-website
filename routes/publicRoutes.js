'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { uploadMiddleware, validateAndSave, MAX_SIZE_MB } = require('../middleware/upload');
const { validateCsrfFromBody } = require('../middleware/csrf');

// Helper: build config object shared across all views
function siteConfig() {
  return {
    coupleNames:   process.env.COUPLE_NAMES   || 'Matthew & [Partner Name]',
    weddingDate:   process.env.WEDDING_DATE   || '2025-09-20',
    venueName:     process.env.VENUE_NAME     || '[Venue Name]',
    venueLocation: process.env.VENUE_LOCATION || '[Location]',
    venueAddress:  process.env.VENUE_ADDRESS  || '',
    ceremonyTime:  process.env.CEREMONY_TIME  || '2:00 PM',
    receptionTime: process.env.RECEPTION_TIME || '6:00 PM',
    dressCode:     process.env.DRESS_CODE     || 'Smart Casual',
    rsvpDeadline:  process.env.RSVP_DEADLINE  || '2025-08-01',
  };
}

// Wrap async route handlers
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// -- Home --

router.get('/', (req, res) => {
  const flash = req.session.flash || null;
  delete req.session.flash;
  res.render('index', { config: siteConfig(), flash });
});

// -- Our Story --

router.get('/our-story', (req, res) => {
  res.render('story', { config: siteConfig() });
});

// -- Gallery (approved photos only) --

router.get('/gallery', asyncHandler(async (req, res) => {
  const photos = await db.getApprovedPhotos();
  res.render('gallery', { config: siteConfig(), photos });
}));

// -- RSVP form --

router.get('/rsvp', (req, res) => {
  const flash = req.session.flash || null;
  delete req.session.flash;
  res.render('rsvp', { config: siteConfig(), flash, errors: [], formData: null });
});

router.post('/rsvp', asyncHandler(async (req, res) => {
  const { name, email, attending, guest_count, dietary, song, message } = req.body;
  const errors = [];

  // Validate
  if (!name || name.trim().length < 2) {
    errors.push('Please enter your full name.');
  }
  if (name && name.trim().length > 100) {
    errors.push('Name is too long (max 100 characters).');
  }
  if (email && email.trim().length > 0) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.push('Please enter a valid email address.');
    }
  }
  if (!['yes', 'no', 'maybe'].includes(attending)) {
    errors.push('Please select whether you are attending.');
  }
  const guestNum = parseInt(guest_count, 10);
  if (attending === 'yes' && (isNaN(guestNum) || guestNum < 1 || guestNum > 10)) {
    errors.push('Please enter a valid number of guests (1-10).');
  }

  if (errors.length > 0) {
    return res.render('rsvp', {
      config: siteConfig(),
      flash: null,
      errors,
      formData: { name, email, attending, guest_count, dietary, song, message },
    });
  }

  await db.insertRsvp({
    name:                name.trim().substring(0, 100),
    email:               email ? email.trim().substring(0, 200) : null,
    attending,
    guestCount:          attending === 'yes' ? guestNum : 0,
    dietaryRequirements: dietary ? dietary.trim().substring(0, 500) : null,
    songRequest:         song ? song.trim().substring(0, 200) : null,
    message:             message ? message.trim().substring(0, 1000) : null,
  });

  req.session.flash = {
    type: 'success',
    message: attending === 'yes'
      ? "Thank you! We can't wait to celebrate with you."
      : attending === 'no'
      ? "Thank you for letting us know. You'll be in our thoughts."
      : "Thank you! We'll keep a spot open for you.",
  };
  res.redirect('/rsvp');
}));

// -- Guest photo upload --

router.get('/upload', (req, res) => {
  const flash = req.session.flash || null;
  delete req.session.flash;
  res.render('upload', { config: siteConfig(), flash, MAX_SIZE_MB });
});

router.post('/upload', (req, res, next) => {
  uploadMiddleware(req, res, async (err) => {
    const config = siteConfig();

    // Validate CSRF token now that multer has parsed the multipart body
    if (!validateCsrfFromBody(req)) {
      return res.status(403).render('error', {
        status:  403,
        title:   'Forbidden',
        message: 'Invalid or missing security token. Please go back and try again.',
        config,
      });
    }

    if (err) {
      let message = 'Upload failed. Please try again.';
      if (err.code === 'LIMIT_FILE_SIZE') {
        message = 'File too large. Maximum size is ' + MAX_SIZE_MB + ' MB.';
      } else if (err.message === 'INVALID_TYPE') {
        message = 'Invalid file type. Only JPEG, PNG, and WebP images are accepted.';
      }
      return res.render('upload', { config, flash: { type: 'error', message }, MAX_SIZE_MB });
    }

    if (!req.file) {
      return res.render('upload', {
        config,
        flash: { type: 'error', message: 'Please select a photo to upload.' },
        MAX_SIZE_MB,
      });
    }

    // Validate magic bytes and save to disk
    const result = validateAndSave(req.file);
    if (!result.ok) {
      return res.render('upload', {
        config,
        flash: { type: 'error', message: result.error },
        MAX_SIZE_MB,
      });
    }

    const uploaderName    = req.body.uploader_name    ? req.body.uploader_name.trim().substring(0, 100)    : null;
    const uploaderMessage = req.body.uploader_message ? req.body.uploader_message.trim().substring(0, 500) : null;

    try {
      await db.insertPhoto({
        filename:     result.filename,
        originalName: req.file.originalname ? req.file.originalname.substring(0, 255) : null,
        mimeType:     result.mimeType,
        fileSize:     result.size,
        uploaderName,
        uploaderMessage,
      });

      req.session.flash = {
        type: 'success',
        message: 'Your photo has been uploaded! It will appear in the gallery once approved. Thank you!',
      };
      res.redirect('/upload');
    } catch (dbErr) {
      console.error('[Upload] DB error:', dbErr.message);
      res.render('upload', {
        config,
        flash: { type: 'error', message: 'Something went wrong saving your photo. Please try again.' },
        MAX_SIZE_MB,
      });
    }
  });
});

module.exports = router;
