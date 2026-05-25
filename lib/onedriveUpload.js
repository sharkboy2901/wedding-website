'use strict';

/**
 * Microsoft OneDrive upload helper via Microsoft Graph API.
 *
 * Requires an Azure app registration with delegated permissions:
 *   ONEDRIVE_CLIENT_ID     – Azure app (client) ID
 *   ONEDRIVE_CLIENT_SECRET – Azure app client secret
 *   ONEDRIVE_REFRESH_TOKEN – OAuth2 refresh token (Files.ReadWrite + offline_access)
 *
 * The target folder path is stored in the DB as onedrive_folder_path.
 * It defaults to "Wedding Photos" if not set.
 *
 * Uses the consumers tenant so it works with personal Microsoft accounts (Outlook, Hotmail, Live).
 */

const fs = require('fs');

const TOKEN_URL  = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

let _cachedToken  = null;
let _tokenExpiry  = 0;

function isConfigured() {
  return !!(
    process.env.ONEDRIVE_CLIENT_ID &&
    process.env.ONEDRIVE_CLIENT_SECRET &&
    process.env.ONEDRIVE_REFRESH_TOKEN
  );
}

async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiry - 60_000) return _cachedToken;

  const clientId     = process.env.ONEDRIVE_CLIENT_ID;
  const clientSecret = process.env.ONEDRIVE_CLIENT_SECRET;
  const refreshToken = process.env.ONEDRIVE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) return null;

  const body = new URLSearchParams({
    client_id:     clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type:    'refresh_token',
    scope:         'https://graph.microsoft.com/Files.ReadWrite offline_access',
  });

  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('[OneDrive] Token refresh failed:', text);
    _cachedToken = null;
    return null;
  }

  const data     = await res.json();
  _cachedToken   = data.access_token;
  _tokenExpiry   = Date.now() + (data.expires_in * 1000);
  return _cachedToken;
}

/**
 * Resolve a slash-delimited folder path under the user's OneDrive root,
 * creating any missing folders along the way. Returns the final folder item ID.
 */
async function ensureFolder(token, folderPath) {
  const parts = (folderPath || 'Wedding Photos')
    .split('/')
    .map(function(p) { return p.trim(); })
    .filter(Boolean);

  let parentId = 'root';

  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];

    // List children of the current parent, filter by name client-side to avoid OData encoding edge cases
    var listRes = await fetch(
      GRAPH_BASE + '/me/drive/items/' + parentId + '/children?$select=id,name,folder&$top=200',
      { headers: { Authorization: 'Bearer ' + token } }
    );

    if (!listRes.ok) {
      var listText = await listRes.text();
      throw new Error('[OneDrive] Failed to list folder children: ' + listText);
    }

    var listData  = await listRes.json();
    var partLower = part.toLowerCase();
    var existing  = (listData.value || []).find(function(item) {
      return item.folder && item.name.toLowerCase() === partLower;
    });

    if (existing) {
      parentId = existing.id;
      continue;
    }

    // Create the missing folder
    var createRes = await fetch(
      GRAPH_BASE + '/me/drive/items/' + parentId + '/children',
      {
        method:  'POST',
        headers: {
          Authorization:  'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name:   part,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'rename',
        }),
      }
    );

    if (!createRes.ok) {
      var createText = await createRes.text();
      throw new Error('[OneDrive] Failed to create folder "' + part + '": ' + createText);
    }

    var folder = await createRes.json();
    parentId   = folder.id;
    console.log('[OneDrive] Created folder "' + part + '" (id: ' + folder.id + ')');
  }

  return parentId;
}

/**
 * Upload a file to OneDrive.
 * Uses a simple PUT for files < 4 MB, a resumable upload session otherwise.
 *
 * @param {string} filePath    Absolute local path to the file.
 * @param {string} displayName Desired filename in OneDrive.
 * @param {string} mimeType    MIME type (e.g. 'image/jpeg').
 * @param {string} folderPath  Slash-separated folder path inside OneDrive (e.g. 'Wedding Photos').
 * @returns {Promise<{id:string, webUrl:string}|null>}
 */
