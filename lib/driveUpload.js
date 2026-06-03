'use strict';

/**
 * Google Drive upload helper.
 *
 * Supports two auth methods (checked in order):
 *
 * 1. Service account JSON (preferred — credentials never expire):
 *    GOOGLE_SERVICE_ACCOUNT_JSON  (raw JSON or base64-encoded)
 *    The target Drive folder must be shared with the service account email.
 *
 * 2. OAuth2 refresh token (fallback, works with personal Gmail accounts):
 *    GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN
 */

const { google } = require('googleapis');
const fs = require('fs');

let _drive    = null;
let _driveKey = null; // cache-bust token

function getDriveClient() {
  // ── Service account JSON (preferred — credentials never expire) ───────────
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    try {
      const json  = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
      const creds = JSON.parse(json);
      const key   = 'sa:' + creds.client_email;
      if (_drive && _driveKey === key) return _drive;

      const auth = new google.auth.GoogleAuth({
        credentials: creds,
        scopes: ['https://www.googleapis.com/auth/drive'],
      });
      _drive    = google.drive({ version: 'v3', auth });
      _driveKey = key;
      console.log('[Drive] Service-account client initialised for:', creds.client_email);
      return _drive;
    } catch (err) {
      console.error('[Drive] Failed to initialise service-account client:', err.message);
      _drive = null;
      // Fall through to OAuth2
    }
  }

  // ── OAuth2 refresh token (fallback for personal Gmail accounts) ───────────
  const clientId     = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (clientId && clientSecret && refreshToken) {
    const key = 'oauth:' + clientId + ':' + refreshToken.slice(-8);
    if (_drive && _driveKey === key) return _drive;
    try {
      const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
      oauth2.setCredentials({ refresh_token: refreshToken });
      _drive    = google.drive({ version: 'v3', auth: oauth2 });
      _driveKey = key;
      console.log('[Drive] OAuth2 client initialised (personal account mode)');
      return _drive;
    } catch (err) {
      console.error('[Drive] Failed to initialise OAuth2 client:', err.message);
      _drive = null;
      return null;
    }
  }

  _drive = null;
  return null;
}

/**
 * Upload a file to Google Drive.
 *
 * @param {string}      filePath    Absolute path to the local file.
 * @param {string}      displayName Name to give the file in Drive.
 * @param {string}      mimeType    MIME type of the file.
 * @param {string|null} folderId    Target Drive folder ID (null = root).
 * @returns {Promise<{id:string, webViewLink:string}|null>}
 */
async function uploadToDrive(filePath, displayName, mimeType, folderId) {
  const drive = getDriveClient();
  if (!drive) {
    console.warn('[Drive] Skipping upload — no Drive credentials configured.');
    return null;
  }

  console.log('[Drive] Target folder ID:', folderId, '| file:', filePath);

  const metadata = { name: displayName };
  if (folderId) metadata.parents = [folderId];

  try {
    const res = await drive.files.create({
      requestBody: metadata,
      media: { mimeType, body: fs.createReadStream(filePath) },
      fields: 'id,webViewLink',
      supportsAllDrives: true,
    });
    console.log('[Drive] Uploaded "' + displayName + '" → file ID:', res.data.id);
    return res.data;
  } catch (err) {
    console.error('[Drive] Upload failed for "' + displayName + '":', err.message);
    if (err.errors) console.error('[Drive] Details:', JSON.stringify(err.errors));
    throw err;
  }
}

/**
 * Extract the folder ID from a full Google Drive URL or return the bare ID as-is.
 * e.g. https://drive.google.com/drive/folders/FOLDER_ID → FOLDER_ID
 */
function extractFolderId(urlOrId) {
  if (!urlOrId) return urlOrId;
  var match = urlOrId.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : urlOrId;
}

/**
 * Given a Drive URL or bare folder ID, return the canonical full URL.
 */
function normalizeFolderInput(urlOrId) {
  if (!urlOrId) return urlOrId;
  return 'https://drive.google.com/drive/folders/' + extractFolderId(urlOrId);
}

/**
 * Stream a Drive file directly to an Express response.
 */
async function streamFromDrive(res, fileId, mimeType) {
  var drive = getDriveClient();
  if (!drive) {
    console.warn('[Drive] streamFromDrive — no credentials configured.');
    return res.status(503).send('Google Drive not configured.');
  }
  try {
    var response = await drive.files.get(
      { fileId: fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' }
    );
    res.setHeader('Content-Type', mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    response.data.pipe(res);
  } catch (err) {
    console.error('[Drive] streamFromDrive failed for fileId ' + fileId + ':', err.message);
    if (!res.headersSent) res.status(502).send('Failed to retrieve file from Drive.');
  }
}

module.exports = { uploadToDrive, extractFolderId, normalizeFolderInput, streamFromDrive };
