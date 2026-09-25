require('dotenv').config();
const mongoose = require('mongoose');
const Student = require('./models/Student');

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    const all = await Student.find({}, { lrn: 1, birthday: 1, firstName: 1, lastName: 1, createdAt: 1 }).lean();

    const formats = {};
    for (const s of all) {
        const b = String(s.birthday ?? '');
        let fmt = 'other';
        if (/^\d{4}-\d{2}-\d{2}$/.test(b)) fmt = 'YYYY-MM-DD';
        else if (b === '') fmt = 'empty';
        else if (/^\d{4}-\d{2}-\d{2}T/.test(b)) fmt = 'full ISO';
        else fmt = 'text: ' + b.slice(0, 30);
        formats[fmt] = (formats[fmt] || 0) + 1;
    }
    console.log('Birthday formats:', formats);

    // Recovered records (LRN not 9999*, createdAt recent, photoSource recovered)
    const recovered = all.filter(s => String(s.lrn).startsWith('9999') === false);
    console.log('\nSample birthdays (first 10 non-test):');
    recovered.slice(0, 10).forEach(s => console.log(`  ${s.lastName}, ${s.firstName}: ${s.birthday}`));

    // Test records
    const tests = all.filter(s => String(s.lrn).startsWith('9999'));
    console.log('\nSample test birthdays:');
    tests.slice(0, 5).forEach(s => console.log(`  ${s.lastName}: ${s.birthday}`));

    await mongoose.disconnect();
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
