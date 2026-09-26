process.env.TZ = 'Etc/GMT-8';

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { connectDB } = require('./db');
const googleDrive = require('./googleDrive');
const store = require('./store');
const uploadQueue = require('./uploadQueue');
const docxQueue = require('./docxQueue');

// Load env vars in development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const app = express();
const PORT = process.env.PORT || 3000;

// Simple in-memory rate limiter: 10 requests per minute per IP
const rateLimitMap = new Map();
function rateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowMs = 60000;
  const maxReq = 10;
  if (!rateLimitMap.has(ip)) rateLimitMap.set(ip, []);
  const timestamps = rateLimitMap.get(ip).filter(t => now - t < windowMs);
  if (timestamps.length >= maxReq) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }
  timestamps.push(now);
  rateLimitMap.set(ip, timestamps);
  next();
}
setInterval(() => { rateLimitMap.clear(); }, 120000); // cleanup every 2min

// Admin passcode middleware — protects destructive endpoints
function requireAdmin(req, res, next) {
  const passcode = process.env.ADMIN_PASSCODE;
  if (!passcode) {
    return res.status(500).json({ error: 'Admin passcode not configured on server' });
  }
  const provided = req.headers['x-admin-passcode'];
  if (!provided || provided !== passcode) {
    return res.status(401).json({ error: 'Unauthorized: invalid or missing admin passcode' });
  }
  next();
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// Multer config for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// Both endpoints accept the cropped photo plus the optional full-size original
const studentUpload = upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'photoOriginal', maxCount: 1 }
]);

function pickFiles(req) {
  const photo = (req.files && req.files.photo && req.files.photo[0]) || null;
  const original = (req.files && req.files.photoOriginal && req.files.photoOriginal[0]) || null;
  return { photo, original };
}

// Queue the Drive upload: cropped photo (as today) + optional full-size original
function enqueueDriveUpload(studentId, student, photoBuf, docxRelPath) {
  let photoFullBuf = null;
  if (student.photoOriginalPath) {
    const p = path.join(__dirname, 'uploads', student.photoOriginalPath);
    if (fs.existsSync(p)) {
      photoFullBuf = fs.readFileSync(p);
    } else {
      console.warn(`[UPLOAD] Full-size original missing on disk: ${p}`);
    }
  }
  uploadQueue.enqueue(studentId, {
    photo: photoBuf,
    photoExt: path.extname(student.photoPath) || '.jpg',
    photoFull: photoFullBuf,
    photoFullExt: photoFullBuf ? (path.extname(student.photoOriginalPath) || '.jpg') : null,
    photoFullMime: student.photoOriginalMime || 'image/jpeg',
    idCardDocxPath: docxRelPath
  });
}

// Predefined classes list
const classes = [
  '11 COMMERCE',
  '11 MECHELIN',
  '11 ARISTOTLE',
  '11 ENTERPRENEURS',
  '11 ALCARAZ',
  '11 ADLER',
  '11 CHATTERTON',
  '11 PATRIOTS',
  '11 DILIGENT',
  '11 DRIVEN',
  '11 SAPIENTA',
  '11 CROISSANT',
  '11 BLOOM',
  '11 ANALYTICAL',
  '11 BERNOULLI',
  '11 ERUDITE',
  '11 CANNOLI',
  '11 H. DIAZ',
  '11 ALS',
  '11 SNED'
];

// Routes

// Get list of classes
app.get('/api/classes', (req, res) => {
  res.json(classes);
});

// ── DOCX Queue endpoints ───────────────────────────────────────────

app.get('/api/queue-status/:queueId', (req, res) => {
  const status = docxQueue.getJobStatus(req.params.queueId);
  if (!status) return res.status(404).json({ error: 'Job not found' });
  res.json(status);
});

app.get('/api/queue-stats', (req, res) => {
  res.json(docxQueue.getQueueStats());
});

// ── Override endpoint ───────────────────────────────────────────────

function present(student) {
  return {
    ...student,
    id: student._id,
    photoUrl: `/uploads/${student.photoPath}`
  };
}

// Diagnostic endpoint — check Google Drive status
app.get('/api/drive-status', async (req, res) => {
  try {
    const googleDrive = require('./googleDrive');
    await googleDrive.initialize();
    res.json({
      initialized: googleDrive.initialized,
      authType: googleDrive.authType || 'unknown',
      canList: !!googleDrive.drive
    });
  } catch (error) {
    res.json({ initialized: false, error: error.message });
  }
});

