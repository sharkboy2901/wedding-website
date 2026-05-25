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
      scopes: ['https://www.googleapis.com/auth/drive.file'],
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

module.exports = { uploadToDrive };
