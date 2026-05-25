'use strict';

/**
 * Google Drive upload helper.
 *
 * Requires the GOOGLE_SERVICE_ACCOUNT_JSON environment variable.
 * The value can be the raw JSON string or a base64-encoded version of it.
 *
 * The service account must have "Editor" access (or be added as a member)
 * on the target Drive folder for uploads to succeed.
 */

const { google } = require('googleapis');
const fs = require('fs');

let _drive = null;

function getDriveClient() {
  if (_drive) return _drive;

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;

  try {
    const json = raw.trim().startsWith('{')
      ? raw
      : Buffer.from(raw, 'base64').toString('utf8');
    const creds = JSON.parse(json);

    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });

    _drive = google.drive({ version: 'v3', auth });
    return _drive;
  } catch (err) {
    console.error('[Drive] Failed to initialise Drive client:', err.message);
    return null;
  }
}

/**
 * Upload a file to Google Drive.
 *
 * @param {string} filePath   Absolute path to the local file.
 * @param {string} displayName  Name to give the file in Drive.
 * @param {string} mimeType   MIME type of the file.
 * @param {string|null} folderId  Target Drive folder ID (null = root "My Drive").
 * @returns {Promise<{id:string, webViewLink:string}|null>}
 */
async function uploadToDrive(filePath, displayName, mimeType, folderId) {
  const drive = getDriveClient();
  if (!drive) {
    console.warn('[Drive] Skipping upload — GOOGLE_SERVICE_ACCOUNT_JSON not configured.');
    return null;
  }

  const metadata = { name: displayName };
  if (folderId) metadata.parents = [folderId];

  try {
    const res = await drive.files.create({
      requestBody: metadata,
      media: { mimeType, body: fs.createReadStream(filePath) },
      fields: 'id,webViewLink',
    });
    console.log('[Drive] Uploaded "' + displayName + '" → file ID: ' + res.data.id);
    return res.data;
  } catch (err) {
    console.error('[Drive] Upload failed for "' + displayName + '":', err.message);
    return null;
  }
}

/**
 * Extract the folder ID from a full Google Drive folder URL or bare ID.
 * e.g. https://drive.google.com/drive/folders/FOLDER_ID?usp=sharing → FOLDER_ID
 * If the input doesn't match the pattern, it's returned as-is (assumed to be a bare ID).
 */
function extractFolderId(urlOrId) {
  if (!urlOrId) return urlOrId;
  var match = urlOrId.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : urlOrId;
}

/**
 * Given either a full Drive folder URL or a bare folder ID, always returns
 * the canonical full URL https://drive.google.com/drive/folders/FOLDER_ID.
 */
function normalizeFolderInput(urlOrId) {
  if (!urlOrId) return urlOrId;
  var id = extractFolderId(urlOrId);
  return 'https://drive.google.com/drive/folders/' + id;
}

/**
 * Stream a file from Google Drive by fileId directly to an Express response.
 *
 * @param {object} res       Express response object.
 * @param {string} fileId    Google Drive file ID.
 * @param {string} mimeType  MIME type for the Content-Type header.
 */
async function streamFromDrive(res, fileId, mimeType) {
  var drive = getDriveClient();
  if (!drive) {
    console.warn('[Drive] streamFromDrive called but Drive client is not configured.');
    return res.status(503).send('Google Drive not configured.');
  }
  try {
    var response = await drive.files.get(
      { fileId: fileId, alt: 'media' },
      { responseType: 'stream' }
    );
    res.setHeader('Content-Type', mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    response.data.pipe(res);
  } catch (err) {
    console.error('[Drive] streamFromDrive failed for fileId ' + fileId + ':', err.message);
    if (!res.headersSent) {
      res.status(502).send('Failed to retrieve file from Google Drive.');
    }
  }
}

module.exports = { uploadToDrive, extractFolderId, normalizeFolderInput, streamFromDrive };
