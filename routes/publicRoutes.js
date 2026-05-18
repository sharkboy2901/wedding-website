'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { uploadMiddleware, validateAndSave, MAX_SIZE_MB } = require('../middleware/upload');
const { validateCsrfFromBody } = require('../middleware/csrf');

const PHOTO_LIMIT_PER_GUEST = 10;

// Helper: build config object shared across all views
function siteConfig() {
  return {
    coupleNames:   process.env.COUPLE_NAMES   || 'Matthew & Kristine',
    weddingDate:   process.env.WEDDING_DATE   || '2026-06-06',
    venueName:     process.env.VENUE_NAME     || '[Venue Name]',
    venueLocation: process.env.VENUE_LOCATION || '[Location]',
    venueAddress:  process.env.VENUE_ADDRESS  || '',
    ceremonyTime:  process.env.CEREMONY_TIME  || '2:00 PM',
    receptionTime: process.env.RECEPTION_TIME || '6:00 PM',
    dressCode:     process.env.DRESS_CODE     || 'Smart Casual',
    rsvpDeadline:  process.env.RSVP_DEADLINE  || '2026-05-01',
  };
}

// Helper: fetch livestream-related settings from DB
async function getNavConfig() {
  var visibleSetting = await db.getSetting('livestream_visible');
  // Default to visible (null = never set = show)
  var livestreamVisible = (visibleSetting === null || visibleSetting === '1');
  return { livestreamVisible: livestreamVisible };
}

