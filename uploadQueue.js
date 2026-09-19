const fs = require('fs');
const path = require('path');
const store = require('./store');
const googleDrive = require('./googleDrive');

const CONCURRENCY = 1;
const MAX_ATTEMPTS = 3;
const MAX_QUEUE_SIZE = 50;
const RETRY_DELAYS = [5000, 15000, 45000];
const IDLE_DELAY_MS = 5000;

const queue = [];
const queuedIds = new Set();
let active = 0;
let idleTimer = null;

// ── Persisted queue helpers ──────────────────────────────────────────
const QUEUE_FILE = path.join(__dirname, 'data', 'upload-queue.json');

function persistQueue() {
  try {
    const dir = path.dirname(QUEUE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Only persist IDs — never serialize large file buffers to disk
    const ids = queue.map(j => (typeof j === 'string' ? j : j.id));
    const data = { queue: ids, queuedIds: [...queuedIds] };
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(data), 'utf8');
  } catch (e) {
    console.error('[QUEUE] Failed to persist queue:', e.message);
  }
}

function loadQueue() {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      const data = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
      if (Array.isArray(data.queue)) {
        for (const id of data.queue) {
          if (!queuedIds.has(id)) {
            queue.push(id);
            queuedIds.add(id);
          }
        }
        console.log(`[QUEUE] Restored ${queue.length} pending jobs from disk`);
      }
    }
  } catch (e) {
    console.error('[QUEUE] Failed to load persisted queue:', e.message);
  }
}

function clearPersisted() {
  try { fs.unlinkSync(QUEUE_FILE); } catch (_) {}
}

// ── Public API ───────────────────────────────────────────────────────

function enqueue(studentId, prebuiltFiles) {
  if (queuedIds.has(studentId)) return;
  if (queue.length >= MAX_QUEUE_SIZE) {
    console.warn(`[QUEUE] Queue full (${MAX_QUEUE_SIZE}), rejecting ${studentId}`);
    return;
  }
  queuedIds.add(studentId);
  if (prebuiltFiles) {
    queue.push({ id: studentId, prebuiltFiles });
  } else {
    queue.push({ id: studentId });
  }
  persistQueue();
  pump();
}

function pump() {
  while (active < CONCURRENCY && queue.length > 0) {
    const job = queue.shift();
    queuedIds.delete(typeof job === 'string' ? job : job.id);
    active++;
    persistQueue();
    processJob(job)
      .catch(err => console.error('[QUEUE] Job crashed:', err.message))
      .finally(() => { active--; pump(); });
  }
  scheduleIdleExcel();
}

// ── Idle Excel batch (P2 #5) ────────────────────────────────────────

function scheduleIdleExcel() {
  if (idleTimer) clearTimeout(idleTimer);
  if (active > 0 || queue.length > 0) return;
  idleTimer = setTimeout(async () => {
    console.log('[QUEUE] Queue idle — generating Excel files...');
    try {
      const allStudents = await store.all();
      // Group by section, then separate by entry method
      const sectionGroups = {};
      for (const s of allStudents) {
        if (!s.section) continue;
        const key = s.section;
        if (!sectionGroups[key]) sectionGroups[key] = { individual: [], bulk: [] };
        const bucket = s.entryMethod === 'Bulk' ? sectionGroups[key].bulk : sectionGroups[key].individual;
        bucket.push(s);
      }
      const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || '0ACktHqI8zSSCUk9PVA';
      for (const [section, groups] of Object.entries(sectionGroups)) {
        // Regular section Excel
        const folderId = googleDrive.folderCache[`${rootFolderId}/${section}`];
        if (folderId) {
          await googleDrive.generateSectionExcel(section, groups.individual, folderId);
        }
        // Bulk section Excel (goes to _bulk folder)
        if (groups.bulk.length > 0) {
          const bulkFolderId = googleDrive.folderCache[`${rootFolderId}/${section}_bulk`];
          if (bulkFolderId) {
            await googleDrive.generateSectionExcel(section + '_bulk', groups.bulk, bulkFolderId);
          }
        }
      }
      await googleDrive.generateOverallLogsExcel(rootFolderId);
    } catch (err) {
      console.error('[QUEUE] Idle Excel generation failed:', err.message);
    }
  }, IDLE_DELAY_MS);
}

// ── File building (supports prebuilt buffers) ───────────────────────

