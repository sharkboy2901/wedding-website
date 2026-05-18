'use strict';

const Datastore = require('nedb-promises');
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

// -- Datastores --

const photosDb   = Datastore.create({ filename: path.join(DB_DIR, 'photos.db'),   autoload: true });
const rsvpsDb    = Datastore.create({ filename: path.join(DB_DIR, 'rsvps.db'),    autoload: true });
const adminDb    = Datastore.create({ filename: path.join(DB_DIR, 'admin.db'),    autoload: true });
const settingsDb = Datastore.create({ filename: path.join(DB_DIR, 'settings.db'), autoload: true });

photosDb.ensureIndex({ fieldName: 'filename', unique: true });
adminDb.ensureIndex({ fieldName: 'username', unique: true });
settingsDb.ensureIndex({ fieldName: 'key', unique: true });

// -- Photo operations --

async function insertPhoto({ filename, originalName, mimeType, fileSize, uploaderName, uploaderMessage }) {
  return photosDb.insert({
    filename,
    originalName:    originalName    || null,
    mimeType,
    fileSize,
    status:          'pending',
    uploaderName:    uploaderName    || null,
    uploaderMessage: uploaderMessage || null,
    uploadedAt:      new Date().toISOString(),
    reviewedAt:      null,
  });
}

async function getApprovedPhotos() {
  const photos = await photosDb.find({ status: 'approved' }).sort({ reviewedAt: -1 });
  return photos.map(normalisePhoto);
}

async function getFeaturedPhotos() {
  const photos = await photosDb.find({ status: 'approved', featured: true }).sort({ reviewedAt: -1 });
  return photos.map(normalisePhoto);
}

async function setPhotoFeatured(id, featured) {
  return photosDb.update({ _id: id }, { $set: { featured: !!featured } });
}

async function getPendingPhotos() {
  const photos = await photosDb.find({ status: 'pending' }).sort({ uploadedAt: 1 });
  return photos.map(normalisePhoto);
}

async function getPhotoById(id) {
  const photo = await photosDb.findOne({ _id: id });
  return photo ? normalisePhoto(photo) : null;
}

async function updatePhotoStatus(id, status) {
  return photosDb.update(
    { _id: id },
    { $set: { status, reviewedAt: new Date().toISOString() } }
  );
}

async function getPhotoStats() {
  const [pending, approved, rejected] = await Promise.all([
    photosDb.count({ status: 'pending' }),
    photosDb.count({ status: 'approved' }),
    photosDb.count({ status: 'rejected' }),
  ]);
  return { pending, approved, rejected };
}

/**
 * Count non-rejected photos submitted by a guest (case-insensitive name match).
 * Used to enforce the per-guest upload limit.
 */
async function getPhotoCountByGuest(uploaderName) {
  if (!uploaderName || !uploaderName.trim()) return 0;
  const escaped = uploaderName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameRe  = new RegExp('^' + escaped + '$', 'i');
  return photosDb.count({ uploaderName: nameRe, status: { $ne: 'rejected' } });
}

function normalisePhoto(doc) {
  return {
    id:               doc._id,
    filename:         doc.filename,
    original_name:    doc.originalName,
    mime_type:        doc.mimeType,
    file_size:        doc.fileSize,
    status:           doc.status,
    featured:         !!doc.featured,
    uploader_name:    doc.uploaderName,
    uploader_message: doc.uploaderMessage,
    uploaded_at:      doc.uploadedAt,
    reviewed_at:      doc.reviewedAt,
  };
}

// -- Site Settings operations --

async function getSetting(key) {
  const doc = await settingsDb.findOne({ key });
  return doc ? doc.value : null;
}

async function setSetting(key, value) {
  const existing = await settingsDb.findOne({ key });
  if (existing) {
    return settingsDb.update({ key }, { $set: { value: String(value) } });
  }
  return settingsDb.insert({ key, value: String(value) });
}

async function getAllSettings() {
  const docs = await settingsDb.find({});
  const result = {};
  docs.forEach(function(doc) { result[doc.key] = doc.value; });
  return result;
}

// -- RSVP operations --

async function insertRsvp({ name, email, attending, guestCount, dietaryRequirements, songRequest, message }) {
  return rsvpsDb.insert({
    name:                 name.trim().substring(0, 100),
    email:                email ? email.trim().substring(0, 200) : null,
    attending,
    guest_count:          guestCount || 0,
    dietary_requirements: dietaryRequirements ? dietaryRequirements.trim().substring(0, 500) : null,
    song_request:         songRequest ? songRequest.trim().substring(0, 200) : null,
    message:              message ? message.trim().substring(0, 1000) : null,
    created_at:           new Date().toISOString(),
  });
}

async function getAllRsvps() {
  return rsvpsDb.find({}).sort({ created_at: -1 });
}

async function deleteRsvp(id) {
  return rsvpsDb.remove({ _id: id }, {});
}

async function getRsvpStats() {
  const all = await rsvpsDb.find({});
  const yes = all.filter(function(r) { return r.attending === 'yes'; });
  return {
    yes_count:    yes.length,
    no_count:     all.filter(function(r) { return r.attending === 'no'; }).length,
    maybe_count:  all.filter(function(r) { return r.attending === 'maybe'; }).length,
    total_guests: yes.reduce(function(sum, r) { return sum + (r.guest_count || 0); }, 0),
  };
}

// -- Admin operations --

async function getAdminByUsername(username) {
  return adminDb.findOne({ username });
}

async function upsertAdmin(username, passwordHash) {
  const existing = await adminDb.findOne({ username });
  if (existing) {
    return adminDb.update({ username }, { $set: { password_hash: passwordHash } });
  }
  return adminDb.insert({ username, password_hash: passwordHash, created_at: new Date().toISOString() });
}

async function ensureAdminExists(username, plainPassword) {
  const existing = await getAdminByUsername(username);
  if (!existing) {
    const hash = await bcrypt.hash(plainPassword, 12);
    await upsertAdmin(username, hash);
    console.log('[Auth] Admin account created for username: ' + username);
  }
}

module.exports = {
  insertPhoto,
  getApprovedPhotos,
  getFeaturedPhotos,
  setPhotoFeatured,
  getPendingPhotos,
  getPhotoById,
  updatePhotoStatus,
  getPhotoStats,
  getPhotoCountByGuest,
  insertRsvp,
  getAllRsvps,
  deleteRsvp,
  getRsvpStats,
  getAdminByUsername,
  upsertAdmin,
  ensureAdminExists,
  getSetting,
  setSetting,
  getAllSettings,
};
