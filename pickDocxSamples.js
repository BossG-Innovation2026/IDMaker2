require('dotenv').config();
const mongoose = require('mongoose');
const Student = require('./models/Student');

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    const withDocx = await Student.find(
        { photoSource: 'recovered', 'driveFiles.idCardDocx.fileName': { $exists: true } },
        { lrn: 1, lastName: 1, firstName: 1, section: 1, birthday: 1, 'driveFiles.idCardDocx.fileLink': 1 }
    ).lean();
    console.log('Recovered with DOCX reference:', withDocx.length);
    withDocx.slice(0, 6).forEach(s => {
        const m = (s.driveFiles.idCardDocx.fileLink || '').match(/\/d\/([^/]+)\//);
        console.log(`  ${s.lrn} [${s.section}] ${s.lastName}, ${s.firstName}: DB=${s.birthday} fileId=${m ? m[1] : 'NONE'}`);
    });
    // also pick one from a different section beyond first 6
    const others = withDocx.filter(s => !['BERNOULLI', 'COMMERCE', 'ENTERPRENEURS'].includes(s.section)).slice(0, 3);
    others.forEach(s => {
        const m = (s.driveFiles.idCardDocx.fileLink || '').match(/\/d\/([^/]+)\//);
        console.log(`  ${s.lrn} [${s.section}] ${s.lastName}, ${s.firstName}: DB=${s.birthday} fileId=${m ? m[1] : 'NONE'}`);
    });
    await mongoose.disconnect();
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
