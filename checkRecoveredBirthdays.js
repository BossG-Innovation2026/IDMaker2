require('dotenv').config();
const mongoose = require('mongoose');
const Student = require('./models/Student');

async function main() {
    await mongoose.connect(process.env.MONGO_URI);

    // Recovered records: CHATTERTON/ALS/ARISTOTLE/SNED from Excel recovery
    const recovered = await Student.find(
        { section: { $in: ['11 CHATTERTON', '11 ALS', '11 ARISTOTLE', '11 SNED'] } },
        { lrn: 1, birthday: 1, firstName: 1, lastName: 1, createdAt: 1, photoSource: 1 }
    ).lean();

    console.log(`Recovered-section records: ${recovered.length}`);
    recovered.slice(0, 8).forEach(s =>
        console.log(`  [${s.section}] ${s.lastName}, ${s.firstName}: birthday=${s.birthday} photoSource=${s.photoSource || '-'} created=${s.createdAt}`)
    );

    // Also check DOCX-recovered: photoSource=recoverED
    const fromDocx = await Student.find({ photoSource: 'recovered' },
        { lrn: 1, birthday: 1, firstName: 1, lastName: 1, section: 1 }).lean();
    console.log(`\nDOCX-recovered records: ${fromDocx.length}`);
    fromDocx.slice(0, 8).forEach(s =>
        console.log(`  [${s.section}] ${s.lastName}, ${s.firstName}: birthday=${s.birthday}`)
    );

    await mongoose.disconnect();
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
