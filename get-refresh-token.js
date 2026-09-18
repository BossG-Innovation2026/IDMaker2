/*
 * Local helper to obtain a Google OAuth2 refresh token for Drive uploads.
 *
 * Usage:
 *   node get-refresh-token.js <CLIENT_ID> <CLIENT_SECRET>
 *
 * Before running, in Google Cloud Console -> APIs & Services -> Credentials:
 *   1. Create an OAuth client ID (type: Web application)
 *   2. Add this Authorized redirect URI:
 *          http://localhost:5555/oauth2callback
 *   3. Make sure the Drive API is enabled and your account is added as a
 *      test user on the OAuth consent screen.
 *
 * Then run the command, open the printed URL, sign in with the SAME account
 * that owns your "SCHOOL ID" Drive folder, and copy the printed refresh token.
 */
const http = require('http');
const { URL } = require('url');
const { google } = require('googleapis');

const CLIENT_ID = process.argv[2];
const CLIENT_SECRET = process.argv[3];
const PORT = 5555;
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.log('Usage: node get-refresh-token.js <CLIENT_ID> <CLIENT_SECRET>');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/drive']
});

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
  if (reqUrl.pathname !== '/oauth2callback') {
    res.writeHead(404).end('Not found');
    return;
  }

  const code = reqUrl.searchParams.get('code');
  if (!code) {
    res.writeHead(400).end('No code returned. Error: ' + reqUrl.searchParams.get('error'));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Success! Close this tab and return to the terminal.');

  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('\n=================== REFRESH TOKEN ===================');
    console.log(tokens.refresh_token || '(no refresh_token returned - re-run with prompt=consent)');
    console.log('=====================================================\n');
  } catch (err) {
    console.error('Token exchange failed:', err.message);
  } finally {
    server.close();
    process.exit(0);
  }
});

server.listen(PORT, () => {
  console.log('\nOpen this URL in your browser and sign in with the account that owns the folder:\n');
  console.log(authUrl);
  console.log('\nWaiting for the callback on ' + REDIRECT + ' ...\n');
});