function asyncHandler(fn) {
  return function(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// -- Home --

router.get('/', asyncHandler(async function(req, res) {
  var flash = req.session.flash || null;
  delete req.session.flash;

  var [navConfig, featuredPhotos, channelSetting, homepageSetting] = await Promise.all([
    getNavConfig(),
    db.getFeaturedPhotos(),
    db.getSetting('livestream_channel'),
    db.getSetting('livestream_homepage'),
  ]);

  var livestreamChannel  = channelSetting || process.env.TWITCH_CHANNEL || null;
  var livestreamHomepage = (homepageSetting === '1');

  res.render('index', {
    config: siteConfig(),
    flash: flash,
    livestreamVisible: navConfig.livestreamVisible,
    featuredPhotos:    featuredPhotos,
    livestreamChannel: livestreamChannel,
    livestreamHomepage: livestreamHomepage,
  });
}));

// -- Our Story --

router.get('/our-story', asyncHandler(async function(req, res) {
  var navConfig = await getNavConfig();
  res.render('story', { config: siteConfig(), livestreamVisible: navConfig.livestreamVisible });
}));

// -- Gallery --

router.get('/gallery', asyncHandler(async function(req, res) {
  var [photos, navConfig] = await Promise.all([
    db.getApprovedPhotos(),
    getNavConfig(),
  ]);
  res.render('gallery', { config: siteConfig(), photos: photos, livestreamVisible: navConfig.livestreamVisible });
}));

// -- RSVP --

router.get('/rsvp', asyncHandler(async function(req, res) {
  var flash = req.session.flash || null;
  delete req.session.flash;
  var navConfig = await getNavConfig();
  res.render('rsvp', { config: siteConfig(), flash: flash, errors: [], formData: null, livestreamVisible: navConfig.livestreamVisible });
}));

router.post('/rsvp', asyncHandler(async function(req, res) {
  var name        = req.body.name;
  var email       = req.body.email;
  var attending   = req.body.attending;
  var guest_count = req.body.guest_count;
  var dietary     = req.body.dietary;
  var song        = req.body.song;
  var message     = req.body.message;
  var errors      = [];

  if (!name || name.trim().length < 2)   errors.push('Please enter your full name.');
  if (name && name.trim().length > 100)  errors.push('Name is too long (max 100 characters).');
  if (email && email.trim().length > 0) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.push('Please enter a valid email address.');
    }
  }
  if (!['yes', 'no', 'maybe'].includes(attending)) {
    errors.push('Please select whether you are attending.');
  }
  var guestNum = parseInt(guest_count, 10);
  if (attending === 'yes' && (isNaN(guestNum) || guestNum < 1 || guestNum > 10)) {
    errors.push('Please enter a valid number of guests (1-10).');
  }

  if (errors.length > 0) {
    var navConfigErr = await getNavConfig();
    return res.render('rsvp', {
      config: siteConfig(),
      flash: null,
      errors: errors,
      formData: { name: name, email: email, attending: attending, guest_count: guest_count, dietary: dietary, song: song, message: message },
      livestreamVisible: navConfigErr.livestreamVisible,
    });
  }

  await db.insertRsvp({
    name:                name.trim().substring(0, 100),
    email:               email ? email.trim().substring(0, 200) : null,
    attending:           attending,
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

router.get('/upload', asyncHandler(async function(req, res) {
  var flash = req.session.flash || null;
  delete req.session.flash;
  var navConfig = await getNavConfig();
  res.render('upload', {
    config:     siteConfig(),
    flash:      flash,
    MAX_SIZE_MB: MAX_SIZE_MB,
    photoCount: null,
    photoLimit: PHOTO_LIMIT_PER_GUEST,
    livestreamVisible: navConfig.livestreamVisible,
  });
}));

router.post('/upload', function(req, res, next) {
  uploadMiddleware(req, res, async function(err) {
    var config = siteConfig();
    var navConfig = await getNavConfig();
    var livestreamVisible = navConfig.livestreamVisible;

    // CSRF check (after multer has parsed the multipart body)
    if (!validateCsrfFromBody(req)) {
      return res.status(403).render('error', {
        status:  403,
        title:   'Forbidden',
        message: 'Invalid or missing security token. Please go back and try again.',
        config:  config,
      });
    }

    if (err) {
      var errMsg = 'Upload failed. Please try again.';
      if (err.code === 'LIMIT_FILE_SIZE') {
        errMsg = 'File too large. Maximum size is ' + MAX_SIZE_MB + ' MB.';
      } else if (err.message === 'INVALID_TYPE') {
        errMsg = 'Invalid file type. Only JPEG, PNG, and WebP images are accepted.';
      }
      return res.render('upload', {
        config: config,
        flash: { type: 'error', message: errMsg },
        MAX_SIZE_MB: MAX_SIZE_MB,
        photoCount: null,
        photoLimit: PHOTO_LIMIT_PER_GUEST,
        livestreamVisible: livestreamVisible,
      });
    }

    if (!req.file) {
      return res.render('upload', {
        config: config,
        flash: { type: 'error', message: 'Please select a photo to upload.' },
        MAX_SIZE_MB: MAX_SIZE_MB,
        photoCount: null,
        photoLimit: PHOTO_LIMIT_PER_GUEST,
        livestreamVisible: livestreamVisible,
      });
    }

    // Validate magic bytes
    var result = validateAndSave(req.file);
    if (!result.ok) {
      return res.render('upload', {
        config: config,
        flash: { type: 'error', message: result.error },
        MAX_SIZE_MB: MAX_SIZE_MB,
        photoCount: null,
        photoLimit: PHOTO_LIMIT_PER_GUEST,
        livestreamVisible: livestreamVisible,
      });
    }

    var uploaderName    = req.body.uploader_name    ? req.body.uploader_name.trim().substring(0, 100)    : null;
    var uploaderMessage = req.body.uploader_message ? req.body.uploader_message.trim().substring(0, 500) : null;

    // Enforce per-guest photo limit
    if (uploaderName) {
      var existingCount = await db.getPhotoCountByGuest(uploaderName);
      if (existingCount >= PHOTO_LIMIT_PER_GUEST) {
        return res.status(400).render('upload', {
          config: config,
          flash: {
            type: 'error',
            message: "You've already uploaded " + existingCount + " photo" + (existingCount !== 1 ? 's' : '') +
              " — the maximum is " + PHOTO_LIMIT_PER_GUEST + " per guest. Thank you for sharing so many memories!",
          },
          MAX_SIZE_MB: MAX_SIZE_MB,
          photoCount:  existingCount,
          photoLimit:  PHOTO_LIMIT_PER_GUEST,
          livestreamVisible: livestreamVisible,
        });
      }
    }

    try {
      await db.insertPhoto({
        filename:     result.filename,
        originalName: req.file.originalname ? req.file.originalname.substring(0, 255) : null,
        mimeType:     result.mimeType,
        fileSize:     result.size,
        uploaderName:    uploaderName,
        uploaderMessage: uploaderMessage,
      });

      req.session.flash = {
        type: 'success',
        message: 'Your photo has been uploaded! It will appear in the gallery once approved. Thank you!',
      };
      res.redirect('/upload');
    } catch (dbErr) {
      console.error('[Upload] DB error:', dbErr.message);
      res.render('upload', {
        config: config,
        flash: { type: 'error', message: 'Something went wrong saving your photo. Please try again.' },
        MAX_SIZE_MB: MAX_SIZE_MB,
        photoCount: null,
        photoLimit: PHOTO_LIMIT_PER_GUEST,
        livestreamVisible: livestreamVisible,
      });
    }
  });
});

// -- Livestream --

router.get('/livestream', asyncHandler(async function(req, res) {
  var [visibleSetting, channelSetting] = await Promise.all([
    db.getSetting('livestream_visible'),
    db.getSetting('livestream_channel'),
  ]);

  var livestreamVisible = (visibleSetting === null || visibleSetting === '1');

  // If hidden and not admin, redirect to home with flash
  if (!livestreamVisible && !req.session.adminLoggedIn) {
    req.session.flash = { type: 'warning', message: 'The livestream will be available soon.' };
    return res.redirect('/');
  }

  var channel = channelSetting || process.env.TWITCH_CHANNEL || null;
  res.render('livestream', { config: siteConfig(), channel: channel, livestreamVisible: livestreamVisible });
}));

module.exports = router;
