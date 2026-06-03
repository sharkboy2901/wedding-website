/**
 * refresh-drive-token.js
 *
 * Run this script once to get a fresh OAuth2 refresh token for Google Drive.
 * The token lets the wedding website upload photos to your personal Google Drive.
 *
 * Usage:
 *   node scripts/refresh-drive-token.js
 *
 * You'll need GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET —
 * copy them from your Railway environment variables before running.
 */

'use strict';

const { google } = require('googleapis');
const readline   = require('readline');

// --- Paste your values here (or set as env vars) ---
const CLIENT_ID     = process.env.GOOGLE_OAUTH_CLIENT_ID     || 'PASTE_CLIENT_ID_HERE';
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || 'PASTE_CLIENT_SECRET_HERE';
// ----------------------------------------------------

if (CLIENT_ID === 'PASTE_CLIENT_ID_HERE' || CLIENT_SECRET === 'PASTE_CLIENT_SECRET_HERE') {
  console.error('\nERROR: Set your CLIENT_ID and CLIENT_SECRET first.');
  console.error('Either edit this file, or run:');
  console.error('  set GOOGLE_OAUTH_CLIENT_ID=your_id && set GOOGLE_OAUTH_CLIENT_SECRET=your_secret && node scripts/refresh-drive-token.js\n');
  process.exit(1);
}

const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob'; // Desktop/OOB flow — no redirect server needed
const SCOPES       = ['https://www.googleapis.com/auth/drive'];

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope:       SCOPES,
  prompt:      'consent', // Force consent screen so a refresh_token is always returned
});

console.log('\n=== Google Drive OAuth2 Token Generator ===\n');
console.log('1. Open this URL in your browser:\n');
console.log('   ' + authUrl);
console.log('\n2. Sign in with matthewbenhamed@gmail.com and click Allow.');
console.log('3. Copy the authorisation code shown and paste it below.\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Paste the authorisation code here: ', async function(code) {
  rl.close();
  try {
    const { tokens } = await oauth2Client.getToken(code.trim());
    console.log('\n=== SUCCESS ===\n');
    console.log('Set this in Railway environment variables:\n');
    console.log('  GOOGLE_OAUTH_REFRESH_TOKEN = ' + tokens.refresh_token);
    console.log('\nAlso make sure these are still set:');
    console.log('  GOOGLE_OAUTH_CLIENT_ID     = ' + CLIENT_ID);
    console.log('  GOOGLE_OAUTH_CLIENT_SECRET = ' + CLIENT_SECRET);
    console.log('\nAfter saving in Railway, Railway will redeploy and Drive uploads will work.\n');
  } catch (err) {
    console.error('\nERROR getting token:', err.message);
    if (err.message.includes('invalid_grant')) {
      console.error('The code may have expired (they are single-use). Run the script again and paste the code immediately.\n');
    }
  }
});
