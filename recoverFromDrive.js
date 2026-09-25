require('dotenv').config();
const { google } = require('googleapis');
const ExcelJS = require('exceljs');
const mongoose = require('mongoose');
const Student = require('./models/Student');
const Override = require('./models/Override');

const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '0ACktHqI8zSSCUk9PVA';

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
        auth = new GoogleAuth({
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
        auth = await auth.getClient();
    }
    return google.drive({ version: 'v3', auth });
}

async function listFolders(drive, parentId) {
    const res = await drive.files.list({
        q: `mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
        fields: 'files(id, name)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        pageSize: 100,
    });
    return res.data.files;
}

async function listFiles(drive, folderId, mimeType) {
    const res = await drive.files.list({
        q: `'${folderId}' in parents and trashed=false${mimeType ? ` and mimeType='${mimeType}'` : ''}`,
        fields: 'files(id, name, mimeType)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        pageSize: 100,
    });
    return res.data.files;
}

async function downloadFile(drive, fileId) {
    const res = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
    return Buffer.from(res.data);
}

function parseBirthday(str) {
    if (!str) return '';
    const iso = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const d = new Date(str);
    if (isNaN(d.getTime())) return str;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function parseDate(str) {
    if (!str) return null;
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
}

async function main() {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected.');

    const existing = await Student.countDocuments();
    console.log(`Current records in DB: ${existing}`);

    console.log('Connecting to Google Drive...');
    const drive = await initDrive();

    const sections = await listFolders(drive, ROOT_FOLDER_ID);
    console.log(`Found ${sections.length} section folders on Drive.`);

    let totalRecovered = 0;
    let totalSkipped = 0;

    for (const folder of sections) {
        const name = folder.name;
        if (name.endsWith('_bulk') || name === 'Overall Student Logs') continue;

        const files = await listFiles(drive, folder.id, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        const excelFile = files.find(f => f.name.includes('Records'));
        if (!excelFile) {
            console.log(`  [SKIP] ${name}: no Excel found`);
            continue;
        }

        try {
            const buf = await downloadFile(drive, excelFile.id);
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(buf);
            const ws = workbook.worksheets[0];
            if (!ws) { console.log(`  [SKIP] ${name}: empty sheet`); continue; }

            const headerRow = ws.getRow(1);
            const colMap = {};
            headerRow.eachCell((cell, colNumber) => {
                const h = String(cell.value || '').trim().toLowerCase();
                colMap[h] = colNumber;
            });

            const rows = [];
            ws.eachRow((row, rowNumber) => {
                if (rowNumber === 1) return;
                const val = (h) => { const c = colMap[h]; return c ? String(row.getCell(c).value || '').trim() : ''; };
                const lrn = val('lrn');
                if (!lrn) return;
                rows.push({
                    lrn,
                    lastName: val('last name'),
                    firstName: val('first name'),
                    middleName: val('middle name'),
                    sex: val('sex'),
                    section: val('section') || name,
                    birthday: parseBirthday(val('birthday')),
                    address: val('address'),
                    parentName: val('parent/guardian') || val('parent'),
                    contactNumber: val('contact') || val('contact number'),
                    uploadStatus: val('status') || 'uploaded',
                    photoLink: val('photo link'),
                    idCardLink: val('id card link'),
                    entryMethod: val('entry method') || 'Individual',
                    createdAt: parseDate(val('created')),
                    updatedAt: parseDate(val('updated')),
                });
            });

            let recovered = 0, skipped = 0;
            for (const r of rows) {
                const dup = await Student.findOne({ lrn: r.lrn });
                if (dup) { skipped++; continue; }

                const driveFiles = {};
                if (r.photoLink) driveFiles.photo = { success: true, fileLink: r.photoLink };
                if (r.idCardLink) driveFiles.idCardDocx = { success: true, fileLink: r.idCardLink };

                await Student.create({
                    firstName: r.firstName,
                    middleName: r.middleName,
                    lastName: r.lastName,
                    sex: r.sex,
                    birthday: r.birthday,
                    lrn: r.lrn,
                    section: r.section,
                    address: r.address,
                    parentName: r.parentName,
                    contactNumber: r.contactNumber,
                    entryMethod: r.entryMethod,
                    photoPath: '',
                    photoMime: 'image/jpeg',
                    photoSource: 'recovered',
                    uploadStatus: r.uploadStatus === 'uploaded' ? 'uploaded' : 'pending',
                    uploadError: null,
                    driveUploaded: !!r.photoLink,
                    driveLink: r.photoLink || null,
                    driveFiles: Object.keys(driveFiles).length > 0 ? driveFiles : null,
                    idCardDocxPath: null,
                    createdAt: r.createdAt || new Date(),
                    updatedAt: r.updatedAt || new Date(),
                });
                recovered++;
            }

            totalRecovered += recovered;
            totalSkipped += skipped;
            console.log(`  [OK] ${name}: ${recovered} recovered, ${skipped} skipped (already in DB)`);
        } catch (err) {
            console.error(`  [ERR] ${name}: ${err.message}`);
        }
    }

    console.log(`\n=== RECOVERY COMPLETE ===`);
    console.log(`Recovered: ${totalRecovered}`);
    console.log(`Skipped (duplicate LRN): ${totalSkipped}`);
    const finalCount = await Student.countDocuments();
    console.log(`Total records in DB: ${finalCount}`);

    await mongoose.disconnect();
    process.exit(0);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
