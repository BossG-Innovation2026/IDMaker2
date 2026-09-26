// CHATTERTON — DB-only deletion with backup + verification (Drive untouched)
require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Student = require('./models/Student');

const SECTION = '11 CHATTERTON';
const EXPECTED = 31;
const BACKUP = path.join(__dirname, 'data', 'chatterton-backup-2026-09-26.json');

function fail(msg) { console.error('ABORT: ' + msg); process.exit(1); }

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  // Step 1 — backup
  const before = await Student.find({ section: SECTION }).lean();
  console.log(`DB records found: ${before.length}`);
  if (before.length !== EXPECTED) fail(`expected ${EXPECTED} records, found ${before.length} — no changes made`);

  const totalBefore = await Student.countDocuments();
  const sectionsBefore = {};
  const others = await Student.aggregate([{ $group: { _id: '$section', n: { $sum: 1 } } }]);
  others.forEach(r => { sectionsBefore[r._id] = r.n; });

  fs.mkdirSync(path.dirname(BACKUP), { recursive: true });
  fs.writeFileSync(BACKUP, JSON.stringify({ exportedAt: new Date().toISOString(), section: SECTION, count: before.length, records: before }, null, 2));

  const roundtrip = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
  if (roundtrip.records.length !== EXPECTED) fail(`backup read-back count mismatch (${roundtrip.records.length}) — no changes made`);
  console.log(`Backup written & verified: ${BACKUP} (${roundtrip.records.length} records)`);

  // Step 2 — delete
  const res = await Student.deleteMany({ section: SECTION });
  console.log(`deleteMany → deletedCount=${res.deletedCount}`);
  if (res.deletedCount !== EXPECTED) fail(`deletedCount ${res.deletedCount} !== ${EXPECTED} — CHECK NEEDED`);

  // Step 3 — verify
  const chattertonAfter = await Student.countDocuments({ section: SECTION });
  const totalAfter = await Student.countDocuments();
  console.log(`\nCHATTERTON after: ${chattertonAfter} (expect 0)`);
  console.log(`Total before: ${totalBefore} | after: ${totalAfter} | diff: ${totalBefore - totalAfter} (expect ${EXPECTED})`);

  const othersAfter = await Student.aggregate([{ $group: { _id: '$section', n: { $sum: 1 } } }]);
  let othersOk = true;
  for (const r of othersAfter) {
    if (sectionsBefore[r._id] !== r.n) { othersOk = false; console.log(`  MISMATCH ${r._id}: before=${sectionsBefore[r._id]} after=${r.n}`); }
  }
  const afterKeys = new Set(othersAfter.map(r => r._id));
  if (afterKeys.has(SECTION)) { othersOk = false; console.log('  MISMATCH: CHATTERTON still present'); }

  const pass = chattertonAfter === 0 && (totalBefore - totalAfter) === EXPECTED && othersOk;
  console.log(`\n${pass ? 'ALL CHECKS PASS' : 'VERIFICATION FAILED'}`);
  await mongoose.disconnect();
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('ERROR: ' + e.message); process.exit(1); });
