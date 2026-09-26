// READ-ONLY — list files in the 11 CHATTERTON Drive folder (no changes)
require('dotenv').config();
const { google } = require('googleapis');

async function initDrive() {
    const oauthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const oauthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    let auth;
    if (oauthClientId && oauthClientSecret && refreshToken) {
        auth = new google.auth.OAuth2(oauthClientId, oauthClientSecret);
        auth.setCredentials({ refresh_token: refreshToken });
    } else {
        const { GoogleAuth } = require('google-auth-library');
        const ga = new GoogleAuth({
            credentials: {
                type: 'service_account',
                project_id: process.env.GOOGLE_PROJECT_ID,
                private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
                private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
                client_email: process.env.GOOGLE_CLIENT_EMAIL,
                client_id: process.env.GOOGLE_CLIENT_ID,
            },
            scopes: ['https://www.googleapis.com/auth/drive'],
        });
        auth = await ga.getClient();
    }
    return google.drive({ version: 'v3', auth });
}

(async () => {
    const drive = await initDrive();
    const rootId = process.env.GOOGLE_DRIVE_FOLDER_ID || '0ACktHqI8zSSCUk9PVA';

    const folders = await drive.files.list({
        q: `mimeType='application/vnd.google-apps.folder' and '${rootId}' in parents and trashed=false`,
        fields: 'files(id, name)', supportsAllDrives: true, includeItemsFromAllDrives: true, pageSize: 200
    });
    const target = folders.data.files.find(f => f.name.toUpperCase().includes('CHATTERTON'));
    if (!target) { console.log('CHATTERTON folder NOT FOUND'); process.exit(0); }
    console.log(`Folder: ${target.name}  id=${target.id}`);

    const files = await drive.files.list({
        q: `'${target.id}' in parents and trashed=false`,
        fields: 'files(id, name, mimeType, size)', supportsAllDrives: true, includeItemsFromAllDrives: true, pageSize: 1000
    });
    const fs2 = files.data.files;
    console.log(`Files inside: ${fs2.length}`);
    const cats = { pic: 0, picFull: 0, docx: 0, xlsx: 0, other: 0 };
    for (const f of fs2) {
        if (f.name.endsWith('_PIC.jpg') || f.name.endsWith('_PIC.png')) cats.pic++;
        else if (f.name.includes('_PIC_FULL')) cats.picFull++;
        else if (f.name.endsWith('_ID.docx')) cats.docx++;
        else if (f.name.match(/\.xlsx$/i)) { cats.xlsx++; console.log(`  XLSX: ${f.name}`); }
        else { cats.other++; console.log(`  OTHER: ${f.name}`); }
    }
    console.log('Summary:', JSON.stringify(cats));
    process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
