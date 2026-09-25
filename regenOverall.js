require('dotenv').config();
const mongoose = require('mongoose');
const Student = require('./models/Student');
const googleDrive = require('./googleDrive');

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected. Regenerating overall logs...');
    const count = await Student.countDocuments();
    console.log(`Students: ${count}`);
    const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || '0ACktHqI8zSSCUk9PVA';
    const result = await googleDrive.generateOverallLogsExcel(rootFolderId);
    console.log('Result:', result);
    await mongoose.disconnect();
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
