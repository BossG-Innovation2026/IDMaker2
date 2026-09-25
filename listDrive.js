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

async function listFolders(drive, parentId, indent = '') {
    const res = await drive.files.list({
        q: `mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
        fields: 'files(id, name)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        pageSize: 200,
    });
    return res.data.files;
}

async function listFiles(drive, folderId) {
    const res = await drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'files(id, name, mimeType, size)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        pageSize: 200,
    });
    return res.data.files;
}

async function main() {
    const drive = await initDrive();
    const rootId = process.env.GOOGLE_DRIVE_FOLDER_ID || '0ACktHqI8zSSCUk9PVA';

    console.log('=== ROOT FOLDER ===');
    const folders = await listFolders(drive, rootId);
    const files = await listFiles(drive, rootId);
    console.log(`Folders: ${folders.length} | Files: ${files.length}`);
    files.forEach(f => console.log(`  FILE: ${f.name}`));

    for (const folder of folders.sort((a, b) => a.name.localeCompare(b.name))) {
        console.log(`\n=== ${folder.name} ===`);
        const subFolders = await listFolders(drive, folder.id);
        const subFiles = await listFiles(drive, folder.id);
        subFiles.forEach(f => {
            const size = f.size ? ` (${Math.round(f.size/1024)}KB)` : '';
            console.log(`  FILE: ${f.name}${size}`);
        });
        if (subFolders.length > 0) {
            subFolders.forEach(sf => console.log(`  SUBFOLDER: ${sf.name}`));
        }
        // For section folders, also list photos/docx
        if (folder.name.includes('11 ')) {
            const allFiles = await listFiles(drive, folder.id);
            const photos = allFiles.filter(f => f.mimeType && f.mimeType.startsWith('image/'));
            const docx = allFiles.filter(f => f.mimeType && f.mimeType.includes('wordprocessingml'));
            const xlsx = allFiles.filter(f => f.mimeType && f.mimeType.includes('spreadsheet'));
            console.log(`  Summary: ${photos.length} photos, ${docx.length} docx, ${xlsx.length} excel`);
        }
    }

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