// Check for duplicate student (LRN + surname + first name)
app.get('/api/students/check-duplicate', async (req, res) => {
  const { firstName, lastName, lrn } = req.query;
  if (!firstName && !lastName && !lrn) {
    return res.json({ isDuplicate: false });
  }

  const result = await store.checkDuplicate(firstName, lastName, lrn);
  res.json(result);
});

// Override endpoint — delete old + create new atomically
app.post('/api/students/override', rateLimiter, studentUpload, async (req, res) => {
  try {
    const {
      firstName, middleName, lastName, sex, birthday,
      lrn, section, address, parentName, contactNumber, existingId
    } = req.body;

    if (!firstName || !lastName || !sex || !birthday || !lrn || !section || !address || !parentName || !contactNumber) {
      return res.status(400).json({ error: 'All required fields must be filled' });
    }
    const parentWords = parentName.trim().split(/\s+/).filter(Boolean);
    if (parentWords.length < 2) {
      return res.status(400).json({ error: 'Parent/Guardian name must be at least 2 words' });
    }
    const { photo: photoFile, original: originalFile } = pickFiles(req);
    if (!photoFile) {
      return res.status(400).json({ error: 'Photo is required' });
    }

    // STEP 1: Locate existing record
    const existing = await store.find(existingId);
    if (!existing) {
      return res.status(404).json({ error: 'Existing student record not found' });
    }

    // STEP 2: Create NEW student record FIRST (before deleting old)
    const student = {
      firstName, middleName: middleName || '', lastName, sex, birthday,
      lrn, section, address, parentName, contactNumber,
      entryMethod: 'Individual',
      photoPath: photoFile.filename,
      photoMime: photoFile.mimetype,
      photoOriginalPath: originalFile ? originalFile.filename : '',
      photoOriginalMime: originalFile ? originalFile.mimetype : '',
      uploadStatus: 'pending',
      uploadError: null,
      driveUploaded: false,
      driveLink: null,
      idCardDocxPath: null
    };

    // Save new student to store
    const savedStudent = await store.add(student);
    const studentId = String(savedStudent._id);

    // Enqueue DOCX generation (max 3 concurrent, returns position)
    const photoBuf = fs.readFileSync(path.join(__dirname, 'uploads', student.photoPath));
    const { queueId, position, promise } = docxQueue.enqueueDOCX({ ...student, id: studentId }, photoBuf);

    // Background: wait for DOCX, then enqueue Drive upload
    promise.then(async result => {
      const docxRelPath = result && result.docxPath ? `uploads/${path.basename(result.docxPath)}` : null;
      if (docxRelPath) {
        await store.update(studentId, { idCardDocxPath: docxRelPath });
      }
      enqueueDriveUpload(studentId, student, photoBuf, docxRelPath);
    }).catch(err => {
      console.error('[OVERRIDE] DOCX generation failed:', err.message);
      store.update(studentId, { uploadStatus: 'failed', uploadError: err.message });
    });

    // STEP 3: Delete old files and record
    const uploadsDir = path.join(__dirname, 'uploads');
    const filesDeleted = [];

    function deleteFile(filePath, label) {
      try {
        const fullPath = path.join(uploadsDir, path.basename(filePath));
        console.log(`[OVERRIDE] Deleting ${label}: ${fullPath}`);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          filesDeleted.push(label);
          console.log(`[OVERRIDE] ${label} deleted successfully`);
        }
      } catch (e) {
        console.error(`[OVERRIDE] Warning: failed to delete ${label}:`, e.message);
      }
    }

    if (existing.photoPath) deleteFile(existing.photoPath, 'photo');
    if (existing.photoOriginalPath) deleteFile(existing.photoOriginalPath, 'photoOriginal');
    if (existing.idCardDocxPath) deleteFile(existing.idCardDocxPath, 'DOCX');

    // Log the old record as overridden BEFORE removing it
    await store.logOverride({ ...existing, _id: undefined, overriddenAt: new Date() });

    // Remove old record from store
    await store.remove(existing._id);
    console.log(`[OVERRIDE] Replaced ${existing._id} (${existing.firstName} ${existing.lastName}) → ${studentId} — files removed: ${filesDeleted.join(', ') || 'none'}`);

    // Delete old Google Drive files (non-blocking)
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || '0ACktHqI8zSSCUk9PVA';
    googleDrive.deleteStudentDriveFiles(existing, folderId).catch(e =>
      console.error('[OVERRIDE] Warning: Drive file deletion failed:', e.message)
    );

    res.status(202).json({
      success: true,
      message: 'Override complete. New student record created.',
      student: present({ ...savedStudent, _id: studentId }),
      queue: { queueId, position },
      override: {
        deletedId: existingId,
        deletedFiles: filesDeleted
      }
    });
  } catch (error) {
    console.error('Override error:', error);
    res.status(500).json({ error: 'Override failed: ' + error.message });
  }
});

