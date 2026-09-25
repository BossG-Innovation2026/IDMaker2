require('dotenv').config();
const { google } = require('googleapis');
const JSZip = require('jszip');
const mongoose = require('mongoose');
const Student = require('./models/Student');

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

// TZ-independent: parse "May 29, 2010" strictly
function strictBirthday(str) {
    const m = String(str).match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
    if (!m) return null;
    const mo = MONTHS[m[1].toLowerCase()];
    if (!mo) return null;
    return `${m[3]}-${mo}-${String(m[2]).padStart(2, '0')}`;
}

async function extractBirthday(buf) {
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('word/document.xml').async('string');
    const runs = [];
    const re = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let m;
    while ((m = re.exec(xml)) !== null) runs.push(m[1]);
    const raw = (runs[12] || '').replace('Birthday:', '').trim();
    return { raw, strict: strictBirthday(raw), lrn: (runs[29] || '').trim() };
}

async function main() {
    const fileIds = process.argv.slice(2);
    if (!fileIds.length) { console.log('Usage: node verifyDocxBirthdays.js <fileId>...'); process.exit(1); }

    await mongoose.connect(process.env.MONGO_URI);
    const drive = await initDrive();

    let shiftMinus1 = 0, match = 0, other = 0;
    for (const fid of fileIds) {
        const res = await drive.files.get({ fileId: fid, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
        const info = await extractBirthday(Buffer.from(res.data));
        const s = await Student.findOne({ lrn: info.lrn }, { lrn: 1, lastName: 1, firstName: 1, birthday: 1 }).lean();
        if (!s) { console.log(`${fid}: LRN ${info.lrn} NOT IN DB (docx=${info.raw})`); continue; }
        const docx = info.strict;
        let verdict;
        if (!docx) verdict = `UNPARSEABLE docx="${info.raw}"`;
        else if (s.birthday === docx) { verdict = 'MATCH'; match++; }
        else {
            // check exactly -1 day
            const d1 = new Date(docx + 'T00:00:00Z');
            d1.setUTCDate(d1.getUTCDate() - 1);
            const prev = d1.toISOString().slice(0, 10);
            if (s.birthday === prev) { verdict = `DB IS -1 DAY (docx=${docx})`; shiftMinus1++; }
            else { verdict = `OTHER (docx=${docx}, db=${s.birthday})`; other++; }
        }
        console.log(`${s.lastName}, ${s.firstName}: DB=${s.birthday} | ${verdict}`);
    }
    console.log(`\nSummary: -1day=${shiftMinus1} match=${match} other=${other}`);
    await mongoose.disconnect();
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
