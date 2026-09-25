require('dotenv').config();
const { google } = require('googleapis');
const JSZip = require('jszip');

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

async function extractDocxText(buf) {
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('word/document.xml').async('string');
    // Extract text from <w:t> tags
    const texts = [];
    const re = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let m;
    while ((m = re.exec(xml)) !== null) texts.push(m[1]);
    return texts.join('');
}

async function main() {
    const drive = await initDrive();
    const rootId = process.env.GOOGLE_DRIVE_FOLDER_ID || '0ACktHqI8zSSCUk9PVA';

    // Just sample one DOCX from BERNOULLI (a section with missing records)
    const folders = await drive.files.list({
        q: `name='11 BERNOULLI' and mimeType='application/vnd.google-apps.folder' and '${rootId}' in parents and trashed=false`,
        fields: 'files(id,name)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
    });
    const folderId = folders.data.files[0].id;

    const docxFiles = await drive.files.list({
        q: `'${folderId}' in parents and trashed=false and mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document'`,
        fields: 'files(id,name)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        pageSize: 5,
    });

    for (const f of docxFiles.data.files.slice(0, 2)) {
        console.log(`\n=== ${f.name} ===`);
        const buf = Buffer.from((await drive.files.get(
            { fileId: f.id, alt: 'media', supportsAllDrives: true },
            { responseType: 'arraybuffer' }
        )).data);
        const text = await extractDocxText(buf);
        console.log(text);
        console.log('---');
    }

    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