// Submit student data with photo
app.post('/api/students', rateLimiter, studentUpload, async (req, res) => {
  try {
    const {
      firstName,
      middleName,
      lastName,
      sex,
      birthday,
      lrn,
      section,
      address,
      parentName,
      contactNumber
    } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !sex || !birthday || !lrn || !section || !address || !parentName || !contactNumber) {
      return res.status(400).json({ error: 'All required fields must be filled' });
    }

    // Validate parent/guardian name is at least 2 words
    const parentWords = parentName.trim().split(/\s+/).filter(Boolean);
    if (parentWords.length < 2) {
      return res.status(400).json({ error: 'Parent/Guardian name must be at least 2 words' });
    }

    // Backend duplicate check — authoritative
    const dupCheck = await store.checkDuplicate(firstName, lastName, lrn);
    if (dupCheck.isDuplicate) {
      return res.status(409).json({
        error: 'DUPLICATE',
        duplicate: true,
        matchedByName: dupCheck.matchedByName,
        matchedByLRN: dupCheck.matchedByLRN,
        existing: {
          id: dupCheck.matches[0].id,
          firstName: dupCheck.matches[0].firstName,
          lastName: dupCheck.matches[0].lastName,
          lrn: dupCheck.matches[0].lrn,
          section: dupCheck.matches[0].section,
          createdAt: dupCheck.matches[0].createdAt
        }
      });
    }

    const { photo: photoFile, original: originalFile } = pickFiles(req);
    if (!photoFile) {
      return res.status(400).json({ error: 'Photo is required' });
    }

    const student = {
      firstName,
      middleName: middleName || '',
      lastName,
      sex,
      birthday,
      lrn,
      section,
      address,
      parentName,
      contactNumber,
      entryMethod: 'Individual',
      photoPath: photoFile.filename,
      photoMime: photoFile.mimetype,
      photoOriginalPath: originalFile ? originalFile.filename : '',
      photoOriginalMime: originalFile ? originalFile.mimetype : '',
      uploadStatus: 'pending',
      uploadError: null,
      driveUploaded: false,
      driveLink: null,
      idCardDocxPath: null
    };

    const savedStudent = await store.add(student);
    const studentId = String(savedStudent._id);

    // Enqueue DOCX generation (max 3 concurrent, returns position)
    const photoBuf = fs.readFileSync(path.join(__dirname, 'uploads', student.photoPath));
    const { queueId, position, promise } = docxQueue.enqueueDOCX({ ...student, id: studentId }, photoBuf);

    // Background: wait for DOCX, then enqueue Drive upload
    promise.then(async result => {
      const docxRelPath = result && result.docxPath ? `uploads/${path.basename(result.docxPath)}` : null;
      if (docxRelPath) {
        await store.update(studentId, { idCardDocxPath: docxRelPath });
      }
      enqueueDriveUpload(studentId, student, photoBuf, docxRelPath);
    }).catch(err => {
      console.error('DOCX generation failed:', err.message);
      store.update(studentId, { uploadStatus: 'failed', uploadError: err.message });
    });

    // Respond immediately with queue position
    res.status(202).json({
      success: true,
      message: 'Student saved. ID card is being generated.',
      student: present({ ...savedStudent, _id: studentId }),
      queue: { queueId, position }
    });
  } catch (error) {
    console.error('Error saving student:', error);
    res.status(500).json({ error: 'Failed to save student data' });
  }
});

