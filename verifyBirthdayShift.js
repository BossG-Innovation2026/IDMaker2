require('dotenv').config();
const mongoose = require('mongoose');
const Student = require('./models/Student');

async function main() {
    await mongoose.connect(process.env.MONGO_URI);

    // Known from DOCX samples: MANALAD ANNA MIKAELA = March 5, 2009
    // FERNANDEZ STEPHANIE = March 4, 2010
    // PEÑAREDONDO KING MANUEL = February 20, 2010
    const names = ['MANALAD', 'FERNANDEZ', 'PEÑAREDONDO'];
    for (const n of names) {
        const s = await Student.findOne({ lastName: n });
        if (s) console.log(`${s.lastName}, ${s.firstName}: DB=${s.birthday} photoSource=${s.photoSource || 'form/original'}`);
    }

    // Count recovered records (photoSource=recovered) and form records
    const recoveredCount = await Student.countDocuments({ photoSource: 'recovered' });
    const totalCount = await Student.countDocuments();
    console.log(`\nRecovered (photoSource=recovered): ${recoveredCount}`);
    console.log(`Total: ${totalCount}`);

    await mongoose.disconnect();
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
