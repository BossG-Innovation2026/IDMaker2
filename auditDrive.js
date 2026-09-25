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

    // 1. Read Overall Student Logs Excel
    const rootFiles = await drive.files.list({
        q: `'${rootId}' in parents and trashed=false and mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'`,
        fields: 'files(id,name)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
    });

    for (const f of rootFiles.data.files) {
        console.log(`\n=== ROOT EXCEL: ${f.name} ===`);
        const buf = Buffer.from((await drive.files.get(
            { fileId: f.id, alt: 'media', supportsAllDrives: true },
            { responseType: 'arraybuffer' }
        )).data);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf);
        for (const ws of wb.worksheets) {
            console.log(`Sheet: ${ws.name}, rows: ${ws.rowCount}`);
            let dataRows = 0;
            const sectionCounts = {};
            const headers = [];
            ws.getRow(1).eachCell((c) => headers.push(String(c.value || '')));
            console.log(`Headers: ${headers.join(' | ')}`);
            ws.eachRow((r, n) => {
                if (n === 1) return;
                const lrn = String(r.getCell(2).value || '').trim();
                if (!lrn) return;
                dataRows++;
                const section = String(r.getCell(8).value || '').trim();
                sectionCounts[section] = (sectionCounts[section] || 0) + 1;
            });
            console.log(`Data rows: ${dataRows}`);
            Object.entries(sectionCounts).sort().forEach(([s, c]) => console.log(`  ${s}: ${c}`));
        }
    }

    // 2. Compare photo filenames vs Excel LRNs per section
    console.log('\n=== PHOTO vs EXCEL PER SECTION ===');
    const folders = await drive.files.list({
        q: `mimeType='application/vnd.google-apps.folder' and '${rootId}' in parents and trashed=false`,
        fields: 'files(id,name)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
    });

    for (const folder of folders.data.files) {
        const files = await drive.files.list({
            q: `'${folder.id}' in parents and trashed=false`,
            fields: 'files(id,name,mimeType)',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
            pageSize: 500,
        });

        const photos = files.data.files.filter(x => x.mimeType && x.mimeType.startsWith('image/'));
        const uniqPhotoNames = [...new Set(photos.map(p => p.name))];

        const xlsx = files.data.files.find(x => x.mimeType && x.mimeType.includes('spreadsheet'));
        let excelNames = [];
        if (xlsx) {
            const buf = Buffer.from((await drive.files.get(
                { fileId: xlsx.id, alt: 'media', supportsAllDrives: true },
                { responseType: 'arraybuffer' }
            )).data);
            const wb = new ExcelJS.Workbook();
            await wb.xlsx.load(buf);
            const ws = wb.worksheets[0];
            ws.eachRow((r, n) => {
                if (n === 1) return;
                const first = String(r.getCell(4).value || '').trim(); // First Name
                const last = String(r.getCell(3).value || '').trim(); // Last Name
                if (last && first) excelNames.push(`${last}_${first}`.toUpperCase());
            });
        }

        // Extract names from photo filenames: LASTNAME_FIRSTNAME_PIC.jpg
        const photoNames = uniqPhotoNames
            .filter(n => n.endsWith('_PIC.jpg'))
            .map(n => n.replace('_PIC.jpg', '').toUpperCase());

        const uniqPhotoSet = new Set(photoNames);
        const excelSet = new Set(excelNames);
        const photosNotInExcel = [...uniqPhotoSet].filter(n => !excelSet.has(n));
        const excelNotInPhotos = [...excelSet].filter(n => !uniqPhotoSet.has(n));

        console.log(`\n${folder.name}: ${photos.length} photos (${uniqPhotoSet.size} unique), Excel ${excelSet.size}`);
        if (photosNotInExcel.length > 0) {
            console.log(`  PHOTOS NOT IN EXCEL (${photosNotInExcel.length}):`);
            photosNotInExcel.forEach(n => console.log(`    + ${n}`));
        }
        if (excelNotInPhotos.length > 0) {
            console.log(`  EXCEL NOT IN PHOTOS (${excelNotInPhotos.length}):`);
            excelNotInPhotos.forEach(n => console.log(`    - ${n}`));
        }
    }

    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
