require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const Student = require('./models/Student');
const store = require('./store');
const docxQueue = require('./docxQueue');
const uploadQueue = require('./uploadQueue');

const SECTIONS = [
  '11 COMMERCE', '11 MECHELIN', '11 ARISTOTLE', '11 ENTERPRENEURS', '11 ALCARAZ',
  '11 ADLER', '11 CHATTERTON', '11 PATRIOTS', '11 DILIGENT', '11 DRIVEN',
  '11 SAPIENTA', '11 CROISSANT', '11 BLOOM', '11 ANALYTICAL', '11 BERNOULLI',
  '11 ERUDITE', '11 CANNOLI', '11 H. DIAZ', '11 ALS', '11 SNED'
];

const PLACEHOLDER = path.join(__dirname, 'public', 'placeholders', 'photo-placeholder.jpg');
const UPLOADS = path.join(__dirname, 'uploads');

function dummyFor(section, i) {
  const slug = section.replace(/^11\s+/, '').replace(/[^A-Z0-9]/gi, '');
  return {
    firstName: 'Sample',
    middleName: 'X',
    lastName: `Student${slug}`,
    sex: i % 2 === 0 ? 'Male' : 'Female',
    birthday: '2009-06-15',
    lrn: `9999${String(i + 1).padStart(2, '0')}11000${String(i + 1).padStart(3, '0')}`,
    section,
    address: `Purok ${i + 1}, Sample Street, Cabiao, Nueva Ecija 3107`,
    parentName: `Guardian ${slug} Parent`,
    contactNumber: `0917${String(1000000 + i * 111111).slice(0, 7)}`,
    entryMethod: 'Individual'
  };
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected.');

  if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });
  const photoBuf = fs.readFileSync(PLACEHOLDER);

  let created = 0;
  for (let i = 0; i < SECTIONS.length; i++) {
    const section = SECTIONS[i];
    const d = dummyFor(section, i);

    const dup = await Student.findOne({ lrn: d.lrn });
    if (dup) {
      console.log(`[SKIP] ${section}: LRN ${d.lrn} already exists`);
      continue;
    }

    const photoName = `${uuidv4()}.jpg`;
    fs.writeFileSync(path.join(UPLOADS, photoName), photoBuf);

    const student = {
      ...d,
      photoPath: photoName,
      photoMime: 'image/jpeg',
      photoSource: 'placeholder',
      uploadStatus: 'pending',
      uploadError: null,
      driveUploaded: false,
      driveLink: null,
      idCardDocxPath: null
    };

    const saved = await store.add(student);
    const studentId = String(saved._id);

    const { promise } = docxQueue.enqueueDOCX({ ...student, id: studentId }, photoBuf);
    promise.then(async result => {
      const docxRelPath = result && result.docxPath ? `uploads/${path.basename(result.docxPath)}` : null;
      if (docxRelPath) await store.update(studentId, { idCardDocxPath: docxRelPath });
      uploadQueue.enqueue(studentId, { photo: photoBuf, photoExt: '.jpg', idCardDocxPath: docxRelPath });
    }).catch(err => {
      console.error(`[DOCX FAIL] ${section}: ${err.message}`);
      store.update(studentId, { uploadStatus: 'failed', uploadError: err.message });
    });

    created++;
    console.log(`[CREATE] ${section}: ${d.lastName}, ${d.firstName} (LRN ${d.lrn})`);
  }

  console.log(`\nCreated ${created} samples. Waiting for DOCX + Drive uploads...`);

  // Wait for queues to drain (DOCX then upload)
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const docxStats = docxQueue.getQueueStats();
    const upStats = uploadQueue.stats();
    const pending = await Student.countDocuments({ uploadStatus: { $in: ['pending', 'uploading'] } });
    console.log(`  DOCX active=${docxStats.active} queued=${docxStats.queued} | Upload active=${upStats.active} queued=${upStats.queued} | DB pending=${pending}`);
    if (docxStats.active === 0 && docxStats.queued === 0 && upStats.active === 0 && upStats.queued === 0 && pending === 0) break;
    await new Promise(r => setTimeout(r, 10000));
  }

  const total = await Student.countDocuments();
  const bySection = await Student.aggregate([
    { $group: { _id: '$section', count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);
  console.log(`\n=== FINAL === Total: ${total}`);
  bySection.forEach(s => console.log(`  ${s._id}: ${s.count}`));

  console.log('Waiting 30s for idle Excel regeneration...');
  await new Promise(r => setTimeout(r, 30000));

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
