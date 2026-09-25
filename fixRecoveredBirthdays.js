require('dotenv').config();
const { google } = require('googleapis');
const JSZip = require('jszip');
const mongoose = require('mongoose');
const Student = require('./models/Student');

const ROOT = process.env.GOOGLE_DRIVE_FOLDER_ID || '0ACktHqI8zSSCUk9PVA';
const APPLY = process.argv.includes('--apply');

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

const MONTHS = { january:'01', february:'02', march:'03', april:'04', may:'05', june:'06', july:'07', august:'08', september:'09', october:'10', november:'11', december:'12' };
function strictBirthday(str) {
    const m = String(str).match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
    if (!m) return null;
    const mo = MONTHS[m[1].toLowerCase()];
    if (!mo) return null;
    return `${m[3]}-${mo}-${String(m[2]).padStart(2, '0')}`;
}

async function extractDocxMeta(buf) {
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('word/document.xml').async('string');
    const runs = [];
    const re = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let m;
    while ((m = re.exec(xml)) !== null) runs.push(m[1]);
    return {
        birthday: strictBirthday((runs[12] || '').replace('Birthday:', '').trim()),
        lrn: (runs[29] || '').trim(),
        lastName: (runs[0] || '').trim().toUpperCase(),
        firstName: (runs[18] || '').trim().toUpperCase(),
        middleName: (runs[19] || '').trim().toUpperCase(),
    };
}

function normName(s) { return String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim().toUpperCase(); }

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    const drive = await initDrive();

    const recovered = await Student.find({ photoSource: 'recovered' },
        { lrn: 1, lastName: 1, firstName: 1, middleName: 1, section: 1, birthday: 1 }).lean();
    console.log(`Recovered records: ${recovered.length}`);

    // List section folders
    const folders = [];
    let pageToken;
    do {
        const res = await drive.files.list({
            q: `mimeType='application/vnd.google-apps.folder' and trashed=false and name contains '11 '`,
            fields: 'nextPageToken, files(id,name)',
            pageSize: 200,
            pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
        });
        folders.push(...res.data.files);
        pageToken = res.data.nextPageToken;
    } while (pageToken);
    console.log(`Section folders: ${folders.map(f => f.name).join(', ')}`);

    // Build set of names we actually need
    const needNames = new Set(recovered.map(s => `${normName(s.lastName)}_${normName(s.firstName)}`));

    // Build DOCX index: "LAST|FIRST" -> { birthday, lrn, section, fileId }
    const docxIndex = new Map();
    let totalDocx = 0, downloaded = 0;
    for (const folder of folders) {
        const files = await drive.files.list({
            q: `'${folder.id}' in parents and trashed=false`,
            fields: 'files(id,name,mimeType)',
            pageSize: 500,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
        });
        const docx = files.data.files.filter(f => f.name.endsWith('_ID.docx'));
        totalDocx += docx.length;
        const relevant = docx.filter(d => needNames.has(normName(d.name.replace('_ID.docx', ''))));
        for (const d of relevant) {
            try {
                const res = await drive.files.get({ fileId: d.id, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
                const meta = await extractDocxMeta(Buffer.from(res.data));
                downloaded++;
                const key = `${meta.lastName}|${meta.firstName}`;
                const entry = { ...meta, section: folder.name, fileId: d.id, fileName: d.name };
                if (!docxIndex.has(key)) docxIndex.set(key, []);
                docxIndex.get(key).push(entry);
            } catch (e) {
                console.log(`  [ERR] ${folder.name}/${d.name}: ${e.message}`);
            }
        }
        console.log(`  ${folder.name}: ${docx.length} DOCX total, ${relevant.length} relevant (${downloaded} downloaded so far)`);
    }
    console.log(`DOCX total on Drive: ${totalDocx}; downloaded for matching: ${downloaded} (unique name keys: ${docxIndex.size})`);

    // Match recovered records
    let verified = 0, fixed = 0, noDocx = 0, ambiguous = 0, noShift = 0, unparseable = 0, lrnMismatch = 0;
    const problems = [];
    for (const s of recovered) {
        const key = `${normName(s.lastName)}|${normName(s.firstName)}`;
        const candidates = docxIndex.get(key) || [];
        if (!candidates.length) { noDocx++; problems.push(`NO-DOCX ${s.lrn} [${s.section}] ${s.lastName}, ${s.firstName} db=${s.birthday}`); continue; }

        // Prefer LRN match, then section match, else single candidate
        let pick = candidates.find(c => c.lrn === s.lrn)
            || candidates.find(c => normName(c.section) === normName(s.section))
            || (candidates.length === 1 ? candidates[0] : null);
        if (!pick) { ambiguous++; problems.push(`AMBIGUOUS ${s.lrn} [${s.section}] ${s.lastName}, ${s.firstName} (${candidates.length} candidates)`); continue; }
        if (pick.lrn && pick.lrn !== s.lrn) {
            lrnMismatch++;
            problems.push(`LRN-DIFF ${s.lrn} db vs ${pick.lrn} docx [${s.section}] ${s.lastName}, ${s.firstName}`);
        }
        if (!pick.birthday) { unparseable++; problems.push(`UNPARSEABLE docx ${pick.fileName} (${s.lastName})`); continue; }

        if (s.birthday === pick.birthday) { noShift++; continue; }

        // Expect -1 day
        const d1 = new Date(pick.birthday + 'T00:00:00Z');
        d1.setUTCDate(d1.getUTCDate() - 1);
        const prev = d1.toISOString().slice(0, 10);
        if (s.birthday !== prev) {
            problems.push(`UNEXPECTED ${s.lrn} [${s.section}] ${s.lastName}: db=${s.birthday} docx=${pick.birthday}`);
            continue;
        }
        verified++;
        if (APPLY) {
            await Student.updateOne({ _id: s._id }, { $set: { birthday: pick.birthday } });
            fixed++;
        }
    }

    console.log(`\n=== DRY-RUN / APPLY: ${APPLY ? 'APPLY MODE' : 'DRY RUN'} ===`);
    console.log(`Verified -1-day shift (would fix / fixed): ${verified}${APPLY ? ` / ${fixed}` : ''}`);
    console.log(`Already correct (no shift): ${noShift}`);
    console.log(`No DOCX found: ${noDocx}`);
    console.log(`Ambiguous: ${ambiguous}`);
    console.log(`Unparseable: ${unparseable}`);
    console.log(`LRN mismatch (needs review): ${lrnMismatch}`);
    if (problems.length) {
        console.log(`\nProblems (${problems.length}):`);
        problems.forEach(p => console.log(`  ${p}`));
    }
    await mongoose.disconnect();
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