async function uploadToOneDrive(filePath, displayName, mimeType, folderPath) {
  const token = await getAccessToken();
  if (!token) {
    console.warn('[OneDrive] Skipping upload — credentials not configured or token refresh failed.');
    return null;
  }

  const folderId   = await ensureFolder(token, folderPath || 'Wedding Photos');
  const fileBuffer = fs.readFileSync(filePath);
  const fileSize   = fileBuffer.length;

  console.log('[OneDrive] Uploading "' + displayName + '" (' + fileSize + ' bytes) to folder id:', folderId);

  if (fileSize < 4 * 1024 * 1024) {
    return simpleUpload(token, folderId, displayName, mimeType, fileBuffer);
  }

  return resumableUpload(token, folderId, displayName, mimeType, fileBuffer);
}

async function simpleUpload(token, folderId, displayName, mimeType, fileBuffer) {
  var encoded = encodeURIComponent(displayName);
  var res = await fetch(
    GRAPH_BASE + '/me/drive/items/' + folderId + ':/' + encoded + ':/content',
    {
      method:  'PUT',
      headers: {
        Authorization:  'Bearer ' + token,
        'Content-Type': mimeType,
      },
      body: fileBuffer,
    }
  );

  if (!res.ok) {
    var text = await res.text();
    throw new Error('[OneDrive] Simple upload failed: ' + text);
  }

  var data = await res.json();
  console.log('[OneDrive] Uploaded "' + displayName + '" → item ID:', data.id);
  return { id: data.id, webUrl: data.webUrl };
}

async function resumableUpload(token, folderId, displayName, mimeType, fileBuffer) {
  var encoded = encodeURIComponent(displayName);

  // Create an upload session
  var sessionRes = await fetch(
    GRAPH_BASE + '/me/drive/items/' + folderId + ':/' + encoded + ':/createUploadSession',
    {
      method:  'POST',
      headers: {
        Authorization:  'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        item: {
          '@microsoft.graph.conflictBehavior': 'rename',
          name: displayName,
        },
      }),
    }
  );

  if (!sessionRes.ok) {
    var sessionText = await sessionRes.text();
    throw new Error('[OneDrive] Failed to create upload session: ' + sessionText);
  }

  var session    = await sessionRes.json();
  var uploadUrl  = session.uploadUrl;
  var fileSize   = fileBuffer.length;
  var CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB chunks (must be multiple of 320 KiB)
  var offset     = 0;
  var lastResult = null;

  while (offset < fileSize) {
    var end   = Math.min(offset + CHUNK_SIZE - 1, fileSize - 1);
    var chunk = fileBuffer.slice(offset, end + 1);

    var chunkRes = await fetch(uploadUrl, {
      method:  'PUT',
      headers: {
        'Content-Length': String(chunk.length),
        'Content-Range':  'bytes ' + offset + '-' + end + '/' + fileSize,
        'Content-Type':   mimeType,
      },
      body: chunk,
    });

    // 202 = more chunks needed; 200/201 = upload complete
    if (chunkRes.status !== 202 && !chunkRes.ok) {
      var chunkText = await chunkRes.text();
      throw new Error('[OneDrive] Chunk upload failed at byte ' + offset + ': ' + chunkText);
    }

    if (chunkRes.status === 200 || chunkRes.status === 201) {
      lastResult = await chunkRes.json();
    }

    offset = end + 1;
  }

  if (!lastResult) {
    throw new Error('[OneDrive] Upload completed but no final item response received.');
  }

  console.log('[OneDrive] Uploaded "' + displayName + '" → item ID:', lastResult.id);
  return { id: lastResult.id, webUrl: lastResult.webUrl };
}

module.exports = { uploadToOneDrive, isConfigured };