function buildFiles(student, prebuilt) {
  const base = `${student.lastName}_${student.firstName}`;
  const files = [];

  if (prebuilt && prebuilt.photo) {
    files.push({
      key: 'photo',
      name: `${base}_PIC${prebuilt.photoExt || '.jpg'}`,
      mimeType: student.photoMime || 'image/jpeg',
      buffer: prebuilt.photo
    });
  } else {
    const photoPath = path.join(__dirname, 'uploads', student.photoPath);
    if (!fs.existsSync(photoPath)) {
      console.error(`Photo file not found: ${photoPath}`);
      return null;
    }
    const photoExt = path.extname(student.photoPath) || '.jpg';
    files.push({
      key: 'photo',
      name: `${base}_PIC${photoExt}`,
      mimeType: student.photoMime || 'image/jpeg',
      buffer: fs.readFileSync(photoPath)
    });
  }

  if (student.idCardDocxPath) {
    const docxPath = path.isAbsolute(student.idCardDocxPath)
      ? student.idCardDocxPath
      : path.join(__dirname, student.idCardDocxPath);
    if (fs.existsSync(docxPath)) {
      const buf = fs.readFileSync(docxPath);
      files.push({
        key: 'idCardDocx',
        name: `${base}_ID.docx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: buf
      });
    } else {
      console.error(`DOCX file not found: ${docxPath}`);
    }
  }

  console.log(`[QUEUE] ${files.length} file(s) ready for ${base}`);
  return files.length > 0 ? files : null;
}

// ── Job processing ──────────────────────────────────────────────────

async function processJob(job) {
  const id = typeof job === 'string' ? job : job.id;
  const student = await store.find(id);
  if (!student) return;
  if (student.uploadStatus === 'uploaded') return;

  console.log(`\n[QUEUE] Processing: ${student.lastName}_${student.firstName} (${student.section})`);
  await store.update(id, { uploadStatus: 'uploading', uploadError: null });

  const files = buildFiles(student, job.prebuiltFiles);
  // Release buffers from job immediately after building file list
  job.prebuiltFiles = null;
  if (!files) {
    await store.update(id, { uploadStatus: 'failed', uploadError: 'Files missing on disk' });
    return;
  }

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const results = {};
      let sectionFolderId = null;

      // Upload files sequentially to avoid folder creation race condition
      // Bulk entries get a _bulk suffix on the Drive folder
      const driveSection = student.entryMethod === 'Bulk' ? student.section + '_bulk' : student.section;
      for (const file of files) {
        console.log(`[QUEUE] Uploading ${file.name} (${(file.buffer.length / 1024).toFixed(1)}KB) → ${driveSection}/`);
        const result = await googleDrive.uploadStudentPhoto(
          file.buffer, file.name, file.mimeType, driveSection
        );
        if (!result.success) throw new Error(result.error || 'upload failed');
        if (result.folderId) sectionFolderId = result.folderId;
        results[file.key] = result;
        console.log(`[QUEUE] Uploaded ${file.name} → ${result.fileLink}`);
      }

      const fileLinks = {
        photo: results.photo?.fileLink || null,
        idCard: results.idCard?.fileLink || null,
        idCardDocx: results.idCardDocx?.fileLink || null
      };

      await store.update(id, {
        uploadStatus: 'uploaded',
        uploadError: null,
        driveUploaded: true,
        driveLink: fileLinks.photo,
        driveFiles: results
      });
      console.log(`[QUEUE] ✓ Upload complete: ${student.lastName}_${student.firstName}`);

      // Auto-cleanup local files (P3 #10)
      cleanupLocalFiles(student);
      // Release file buffers immediately
      for (const f of files) f.buffer = null;

      return;
    } catch (error) {
      lastError = error.message || String(error);
      console.error(`[QUEUE] Attempt ${attempt}/${MAX_ATTEMPTS} failed (${id}): ${lastError}`);
      // Release file buffers — they've been sent to the Drive API
      for (const f of files) f.buffer = null;
      if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAYS[attempt - 1]);
    }
  }

  await store.update(id, { uploadStatus: 'failed', uploadError: lastError });
}

function cleanupLocalFiles(student) {
  try {
    const uploadsDir = path.join(__dirname, 'uploads');
    if (student.photoPath) {
      const p = path.join(uploadsDir, student.photoPath);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    if (student.idCardDocxPath) {
      const p = path.join(uploadsDir, path.basename(student.idCardDocxPath));
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  } catch (e) {
    console.warn('[QUEUE] Cleanup error:', e.message);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function stats() {
  return { queued: queue.length, active, concurrency: CONCURRENCY };
}

module.exports = { enqueue, stats, loadQueue };
