const sharp = require('sharp');

// ── Constants (matching client-side) ────────────────────────────────
const WHITE_THRESHOLD = 230;
const COLOR_TOLERANCE = 25;
const REQUIRED_WHITE_PERCENT = 65;
const CROP_SIZE = 600;
const UPWARD_SHIFT = 0.10;

// ── White background check (server-side, using sharp) ──────────────
async function checkWhiteBackground(imageBuffer) {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  const w = metadata.width;
  const h = metadata.height;

  const { data } = await image
    .raw()
    .toBuffer({ resolveWithObject: true });

  // 7 sampling zones (edges only, matching client-side)
  const zones = [
    { x1: 0,                     y1: 0,                      x2: Math.round(w * 0.25), y2: Math.round(h * 0.20) },
    { x1: Math.round(w * 0.30), y1: 0,                      x2: Math.round(w * 0.70), y2: Math.round(h * 0.15) },
    { x1: Math.round(w * 0.75), y1: 0,                      x2: w,                     y2: Math.round(h * 0.20) },
    { x1: 0,                     y1: Math.round(h * 0.25),  x2: Math.round(w * 0.12), y2: Math.round(h * 0.75) },
    { x1: Math.round(w * 0.88), y1: Math.round(h * 0.25),  x2: w,                     y2: Math.round(h * 0.75) },
    { x1: 0,                     y1: Math.round(h * 0.80),  x2: Math.round(w * 0.25), y2: h },
    { x1: Math.round(w * 0.75), y1: Math.round(h * 0.80),  x2: w,                     y2: h }
  ];

  let totalSampled = 0;
  let totalWhite = 0;

  for (const z of zones) {
    for (let y = z.y1; y < z.y2; y += 3) {
      for (let x = z.x1; x < z.x2; x += 3) {
        const idx = (y * w + x) * 3;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        const brightness = (r + g + b) / 3;
        const colorRange = Math.max(r, g, b) - Math.min(r, g, b);
        totalSampled++;
        if (brightness >= WHITE_THRESHOLD && colorRange <= COLOR_TOLERANCE) totalWhite++;
      }
    }
  }

  const whitePct = totalSampled > 0 ? (totalWhite / totalSampled) * 100 : 0;
  const passed = whitePct >= REQUIRED_WHITE_PERCENT;

  console.log(`[PHOTO-PROCESSOR] White bg: ${whitePct.toFixed(1)}% (required: ${REQUIRED_WHITE_PERCENT}%) → ${passed ? 'PASS' : 'FAIL'}`);

  return { passed, whitePct };
}

// ── Smart crop: center crop with upward shift ──────────────────────
// Matches client-side behavior when face is centered (no face detection overhead on free tier)
async function smartCrop(imageBuffer) {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  const srcW = metadata.width;
  const srcH = metadata.height;

  // Square crop size
  const cropSize = Math.min(srcW, srcH);

  // Center crop position
  let left = Math.round((srcW - cropSize) / 2);
  let top = Math.round((srcH - cropSize) / 2);

  // Shift upward by 10% (faces are typically in upper portion)
  top -= Math.round(cropSize * UPWARD_SHIFT);
  top = Math.max(0, top);

  console.log(`[PHOTO-PROCESSOR] Smart crop: ${cropSize}x${cropSize} at (${left},${top}) from ${srcW}x${srcH}`);

  const cropped = await sharp(imageBuffer)
    .extract({ left, top, width: cropSize, height: cropSize })
    .resize(CROP_SIZE, CROP_SIZE, { fit: 'fill' })
    .jpeg({ quality: 92 })
    .toBuffer();

  return cropped;
}

// ── Full pipeline: white bg check → smart crop ─────────────────────
async function processBulkPhoto(imageBuffer) {
  // Step 1: White background check
  const bgResult = await checkWhiteBackground(imageBuffer);
  if (!bgResult.passed) {
    return {
      success: false,
      error: `White background required (${bgResult.whitePct.toFixed(1)}% white, need ${REQUIRED_WHITE_PERCENT}%)`
    };
  }

  // Step 2: Smart crop (center + upward shift)
  const processedBuffer = await smartCrop(imageBuffer);

  return {
    success: true,
    processedBuffer,
    whitePct: bgResult.whitePct
  };
}

module.exports = { processBulkPhoto, checkWhiteBackground };
