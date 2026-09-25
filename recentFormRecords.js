require('dotenv').config();
const mongoose = require('mongoose');
const Student = require('./models/Student');

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    const recent = await Student.find(
        { photoSource: { $nin: ['recovered', 'placeholder'] } },
        { lrn: 1, lastName: 1, firstName: 1, section: 1, birthday: 1, createdAt: 1, driveFiles: 1 }
    ).sort({ createdAt: -1 }).limit(10).lean();
    recent.forEach(r => {
        const df = r.driveFiles || {};
        console.log(`${r.createdAt.toISOString().slice(0,10)} [${r.section}] ${r.lastName}, ${r.firstName}: ${r.birthday} LRN=${r.lrn} idDocx=${df.idDocx ? 'yes' : 'no'}`);
    });
    await mongoose.disconnect();
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
