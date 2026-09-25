require('dotenv').config();
const mongoose = require('mongoose');
const Student = require('./models/Student');

async function main() {
    await mongoose.connect(process.env.MONGO_URI);

    // Group A: photoSource = recovered
    const a = await Student.countDocuments({ photoSource: 'recovered' });
    console.log('A) photoSource=recovered:', a);

    // Group B candidates: photoPath empty (recovery always sets photoPath:'')
    const bAll = await Student.find({ photoPath: '' }, { lrn: 1, photoSource: 1, createdAt: 1, 'driveFiles.idCardDocx.fileName': 1, 'driveFiles.idCardDocx.fileId': 1, birthday: 1 }).lean();
    console.log('B) photoPath="":', bAll.length);
    const bySrc = {};
    const byDay = {};
    let withFileName = 0, withFileId = 0, noDocx = 0;
    for (const r of bAll) {
        const ps = r.photoSource || '(empty)';
        bySrc[ps] = (bySrc[ps] || 0) + 1;
        const day = r.createdAt ? r.createdAt.toISOString().slice(0, 10) : '?';
        byDay[day] = (byDay[day] || 0) + 1;
        const dc = r.driveFiles && r.driveFiles.idCardDocx;
        if (dc && dc.fileName) withFileName++;
        else if (dc && dc.fileId) withFileId++;
        else noDocx++;
    }
    console.log('  by photoSource:', JSON.stringify(bySrc));
    console.log('  by createdAt day:', JSON.stringify(byDay));
    console.log('  docx markers -> fileName:', withFileName, 'fileIdOnly:', withFileId, 'noDocx:', noDocx);

    // Sample of photoPath='' + photoSource='' records
    const sample = bAll.filter(r => !r.photoSource).slice(0, 5);
    console.log('\nSample photoPath="" & photoSource="":');
    sample.forEach(r => console.log(`  ${r.lrn} ${r.birthday} created=${r.createdAt ? r.createdAt.toISOString().slice(0,16) : '?'} docx=${JSON.stringify(r.driveFiles && r.driveFiles.idCardDocx)}`));

    await mongoose.disconnect();
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