// ── Bulk Entry endpoint — accepts JSON student data with photo link ──
app.post('/api/bulk-students', rateLimiter, async (req, res) => {
  try {
    const {
      firstName, middleName, lastName, sex, birthday,
      lrn, section, address, parentName, contactNumber, photoLink
    } = req.body;

    if (!firstName || !lastName || !lrn || !section || !photoLink) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate parent/guardian name is at least 2 words (if provided)
    if (parentName && parentName.trim()) {
      const parentWords = parentName.trim().split(/\s+/).filter(Boolean);
      if (parentWords.length < 2) {
        return res.status(400).json({ error: 'Parent/Guardian name must be at least 2 words' });
      }
    }

    // Backend duplicate check
    const dupCheck = await store.checkDuplicate(firstName, lastName, lrn);
    if (dupCheck.isDuplicate) {
      return res.status(409).json({
        error: 'DUPLICATE',
        duplicate: true,
        matchedByName: dupCheck.matchedByName,
        matchedByLRN: dupCheck.matchedByLRN,
        existing: {
          id: dupCheck.matches[0].id,
          firstName: dupCheck.matches[0].firstName,
          lastName: dupCheck.matches[0].lastName,
          lrn: dupCheck.matches[0].lrn,
          section: dupCheck.matches[0].section
        }
      });
    }

    // Download photo from Google Drive link
    let rawPhotoBuffer;
    try {
      rawPhotoBuffer = await googleDrive.downloadPhotoFromLink(photoLink);
    } catch (dlErr) {
      console.error(`[BULK] Failed to download photo from ${photoLink}:`, dlErr.message);
      return res.status(400).json({ error: 'Failed to download photo: ' + dlErr.message });
    }

    // Process photo: white bg check → face detection → crop to square
    const { processBulkPhoto } = require('./photoProcessor');
    let processedPhoto;
    try {
      processedPhoto = await processBulkPhoto(rawPhotoBuffer);
    } catch (procErr) {
      console.error(`[BULK] Photo processing error for ${firstName} ${lastName}:`, procErr.message);
      return res.status(400).json({ error: 'Photo processing failed: ' + procErr.message });
    }

    if (!processedPhoto.success) {
      console.warn(`[BULK] Photo rejected for ${firstName} ${lastName}: ${processedPhoto.error}`);
      return res.status(400).json({ error: processedPhoto.error });
    }

    const photoBuffer = processedPhoto.processedBuffer;

    // Save processed photo to disk
    const { v4: uuidv4 } = require('uuid');
    const ext = '.jpg';
    const photoFilename = `${uuidv4()}${ext}`;
    const photoPath = path.join(__dirname, 'uploads', photoFilename);
    fs.writeFileSync(photoPath, photoBuffer);

    const student = {
      firstName,
      middleName: middleName || '',
      lastName,
      sex: sex || '',
      birthday: birthday || '',
      lrn,
      section,
      address: address || '',
      parentName: parentName || '',
      contactNumber: contactNumber || '',
      entryMethod: 'Bulk',
      photoPath: photoFilename,
      photoMime: 'image/jpeg',
      photoSource: 'bulk',
      uploadStatus: 'pending',
      uploadError: null,
      driveUploaded: false,
      driveLink: null,
      idCardDocxPath: null
    };

    const savedStudent = await store.add(student);
    const studentId = String(savedStudent._id);

    // Enqueue DOCX generation (processed buffer already cropped/square)
    const { queueId, position, promise } = docxQueue.enqueueDOCX({ ...student, id: studentId }, photoBuffer);

    // Background: wait for DOCX, then enqueue Drive upload
    promise.then(async result => {
      const docxRelPath = result && result.docxPath ? `uploads/${path.basename(result.docxPath)}` : null;
      if (docxRelPath) {
        await store.update(studentId, { idCardDocxPath: docxRelPath });
      }
      uploadQueue.enqueue(studentId, { photo: photoBuffer, photoExt: ext, idCardDocxPath: docxRelPath });
    }).catch(err => {
      console.error('[BULK] DOCX generation failed:', err.message);
      store.update(studentId, { uploadStatus: 'failed', uploadError: err.message });
    });

    res.status(202).json({
      success: true,
      student: present({ ...savedStudent, _id: studentId }),
      queue: { queueId, position }
    });
  } catch (error) {
    console.error('Bulk student error:', error);
    res.status(500).json({ error: 'Failed to process bulk student: ' + error.message });
  }
});

// Get all students
app.get('/api/students', async (req, res) => {
  const students = await store.all();
  res.json(students.map(present));
});

// Get one student's upload status
app.get('/api/students/:id/status', async (req, res) => {
  const student = await store.find(req.params.id);
  if (!student) {
    return res.status(404).json({ error: 'Student not found' });
  }
  res.json({
    id: student._id,
    uploadStatus: student.uploadStatus,
    uploadError: student.uploadError,
    driveUploaded: !!student.driveUploaded,
    driveLink: student.driveLink,
    driveFiles: student.driveFiles || null,
    hasDocx: !!student.idCardDocxPath
  });
});

