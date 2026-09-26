// Isolated test for uploadQueue.buildFiles — cropped PIC + full-size PIC_FULL
const fs = require('fs');
const path = require('path');
const { buildFiles } = require('./uploadQueue');

const uploads = path.join(__dirname, 'uploads');
const cropped = 'test_cropped.jpg';
const orig = 'test_original.png';
const docx = 'test_doc.docx';

fs.writeFileSync(path.join(uploads, cropped), Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]));
fs.writeFileSync(path.join(uploads, orig), Buffer.from([0x89, 0x50, 0x4E, 0x47]));
fs.writeFileSync(path.join(uploads, docx), Buffer.from([0x50, 0x4B]));

let failed = 0;
function check(label, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label);
  if (!cond) failed++;
}

try {
  const studentWithOriginal = {
    lastName: 'DELA CRUZ', firstName: 'JUAN',
    photoPath: cropped, photoMime: 'image/jpeg',
    photoOriginalPath: orig, photoOriginalMime: 'image/png',
    idCardDocxPath: null
  };

  // Case 1: student with original, no DOCX on disk yet
  let files = buildFiles(studentWithOriginal, undefined);
  check('2 files (photo + photoFull) when no DOCX', files.length === 2);
  check('photo name', files[0].name === 'DELA CRUZ_JUAN_PIC.jpg');
  check('photo key/mime', files[0].key === 'photo' && files[0].mimeType === 'image/jpeg');
  check('photoFull name', files[1].name === 'DELA CRUZ_JUAN_PIC_FULL.png');
  check('photoFull key/mime', files[1].key === 'photoFull' && files[1].mimeType === 'image/png');
  check('photoFull is full original bytes', files[1].buffer.equals(Buffer.from([0x89, 0x50, 0x4E, 0x47])));

  // Case 2: with DOCX present → 3 files, order photo, photoFull, docx
  files = buildFiles({ ...studentWithOriginal, idCardDocxPath: `uploads/${docx}` }, undefined);
  check('3 files with DOCX', files.length === 3);
  check('order photo, photoFull, idCardDocx', files.map(f => f.key).join(',') === 'photo,photoFull,idCardDocx');
  check('docx name', files[2].name === 'DELA CRUZ_JUAN_ID.docx');

  // Case 3: legacy student without original → only cropped photo
  files = buildFiles({ lastName: 'REYES', firstName: 'ANA', photoPath: cropped, photoMime: 'image/jpeg', photoOriginalPath: '', photoOriginalMime: '', idCardDocxPath: null }, undefined);
  check('legacy student → 1 file only', files.length === 1);
  check('legacy photo name', files[0].name === 'REYES_ANA_PIC.jpg');

  // Case 4: prebuilt buffers (normal submit flow)
  files = buildFiles(
    { lastName: 'SANTOS', firstName: 'LEA', photoPath: cropped, photoMime: 'image/jpeg', photoOriginalPath: orig, photoOriginalMime: 'image/png', idCardDocxPath: null },
    { photo: Buffer.from([1]), photoExt: '.jpg', photoFull: Buffer.from([2]), photoFullExt: '.png', photoFullMime: 'image/png', idCardDocxPath: null }
  );
  check('prebuilt → 2 files', files.length === 2);
  check('prebuilt photoFull name', files[1].name === 'SANTOS_LEA_PIC_FULL.png');
  check('prebuilt photoFull buffer', files[1].buffer.equals(Buffer.from([2])));

  // Case 5: prebuilt cropped only (fallback: original read from disk)
  files = buildFiles(
    { lastName: 'SANTOS', firstName: 'LEA', photoPath: cropped, photoMime: 'image/jpeg', photoOriginalPath: orig, photoOriginalMime: 'image/png', idCardDocxPath: null },
    { photo: Buffer.from([1]), photoExt: '.jpg', idCardDocxPath: null }
  );
  check('prebuilt without photoFull → still reads original from disk', files.length === 2 && files[1].key === 'photoFull');
} finally {
  for (const f of [cropped, orig, docx]) {
    try { fs.unlinkSync(path.join(uploads, f)); } catch (e) {}
  }
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
