require('dotenv').config();
const { google } = require('googleapis');
const JSZip = require('jszip');
const mongoose = require('mongoose');
const Student = require('./models/Student');

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

async function extractDocxRuns(buf) {
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('word/document.xml').async('string');
    const runs = [];
    const re = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let m;
    while ((m = re.exec(xml)) !== null) runs.push(m[1]);
    return runs;
}

function parseBirthday(str) {
    if (!str) return '';
    const iso = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const d = new Date(str);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function parseDocxRuns(runs) {
    const joined = runs.join('');
    const firstName = (runs[18] || '').trim();
    const middleName = (runs[19] || '').trim();
    const lastName = (runs[0] || '').trim();
    const guardian = (runs[2] || '').trim();
    const lrn = runs[29] || '';
    const sex = (runs[10] || '').replace('Sex:', '').trim();
    const birthdayRaw = (runs[12] || '').replace('Birthday:', '').trim();
    const address = (runs[15] || '').trim();
    const contact = (runs[6] || '').trim();
    const middleInitial = (runs[37] || '').replace('.', '').trim();

    if (!lrn || !firstName || !lastName) return null;
    return { firstName, middleName, lastName, guardian, lrn, sex, birthday: parseBirthday(birthdayRaw), address, contact, middleInitial };
}

async function main() {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected.');

    const drive = await initDrive();
    const folders = await drive.files.list({
        q: `mimeType='application/vnd.google-apps.folder' and '${ROOT_FOLDER_ID}' in parents and trashed=false`,
        fields: 'files(id,name)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
    });

    let totalRecovered = 0, totalSkipped = 0, totalErrors = 0;

    for (const folder of folders.data.files) {
        const section = folder.name;
        if (!section.startsWith('11 ')) continue;

        // Get all files in folder
        const files = await drive.files.list({
            q: `'${folder.id}' in parents and trashed=false`,
            fields: 'files(id,name,mimeType)',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
            pageSize: 500,
        });

        const docxFiles = files.data.files.filter(f => f.mimeType && f.mimeType.includes('wordprocessingml') && f.name.endsWith('_ID.docx'));
        const photoFiles = files.data.files.filter(f => f.mimeType && f.mimeType.startsWith('image/') && f.name.endsWith('_PIC.jpg'));

        // Build photo map: "LASTNAME_FIRSTNAME" -> { fileLink, fileId }
        const photoMap = {};
        for (const p of photoFiles) {
            const base = p.name.replace('_PIC.jpg', '');
            if (!photoMap[base]) {
                photoMap[base] = {
                    fileLink: `https://drive.google.com/file/d/${p.id}/view?usp=drive_link`,
                    fileId: p.id,
                };
            }
        }

        console.log(`\n=== ${section}: ${docxFiles.length} DOCX, ${photoFiles.length} photos ===`);

        for (const docx of docxFiles) {
            const base = docx.name.replace('_ID.docx', '');
            try {
                // Check if already in DB by matching name+section (approximate) or by LRN later
                const buf = Buffer.from((await drive.files.get(
                    { fileId: docx.id, alt: 'media', supportsAllDrives: true },
                    { responseType: 'arraybuffer' }
                )).data);
                const runs = await extractDocxRuns(buf);
                const data = parseDocxRuns(runs);
                if (!data) {
                    console.log(`  [PARSE-FAIL] ${docx.name}`);
                    totalErrors++;
                    continue;
                }

                // Dedupe by LRN
                const existing = await Student.findOne({ lrn: data.lrn });
                if (existing) {
                    totalSkipped++;
                    continue;
                }

                const photo = photoMap[base];
                const idCardLink = `https://drive.google.com/file/d/${docx.id}/view?usp=drive_link`;

                await Student.create({
                    firstName: data.firstName,
                    middleName: data.middleName,
                    lastName: data.lastName,
                    sex: data.sex,
                    birthday: data.birthday,
                    lrn: data.lrn,
                    section: section,
                    address: data.address,
                    parentName: data.guardian,
                    contactNumber: data.contact,
                    entryMethod: 'Individual',
                    photoPath: '',
                    photoMime: 'image/jpeg',
                    photoSource: 'recovered',
                    uploadStatus: 'uploaded',
                    uploadError: null,
                    driveUploaded: true,
                    driveLink: photo ? photo.fileLink : null,
                    driveFiles: {
                        photo: photo ? { success: true, fileLink: photo.fileLink, fileName: photo ? `${base}_PIC.jpg` : '' } : null,
                        idCardDocx: { success: true, fileLink: idCardLink, fileName: docx.name },
                    },
                    idCardDocxPath: null,
                });
                totalRecovered++;
                console.log(`  [OK] ${data.lastName}, ${data.firstName} (LRN ${data.lrn})`);
            } catch (err) {
                console.error(`  [ERR] ${docx.name}: ${err.message}`);
                totalErrors++;
            }
        }
    }

    console.log(`\n=== DOCX RECOVERY COMPLETE ===`);
    console.log(`Recovered: ${totalRecovered}`);
    console.log(`Skipped (LRN exists): ${totalSkipped}`);
    console.log(`Errors: ${totalErrors}`);
    const finalCount = await Student.countDocuments();
    console.log(`Total records in DB: ${finalCount}`);

    await mongoose.disconnect();
    process.exit(0);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
