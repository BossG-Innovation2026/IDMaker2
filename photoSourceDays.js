require('dotenv').config();
const mongoose = require('mongoose');
const Student = require('./models/Student');

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    const agg = await Student.aggregate([
        { $group: { _id: { ps: { $ifNull: ['$photoSource', ''] }, day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } } }, n: { $sum: 1 } } },
        { $sort: { '_id.day': 1 } }
    ]);
    agg.forEach(a => console.log(`${a._id.day} photoSource="${a._id.ps}": ${a.n}`));

    // Recovered records birthday sanity: how many differ when +1 day is applied?
    const recovered = await Student.find({ photoSource: 'recovered' }, { birthday: 1, lrn: 1 }).lean();
    let shifted = 0, empty = 0;
    for (const r of recovered) {
        if (!r.birthday) { empty++; continue; }
        shifted++;
    }
    console.log(`\nRecovered with birthday: ${shifted}, empty: ${empty}`);
    await mongoose.disconnect();
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
