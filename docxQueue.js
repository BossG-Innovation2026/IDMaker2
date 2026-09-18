const { v4: uuidv4 } = require('uuid');

const MAX_DOCX_CONCURRENT = 3;

let activeCount = 0;
const queue = [];
const jobs = new Map();

/**
 * Enqueue a DOCX generation job.
 * Returns { queueId, position } immediately.
 * Calls worker(student, photoBuf) when it's this job's turn.
 * Returns worker's result via the promise.
 */
function enqueueDOCX(student, photoBuf) {
  const queueId = uuidv4();
  const job = {
    queueId,
    student,
    photoBuf,
    status: 'queued',
    position: 0,
    worker: null,
    resolve: null,
    reject: null
  };

  const promise = new Promise((resolve, reject) => {
    job.resolve = resolve;
    job.reject = reject;
  });

  jobs.set(queueId, job);
  queue.push(job);
  updatePositions();
  pump();

  return { queueId, position: job.position, promise };
}

function pump() {
  while (activeCount < MAX_DOCX_CONCURRENT && queue.length > 0) {
    const job = queue.shift();
    activeCount++;
    job.status = 'generating';
    updatePositions();

    console.log(`[DOCX-QUEUE] Starting DOCX #${job.queueId.slice(0, 8)} — ${job.student.lastName}_${job.student.firstName} (active: ${activeCount}/${MAX_DOCX_CONCURRENT})`);

    runJob(job)
      .then(result => {
        job.status = 'done';
        job.resolve(result);
      })
      .catch(err => {
        job.status = 'error';
        job.reject(err);
      })
      .finally(() => {
        activeCount--;
        // Release photo buffer immediately to reduce memory pressure
        job.photoBuf = null;
        console.log(`[DOCX-QUEUE] Finished DOCX #${job.queueId.slice(0, 8)} — active: ${activeCount}/${MAX_DOCX_CONCURRENT}, queued: ${queue.length}`);
        // Keep job in Map for 30s so frontend can poll the result
        setTimeout(() => jobs.delete(job.queueId), 30000);
        pump();
      });
  }
}

async function runJob(job) {
  const { generateIDCardDocx } = require('./idCardGenerator');
  const fs = require('fs');
  const path = require('path');

  const { student, photoBuf } = job;
  const docxBuffer = generateIDCardDocx(student, photoBuf);

  if (!docxBuffer || docxBuffer.length < 100) {
    throw new Error('DOCX buffer is empty or too small');
  }
  if (docxBuffer[0] !== 0x50 || docxBuffer[1] !== 0x4B) {
    throw new Error('DOCX buffer is not a valid ZIP/DOCX file');
  }

  const uploadsDir = path.join(__dirname, 'uploads');
  const docxPath = path.join(uploadsDir, `${student.id}_ID.docx`);
  fs.writeFileSync(docxPath, docxBuffer);
  console.log(`[DOCX-QUEUE] DOCX saved: ${docxPath} (${docxBuffer.length} bytes)`);

  return { docxPath };
}

function updatePositions() {
  queue.forEach((job, i) => {
    job.position = i + 1;
  });
}

function getJobStatus(queueId) {
  const job = jobs.get(queueId);
  if (!job) return null;
  return {
    queueId: job.queueId,
    status: job.status,
    position: job.position,
    studentName: `${job.student.lastName}, ${job.student.firstName}`,
    section: job.student.section,
    activeCount,
    queuedCount: queue.length
  };
}

function getQueueStats() {
  return {
    active: activeCount,
    maxConcurrent: MAX_DOCX_CONCURRENT,
    queued: queue.length,
    queuedJobs: queue.map(j => ({
      queueId: j.queueId,
      position: j.position,
      studentName: `${j.student.lastName}, ${j.student.firstName}`
    }))
  };
}

module.exports = { enqueueDOCX, getJobStatus, getQueueStats };
