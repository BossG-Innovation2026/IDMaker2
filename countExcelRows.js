require('dotenv').config();
const { google } = require('googleapis');
const ExcelJS = require('exceljs');

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

async function main() {
    const drive = await initDrive();
    const rootId = process.env.GOOGLE_DRIVE_FOLDER_ID || '0ACktHqI8zSSCUk9PVA';

    const folders = await drive.files.list({
        q: `mimeType='application/vnd.google-apps.folder' and '${rootId}' in parents and trashed=false`,
        fields: 'files(id,name)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
    });

    for (const f of folders.data.files) {
        const xlsx = await drive.files.list({
            q: `'${f.id}' in parents and trashed=false and mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'`,
            fields: 'files(id,name)',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
        });
        if (xlsx.data.files.length === 0) {
            console.log(`${f.name}: NO EXCEL`);
            continue;
        }
        const buf = Buffer.from((await drive.files.get(
            { fileId: xlsx.data.files[0].id, alt: 'media', supportsAllDrives: true },
            { responseType: 'arraybuffer' }
        )).data);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf);
        const ws = wb.worksheets[0];
        let rows = 0;
        ws.eachRow((r, n) => { if (n > 1 && r.getCell(2).value) rows++; });
        console.log(`${f.name}: Excel rows = ${rows}`);
    }
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
