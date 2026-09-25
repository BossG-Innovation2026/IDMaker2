require('dotenv').config();
const mongoose = require('mongoose');
const Student = require('./models/Student');

async function main() {
    await mongoose.connect(process.env.MONGO_URI);

    const total = await Student.countDocuments();
    console.log('Total:', total);

    const bySource = await Student.aggregate([
        { $group: { _id: { $ifNull: ['$photoSource', 'none'] }, count: { $sum: 1 } } }
    ]);
    console.log('By photoSource:', bySource);

    const byMethod = await Student.aggregate([
        { $group: { _id: '$entryMethod', count: { $sum: 1 } } }
    ]);
    console.log('By entryMethod:', byMethod);

    // Duplicate LRNs?
    const dups = await Student.aggregate([
        { $group: { _id: '$lrn', count: { $sum: 1 }, ids: { $push: '$_id' } } },
        { $match: { count: { $gt: 1 } } }
    ]);
    console.log('Duplicate LRNs:', dups.length);
    dups.slice(0, 10).forEach(d => console.log(`  LRN ${d._id} x${d.count}`));

    // createdAt distribution (day)
    const byDay = await Student.aggregate([
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
    ]);
    console.log('By createdAt day:', byDay);

    // form/override-entered records (not recovered, not 9999)
    const formRecords = await Student.find({
        photoSource: { $nin: ['recovered', 'placeholder'] },
        lrn: { $not: /^9999/ }
    }, { lastName: 1, firstName: 1, birthday: 1, section: 1, createdAt: 1 }).limit(15).lean();
    console.log(`\nNon-recovered non-test records (up to 15):`);
    formRecords.forEach(s => console.log(`  [${s.section}] ${s.lastName}, ${s.firstName}: ${s.birthday} (created ${new Date(s.createdAt).toISOString().slice(0,10)})`));

    await mongoose.disconnect();
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
