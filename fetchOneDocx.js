require('dotenv').config();
const fs = require('fs');
const { google } = require('googleapis');
const mongoose = require('mongoose');
const Student = require('./models/Student');

async function getClient() {
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
    await mongoose.connect(process.env.MONGO_URI);
    const s = await Student.findOne({ lrn: process.argv[2] }).lean();
    if (!s) { console.log('not found'); process.exit(1); }

    console.log(`DB birthday: ${s.birthday}`);
    const fileId = s.driveFiles?.idCardDocx?.fileId;
    if (!fileId) { console.log('no docx'); process.exit(1); }

    const drive = await getClient();
    const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
    const out = `${process.argv[2]}_id.docx`;
    fs.writeFileSync(out, Buffer.from(res.data));
    console.log(`Downloaded ${out}`);
    await mongoose.disconnect();
    process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
