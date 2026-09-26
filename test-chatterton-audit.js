// READ-ONLY audit — list all CHATTERTON students (no changes)
require('dotenv').config();
const mongoose = require('mongoose');
const Student = require('./models/Student');
const fs = require('fs');
const path = require('path');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const list = await Student.find({ section: '11 CHATTERTON' }).lean();
  console.log(`CHATTERTON records: ${list.length}`);

  let withLocal = 0, withDocxLocal = 0, driveFiles = 0, statuses = {};
  for (const s of list) {
    statuses[s.uploadStatus] = (statuses[s.uploadStatus] || 0) + 1;
    if (s.photoPath && fs.existsSync(path.join(__dirname, 'uploads', s.photoPath))) withLocal++;
    if (s.idCardDocxPath && fs.existsSync(path.join(__dirname, 'uploads', path.basename(s.idCardDocxPath)))) withDocxLocal++;
    if (s.driveFiles && Object.values(s.driveFiles).some(v => v && v.fileId)) driveFiles++;
  }
  console.log('uploadStatus:', JSON.stringify(statuses));
  console.log(`with local photo file on THIS machine: ${withLocal}`);
  console.log(`with local DOCX on THIS machine: ${withDocxLocal}`);
  console.log(`with Drive fileIds recorded: ${driveFiles}`);
  console.log('\nLRNs:');
  list.forEach(s => console.log(`  ${s.lrn}  ${s.lastName}, ${s.firstName}  status=${s.uploadStatus}  photo=${s.driveFiles?.photo?.fileId ? 'Y' : 'n'} full=${s.driveFiles?.photoFull?.fileId ? 'Y' : 'n'} docx=${s.driveFiles?.idCardDocx?.fileId ? 'Y' : 'n'}`));
  await mongoose.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });

