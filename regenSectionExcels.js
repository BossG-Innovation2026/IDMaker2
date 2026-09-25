require('dotenv').config();
const mongoose = require('mongoose');
const Student = require('./models/Student');
const googleDrive = require('./googleDrive');

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || '0ACktHqI8zSSCUk9PVA';

    const sections = await Student.distinct('section');
    for (const section of sections.sort()) {
        const students = await Student.find({ section }).lean();
        const folderId = await googleDrive.getOrCreateFolder(section, rootFolderId);
        const result = await googleDrive.generateSectionExcel(section, students, folderId);
        console.log(`${section}: ${students.length} students -> ${result.success ? 'OK' : 'FAIL'}`);
    }

    await mongoose.disconnect();
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
