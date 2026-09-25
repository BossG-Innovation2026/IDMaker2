require('dotenv').config();
const mongoose = require('mongoose');
const Student = require('./models/Student');

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    const count = await Student.countDocuments();
    const sections = await Student.aggregate([
        { $group: { _id: '$section', count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
    ]);
    console.log('Total:', count);
    sections.forEach(s => console.log('  ' + s._id + ': ' + s.count));
    await mongoose.disconnect();
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