// Delete a student (admin only)
app.delete('/api/students/:id', rateLimiter, requireAdmin, async (req, res) => {
  const student = await store.find(req.params.id);
  if (!student) {
    return res.status(404).json({ error: 'Student not found' });
  }
  
  const uploadsDir = path.join(__dirname, 'uploads');
  try {
    if (student.photoPath) {
      const p = path.join(uploadsDir, student.photoPath);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    if (student.photoOriginalPath) {
      const p = path.join(uploadsDir, student.photoOriginalPath);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    if (student.idCardDocxPath) {
      const p = path.join(uploadsDir, path.basename(student.idCardDocxPath));
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  } catch (e) {
    console.warn('Error cleaning up files:', e.message);
  }
  
  await store.remove(student._id);
  res.json({ success: true, message: 'Student deleted' });
});

// Re-queue a failed/pending upload
app.post('/api/students/:id/resync', rateLimiter, async (req, res) => {
  const student = await store.find(req.params.id);
  if (!student) {
    return res.status(404).json({ error: 'Student not found' });
  }
  await store.update(student._id, { uploadStatus: 'pending', uploadError: null });
  uploadQueue.enqueue(student._id);
  res.json({ success: true, message: 'Re-queued for upload', id: student._id });
});

// Queue stats
app.get('/api/queue', (req, res) => {
  res.json(uploadQueue.stats());
});

// Manual re-sync of a single student
app.post('/api/save-to-drive', rateLimiter, requireAdmin, async (req, res) => {
  const { studentId } = req.body;
  const student = await store.find(studentId);
  if (!student) {
    return res.status(404).json({ error: 'Student not found' });
  }
  await store.update(student._id, { uploadStatus: 'pending', uploadError: null });
  uploadQueue.enqueue(student._id);
  res.json({ success: true, message: 'Re-queued for upload', id: student._id });
});

// ── Reset endpoint — clears all local + Drive data ──────────────────
app.post('/api/reset', rateLimiter, requireAdmin, async (req, res) => {
  try {
    console.log('[RESET] Starting full data reset...');

    // 1. Clear local student store
    const students = await store.all();
    await store.reset();
    console.log(`[RESET] Cleared ${students.length} student records from store`);

    // 2. Clear overrides
    await store.resetOverrides();
    console.log('[RESET] Cleared overrides');

    // 3. Delete local files in uploads/
    const uploadsDir = path.join(__dirname, 'uploads');
    let localFilesDeleted = 0;
    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir);
      for (const file of files) {
        if (file === '.gitkeep') continue;
        try {
          fs.unlinkSync(path.join(uploadsDir, file));
          localFilesDeleted++;
        } catch (e) { /* skip */ }
      }
    }
    console.log(`[RESET] Deleted ${localFilesDeleted} local files`);

    // 4. Delete all Drive contents in root folder
    const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || '0ACktHqI8zSSCUk9PVA';
    const driveDeleted = await googleDrive.deleteFolderContents(rootFolderId);
    console.log(`[RESET] Deleted ${driveDeleted} Drive files/folders`);

    res.json({
      success: true,
      message: 'Full reset complete',
      details: {
        studentsCleared: students.length,
        localFilesDeleted,
        driveFilesDeleted: driveDeleted
      }
    });
  } catch (error) {
    console.error('[RESET] Error:', error.message);
    res.status(500).json({ error: 'Reset failed: ' + error.message });
  }
});

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Start server
async function start() {
  await connectDB();

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Classes available: ${classes.length} predefined`);
    console.log('Google Drive integration: Enabled');
    console.log('Database: MongoDB Atlas');
  });

  // Load persisted queue from disk
  uploadQueue.loadQueue();

  // Recover unfinished uploads (skip if photo missing on disk)
  try {
    const allStudents = await store.all();
    const pending = allStudents.filter(s => s.uploadStatus !== 'uploaded' && s.uploadStatus !== 'uploading');
    if (pending.length > 0) {
      const uploadsDir = path.join(__dirname, 'uploads');
      let requeued = 0;
      for (const s of pending) {
        const photoExists = s.photoPath && fs.existsSync(path.join(uploadsDir, s.photoPath));
        if (photoExists) {
          await store.update(s._id, { uploadStatus: 'pending' });
          uploadQueue.enqueue(String(s._id));
          requeued++;
        } else {
          console.log(`[STARTUP] Skipping ${s.firstName}_${s.lastName} — photo missing on disk`);
          await store.update(s._id, { uploadStatus: 'failed', uploadError: 'Photo lost — re-submit required' });
        }
      }
      console.log(`↻ Re-queuing ${requeued}/${pending.length} unfinished upload(s)`);
    }
  } catch (err) {
    console.error('[STARTUP] Re-queue recovery failed:', err.message);
  }
}

start();
