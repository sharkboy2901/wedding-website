'use strict';

const express = require('express');
const path    = require('path');
const router  = express.Router();
const db      = require('../db/database');
const { uploadMiddleware, validateFile, saveToDisk, MAX_SIZE_MB, MAX_FILES } = require('../middleware/upload');
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

// -- Gallery --

router.get('/gallery', asyncHandler(async function(req, res) {
  var [photos, navConfig] = await Promise.all([
    db.getApprovedPhotos(),
    getNavConfig(),
  ]);
  res.render('gallery', { config: siteConfig(), photos: photos, livestreamVisible: navConfig.livestreamVisible });
}));

// -- RSVP removed — redirect to home --
router.get('/rsvp', function(req, res) { res.redirect('/'); });
router.post('/rsvp', function(req, res) { res.redirect('/'); });
router.get('/our-story', function(req, res) { res.redirect('/'); });

// -- Guest photo upload --

router.get('/upload', asyncHandler(async function(req, res) {
  var flash = req.session.flash || null;
  delete req.session.flash;
  var navConfig = await getNavConfig();
  res.render('upload', {
    config:     siteConfig(),
    flash:      flash,
    MAX_SIZE_MB:  MAX_SIZE_MB,
    MAX_FILES:    MAX_FILES,
    photoCount:   null,
    photoLimit:   PHOTO_LIMIT_PER_GUEST,
    livestreamVisible: navConfig.livestreamVisible,
  });
}));

router.post('/upload', function(req, res, next) {
  uploadMiddleware(req, res, async function(err) {
    var config = siteConfig();

    // Post/Redirect/Get: always store result in session flash and redirect.
    // This avoids document.write() on the client and prevents double-submit.
    function flashAndRedirect(type, message) {
      req.session.flash = { type: type, message: message };
      return res.redirect('/upload');
    }

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
        errMsg = 'One or more files exceeded the ' + MAX_SIZE_MB + ' MB size limit.';
      } else if (err.code === 'LIMIT_FILE_COUNT') {
        errMsg = 'Too many files selected. Maximum is ' + MAX_FILES + ' photos per submission.';
      } else if (err.message === 'INVALID_TYPE') {
        errMsg = 'Invalid file type. Only JPEG, PNG, and WebP images are accepted.';
      }
      return flashAndRedirect('error', errMsg);
    }

    var files = req.files || [];

    // Log what the server actually received — visible in Railway logs for debugging.
    console.log('[Upload] POST received — files:', files.length,
                '| body fields:', Object.keys(req.body || {}).join(',') || '(none)',
                '| content-type:', (req.headers['content-type'] || '').split(';')[0]);

    if (files.length === 0) {
      return flashAndRedirect('error', 'Please select at least one photo to upload.');
    }

    var uploaderName    = req.body.uploader_name    ? req.body.uploader_name.trim().substring(0, 100)    : null;
    var uploaderMessage = req.body.uploader_message ? req.body.uploader_message.trim().substring(0, 500) : null;

    // Check per-guest limit
    var existingCount = uploaderName ? await db.getPhotoCountByGuest(uploaderName) : 0;
    var remaining = PHOTO_LIMIT_PER_GUEST - existingCount;

    if (remaining <= 0) {
      return flashAndRedirect('error',
        "You've already uploaded " + existingCount + " photo" + (existingCount !== 1 ? 's' : '') +
        " — the maximum is " + PHOTO_LIMIT_PER_GUEST + " per guest. Thank you for sharing so many memories!");
    }

    if (files.length > remaining) {
      return flashAndRedirect('error',
        'You can only upload ' + remaining + ' more photo' + (remaining !== 1 ? 's' : '') +
        ' (limit: ' + PHOTO_LIMIT_PER_GUEST + ' per guest). You selected ' + files.length +
        ' — please remove ' + (files.length - remaining) + '.');
    }

    // Validate all files via magic bytes before writing anything to disk
    var validationErrors = [];
    var validated = [];
    for (var i = 0; i < files.length; i++) {
      var v = validateFile(files[i]);
      if (!v.ok) {
        validationErrors.push('Photo ' + (i + 1) + ' (' + (files[i].originalname || 'unknown') + '): ' + v.error);
      } else {
        validated.push({ file: files[i], mimeType: v.mimeType });
      }
    }

    if (validationErrors.length > 0) {
      return flashAndRedirect('error', validationErrors.join(' '));
    }

    // All valid — save to disk then insert into DB
    try {
      for (var j = 0; j < validated.length; j++) {
        var item     = validated[j];
        var filename = saveToDisk(item.file.buffer, item.mimeType);
        await db.insertPhoto({
          filename:        filename,
          originalName:    item.file.originalname ? item.file.originalname.substring(0, 255) : null,
          mimeType:        item.mimeType,
          fileSize:        item.file.size,
          uploaderName:    uploaderName,
          uploaderMessage: uploaderMessage,
        });
      }

      var count = validated.length;
      req.session.flash = {
        type:    'success',
        message: count === 1
          ? 'Your photo has been uploaded! It will appear in the gallery once approved. Thank you!'
          : count + ' photos have been uploaded! They will appear in the gallery once approved. Thank you!',
      };
      return res.redirect('/upload');
    } catch (dbErr) {
      console.error('[Upload] DB error:', dbErr.message);
      return flashAndRedirect('error', 'Something went wrong saving your photos. Please try again.');
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

// -- API: site status (consumed by static index.html) --
router.get('/api/site-status', asyncHandler(async function(req, res) {
  var [visibleSetting, channelSetting, homepageSetting] = await Promise.all([
    db.getSetting('livestream_visible'),
    db.getSetting('livestream_channel'),
    db.getSetting('livestream_homepage'),
  ]);
  res.json({
    livestreamVisible:  (visibleSetting === null || visibleSetting === '1'),
    livestreamChannel:  channelSetting || process.env.TWITCH_CHANNEL || null,
    livestreamHomepage: (homepageSetting === '1'),
  });
}));

// -- API: featured guest photos (consumed by static index.html) --
router.get('/api/featured-photos', asyncHandler(async function(req, res) {
  var photos = await db.getFeaturedPhotos();
  res.json(photos.map(function(p) {
    return {
      id:           p._id,
      filename:     p.filename,
      uploaderName: p.uploader_name || null,
    };
  }));
}));

module.exports = router;
