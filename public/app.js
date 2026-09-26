console.log('[APP] v101 — landing + LRN flow');
const API_URL = '';
let selectedFile = null;
let videoStream = null;
let faceDetectionInterval = null;
let modelsLoaded = false;
let capturedPhotoData = null;
let originalPhotoFile = null;   // committed original (full frame / raw file) — sent as photoOriginal
let pendingOriginalFile = null; // gallery file awaiting white-background check
let allChecksPassed = false;
const REQUIRE_WHITE_BG = true;
let lastWhiteness = null; // Track whiteness of last captured photo

// Barangay data for each town
const barangays = {
    'Cabiao': [
        'Bagong Buhay', 'Bagong Sikat', 'Bagong Silang', 'Concepcion',
        'Entablado', 'Maligaya', 'Natividad North', 'Natividad South',
        'Palasinan', 'San Antonio', 'San Fernando Norte', 'San Fernando Sur',
        'San Gregorio', 'San Juan North', 'San Juan South', 'San Roque',
        'San Vicente', 'Santa Rita', 'Sinipit', 'Polilio',
        'San Carlos', 'Santa Isabel', 'Santa Ines'
    ],
    'San Isidro': [
        'Alua', 'Calaba', 'Malapit', 'Mangga', 'Poblacion',
        'Pulo', 'San Roque', 'Sto. Cristo', 'Tabon'
    ],
    'San Antonio': [
        'Buliran', 'Cama Juan', 'Julo', 'Lawang Kupang', 'Luyos',
        'Maugat', 'Panabingan', 'Papaya', 'Poblacion', 'San Francisco',
        'San Jose', 'San Mariano', 'Santa Cruz', 'Santo Cristo',
        'Santa Barbara', 'Tikiw'
    ],
    'Arayat': [
        'Arenas', 'Baliti', 'Batasan', 'Buensuceso', 'Candating',
        'Gatiawin', 'Guemasan', 'La Paz', 'Lacmit', 'Lacquios',
        'Mangga-Cacutud', 'Mapalad', 'Panlinlang', 'Paralaya',
        'Plazang Luma', 'Poblacion', 'San Agustin Norte', 'San Agustin Sur',
        'San Antonio', 'San Jose Mesulo', 'San Juan Bano', 'San Mateo',
        'San Nicolas', 'San Roque Bitas', 'Cupang', 'Matamo',
        'Santo Niño Tabuan', 'Suclayin', 'Telapayong', 'Kaledian'
    ]
};

// Province and zipcode mapping
const locationData = {
    'Cabiao': { province: 'Nueva Ecija', zipcode: '3107' },
    'San Isidro': { province: 'Nueva Ecija', zipcode: '3106' },
    'San Antonio': { province: 'Nueva Ecija', zipcode: '3108' },
    'Arayat': { province: 'Pampanga', zipcode: '2012' }
};

// Load on page load
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    restoreFormData();
    loadModels();
    loadClasses();
});

async function loadModels() {
    try {
        await faceapi.nets.tinyFaceDetector.loadFromUri('https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/');
        await faceapi.nets.faceLandmark68TinyNet.loadFromUri('https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/');
        modelsLoaded = true;
        console.log('Face detection models loaded');
    } catch (error) {
        console.warn('Face detection models failed to load:', error);
        modelsLoaded = false;
    }
}

async function loadClasses() {
    try {
        const response = await fetch(`${API_URL}/api/classes`);
        const classes = await response.json();
        const select = document.getElementById('classSelect');
        
        classes.forEach(cls => {
            const option = document.createElement('option');
            option.value = cls;
            option.textContent = cls;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading classes:', error);
    }
}

function setupEventListeners() {
    document.getElementById('studentForm').addEventListener('submit', handleSubmit);
    document.getElementById('captureBtn').addEventListener('click', capturePhoto);
    
    // Setup form features
    setupCapsLock();
    setupPhoneFormat();
    setupLRNValidation();
    setupBirthdayDisplay();
    setupAddressDropdowns();
    
    // File upload from gallery — separate pipeline from camera
    document.getElementById('cameraInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                const img = new Image();
                img.onload = () => {
                    pendingOriginalFile = file;
                    processUploadedImage(img);
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        }
    });
}

const FORM_FIELDS = ['firstName','middleName','lastName','sex','birthday','lrn','classSelect','town','barangay','specificLocation','parentName','contactNumber'];
const FORM_STORAGE_KEY = 'idmaker_form_data';

function saveFormData() {
    const data = {};
    FORM_FIELDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) data[id] = el.value;
    });
    try { localStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(data)); } catch(e) {}
}

function restoreFormData() {
    try {
        const raw = localStorage.getItem(FORM_STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        FORM_FIELDS.forEach(id => {
            const el = document.getElementById(id);
            if (el && data[id] !== undefined) el.value = data[id];
        });
        // Trigger town change to repopulate barangay
        const townEl = document.getElementById('town');
        if (townEl && townEl.value) {
            townEl.dispatchEvent(new Event('change'));
        }
    } catch(e) {}
}

// Address dropdowns
function setupAddressDropdowns() {
    const townSelect = document.getElementById('town');
    const barangaySelect = document.getElementById('barangay');
    const specificLocation = document.getElementById('specificLocation');
    
    // Town change handler
    townSelect.addEventListener('change', () => {
        const town = townSelect.value;
        
        // Clear barangay dropdown
        barangaySelect.innerHTML = '<option value="">Select Barangay</option>';
        
        if (town && barangays[town]) {
            barangaySelect.disabled = false;
            barangays[town].forEach(brgy => {
                const option = document.createElement('option');
                option.value = brgy;
                option.textContent = brgy;
                barangaySelect.appendChild(option);
            });
        } else {
            barangaySelect.disabled = true;
        }
        
        updateAddress();
    });
    
    // Barangay change handler
    barangaySelect.addEventListener('change', () => {
        updateAddress();
    });
    
    // Specific location input handler
    specificLocation.addEventListener('input', (e) => {
        const pos = e.target.selectionStart;
        e.target.value = toProperCase(e.target.value);
        e.target.setSelectionRange(pos, pos);
        updateAddress();
    });
}

function toProperCase(str) {
    return str.toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
}

function updateAddress() {
    const town = document.getElementById('town').value;
    const barangay = document.getElementById('barangay').value;
    const specificLocation = document.getElementById('specificLocation').value;
    const addressField = document.getElementById('address');
    
    if (town && barangay && specificLocation) {
        const { province, zipcode } = locationData[town] || {};
        // Format as proper case (capitalize each word)
        const address = `${specificLocation}, ${barangay}, ${town}, ${province || ''} ${zipcode || ''}`.trim();
        addressField.value = toProperCase(address);
    } else {
        addressField.value = '';
    }
}

// Auto caps lock for text fields
function setupCapsLock() {
    const textFields = ['firstName', 'middleName', 'lastName', 'parentName'];
    textFields.forEach(id => {
        const field = document.getElementById(id);
        if (field) {
            field.addEventListener('input', (e) => {
                e.target.value = e.target.value.toUpperCase();
                updateFullName();
            });
        }
    });
}

function updateFullName() {
    const firstName = document.getElementById('firstName').value.trim();
    const middleName = document.getElementById('middleName').value.trim();
    const lastName = document.getElementById('lastName').value.trim();
    
    let fullName = '';
    if (lastName) fullName += lastName;
    if (firstName) fullName += (fullName ? ', ' : '') + firstName;
    if (middleName) fullName += ' ' + middleName.charAt(0) + '.';
    
    document.getElementById('fullName').value = fullName;
}

// Phone number formatting (09xx-xxx-xxxx)
function setupPhoneFormat() {
    const phoneField = document.getElementById('contactNumber');
    if (phoneField) {
        phoneField.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, '');
            
            if (value.length > 11) {
                value = value.substring(0, 11);
            }
            
            if (value.length > 4) {
                value = value.substring(0, 4) + '-' + value.substring(4);
            }
            if (value.length > 8) {
                value = value.substring(0, 8) + '-' + value.substring(8);
            }
            
            e.target.value = value;
        });
    }
}

// LRN validation (12 digits only)
function setupLRNValidation() {
    const lrnField = document.getElementById('lrn');
    const lrnValidation = document.getElementById('lrnValidation');
    
    if (lrnField && lrnValidation) {
        lrnField.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/\D/g, '');
            
            const value = e.target.value;
            
            if (value.length === 0) {
                lrnValidation.classList.add('hidden');
            } else if (value.length < 12) {
                lrnValidation.textContent = `${value.length}/12 digits`;
                lrnValidation.className = 'field-validation invalid';
                lrnValidation.classList.remove('hidden');
            } else if (value.length === 12) {
                lrnValidation.textContent = '✓ Valid LRN';
                lrnValidation.className = 'field-validation valid';
                lrnValidation.classList.remove('hidden');
            }
        });
        
        lrnField.addEventListener('blur', (e) => {
            if (e.target.value.length > 0 && e.target.value.length < 12) {
                lrnValidation.textContent = 'LRN must be 12 digits';
                lrnValidation.className = 'field-validation invalid';
                lrnValidation.classList.remove('hidden');
            }
        });
    }
}

// Birthday format display
function setupBirthdayDisplay() {
    const birthdayField = document.getElementById('birthday');
    const display = document.getElementById('birthdayDisplay');
    
    if (birthdayField && display) {
        birthdayField.addEventListener('change', (e) => {
            const date = new Date(e.target.value);
            if (!isNaN(date.getTime())) {
                const options = { year: 'numeric', month: 'long', day: 'numeric' };
                display.textContent = date.toLocaleDateString('en-US', options);
            }
        });
    }
}

// Camera Modal Functions
async function openCameraModal() {
    const modal = document.getElementById('cameraModal');
    modal.classList.remove('hidden');
    
    const captureBtn = document.getElementById('captureBtn');
    captureBtn.setAttribute('disabled', 'disabled');
    allChecksPassed = false;
    
    try {
        videoStream = await navigator.mediaDevices.getUserMedia({
            video: { 
                facingMode: 'user',
                width: { ideal: 640 },
                height: { ideal: 480 }
            }
        });
        
        const video = document.getElementById('cameraPreview');
        video.srcObject = videoStream;
        
        // Wait for video to be fully ready
        await new Promise((resolve) => {
            if (video.readyState >= 2) {
                resolve();
            } else {
                video.onloadeddata = resolve;
            }
        });
        console.log('Camera stream ready, dimensions:', video.videoWidth, 'x', video.videoHeight);
        
        // Start face detection if available (optional enhancement)
        if (modelsLoaded) {
            startFaceDetection();
        } else {
            allChecksPassed = true;
            updateCaptureButton();
            updateFaceStatus('Camera ready - position face in center', 'warning');
        }
    } catch (error) {
        console.error('Error accessing camera:', error);
        closeCameraModal();
        showStatus('Camera access denied. Please allow camera permissions.', 'info');
    }
}

function closeCameraModal() {
    const modal = document.getElementById('cameraModal');
    modal.classList.add('hidden');
    
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }
    
    if (faceDetectionInterval) {
        clearInterval(faceDetectionInterval);
        faceDetectionInterval = null;
    }
    
    resetFaceChecks();
}

function startFaceDetection() {
    const video = document.getElementById('cameraPreview');
    const canvas = document.getElementById('faceCanvas');
    
    faceDetectionInterval = setInterval(async () => {
        if (!video.videoWidth) return;
        
        const detections = await faceapi
            .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ 
                inputSize: 640,
                scoreThreshold: 0.5
            }))
            .withFaceLandmarks(true);
        
        const ctx = canvas.getContext('2d');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        if (detections.length === 0) {
            allChecksPassed = false;
            updateCaptureButton();
            updateFaceChecks(false, false, false, false, false);
            updateFaceStatus('No face detected - position face in frame', 'warning');
            return;
        }
        
        const detection = detections.reduce((prev, current) => 
            (prev.detection.box.area > current.detection.box.area) ? prev : current
        );
        
        const box = detection.detection.box;
        const landmarks = detection.landmarks;
        const videoWidth = video.videoWidth;
        
        // Check if face is centered
        const faceCenterX = box.x + box.width / 2;
        const isCentered = Math.abs(faceCenterX - videoWidth / 2) < videoWidth * 0.15;
        
        // Check if face size is appropriate (face should be 30-50% of frame for 70% fill in crop)
        const isGoodSize = box.width > videoWidth * 0.18 && box.width < videoWidth * 0.55;
        
        // Check face rotation/tilt using landmarks
        const leftEye = landmarks.getLeftEye();
        const rightEye = landmarks.getRightEye();
        const leftEyeCenter = leftEye.reduce((sum, p) => ({ x: sum.x + p.x, y: sum.y + p.y }), { x: 0, y: 0 });
        leftEyeCenter.x /= leftEye.length;
        leftEyeCenter.y /= leftEye.length;
        const rightEyeCenter = rightEye.reduce((sum, p) => ({ x: sum.x + p.x, y: sum.y + p.y }), { x: 0, y: 0 });
        rightEyeCenter.x /= rightEye.length;
        rightEyeCenter.y /= rightEye.length;
        
        // Calculate angle between eyes (should be close to horizontal)
        const eyeAngle = Math.atan2(rightEyeCenter.y - leftEyeCenter.y, rightEyeCenter.x - leftEyeCenter.x);
        const eyeAngleDegrees = Math.abs(eyeAngle * 180 / Math.PI);
        const isStraight = eyeAngleDegrees < 8; // Max 8 degrees tilt allowed
        
        const brightness = await checkBrightness(video, box);
        const isGoodBrightness = brightness > 40 && brightness < 220;
        
        const bgResult = await checkBackgroundWhiteness(video, box);
        const isWhiteBg = bgResult.passed;
        const whiteBgOK = REQUIRE_WHITE_BG ? isWhiteBg : true;
        
        ctx.strokeStyle = isCentered && isGoodSize && whiteBgOK && isStraight ? '#48bb78' : '#dd6b20';
        ctx.lineWidth = 3;
        ctx.strokeRect(box.x, box.y, box.width, box.height);
        
        ctx.fillStyle = '#667eea';
        landmarks.positions.forEach(pos => {
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 2, 0, Math.PI * 2);
            ctx.fill();
        });
        
        const allPassed = isCentered && isGoodSize && isGoodBrightness && whiteBgOK && isStraight;
        allChecksPassed = allPassed;
        updateCaptureButton();
        updateFaceChecks(true, isCentered, isGoodSize, isGoodBrightness, isWhiteBg, isStraight);
        
        const guideOval = document.getElementById('guideOval');
        guideOval.className = 'guide-oval';
        if (allPassed) {
            guideOval.classList.add('detected', 'centered');
            updateFaceStatus('Perfect! Ready to capture', 'success');
        } else if (!isStraight) {
            guideOval.classList.add('warning');
            updateFaceStatus('Face forward — do not tilt your head', 'warning');
        } else if (!isCentered) {
            guideOval.classList.add('warning');
            updateFaceStatus('Move face to center of frame', 'warning');
        } else if (!isGoodSize) {
            guideOval.classList.add('warning');
            updateFaceStatus('Move closer or further from camera', 'warning');
        } else {
            updateFaceStatus('Almost there...', 'warning');
        }
    }, 200);
}

async function checkBrightness(video, box) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = box.width;
    canvas.height = box.height;
    
    ctx.drawImage(video, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
    
    const imageData = ctx.getImageData(0, 0, box.width, box.height);
    const data = imageData.data;
    let sum = 0;
    
    for (let i = 0; i < data.length; i += 4) {
        sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
    }
    
    return sum / (data.length / 4);
}

async function checkBackgroundWhiteness(video, faceBox) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const w = video.videoWidth;
    const h = video.videoHeight;
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);

    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    // Camera-specific thresholds
    const CAM_BRIGHTNESS = 180;
    const CAM_COLOR_TOLERANCE = 40;
    const CAM_WHITE_PCT_REQUIRED = 75;

    // Sample edges only
    const marginX = Math.round(w * 0.10);
    const marginTop = Math.round(h * 0.15);
    const marginBot = h - Math.round(h * 0.15);

    let whiteCount = 0, totalCount = 0;

    function isWhitePixel(idx) {
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        const brightness = (r + g + b) / 3;
        const colorRange = Math.max(r, g, b) - Math.min(r, g, b);
        return brightness >= CAM_BRIGHTNESS && colorRange <= CAM_COLOR_TOLERANCE;
    }

    // Top band
    for (let y = 0; y < marginTop; y += 3) {
        for (let x = 0; x < w; x += 3) {
            const idx = (y * w + x) * 4;
            totalCount++;
            if (isWhitePixel(idx)) whiteCount++;
        }
    }
    // Bottom band
    for (let y = marginBot; y < h; y += 3) {
        for (let x = 0; x < w; x += 3) {
            const idx = (y * w + x) * 4;
            totalCount++;
            if (isWhitePixel(idx)) whiteCount++;
        }
    }
    // Left band
    for (let y = marginTop; y < marginBot; y += 3) {
        for (let x = 0; x < marginX; x += 3) {
            const idx = (y * w + x) * 4;
            totalCount++;
            if (isWhitePixel(idx)) whiteCount++;
        }
    }
    // Right band
    for (let y = marginTop; y < marginBot; y += 3) {
        for (let x = w - marginX; x < w; x += 3) {
            const idx = (y * w + x) * 4;
            totalCount++;
            if (isWhitePixel(idx)) whiteCount++;
        }
    }

    const whitePct = totalCount > 0 ? (whiteCount / totalCount) * 100 : 0;
    console.log('[CAMERA BG] brightness>=', CAM_BRIGHTNESS, 'white%:', whitePct.toFixed(1), 'need:', CAM_WHITE_PCT_REQUIRED);
    return { whitePct, passed: whitePct >= CAM_WHITE_PCT_REQUIRED };
}

async function checkWhiteness(source, faceRegion) {
    const w = source.naturalWidth || source.width;
    const h = source.naturalHeight || source.height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0, w, h);

    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    // Sample edges only — background is visible around the borders
    // Top 15%, bottom 15%, left 10%, right 10% of the image
    const marginX = Math.round(w * 0.10);
    const marginTop = Math.round(h * 0.15);
    const marginBot = h - Math.round(h * 0.15);

    const edgePixels = [];

    // Top band
    for (let y = 0; y < marginTop; y += 3) {
        for (let x = 0; x < w; x += 3) {
            const idx = (y * w + x) * 4;
            edgePixels.push((data[idx] + data[idx + 1] + data[idx + 2]) / 3);
        }
    }
    // Bottom band
    for (let y = marginBot; y < h; y += 3) {
        for (let x = 0; x < w; x += 3) {
            const idx = (y * w + x) * 4;
            edgePixels.push((data[idx] + data[idx + 1] + data[idx + 2]) / 3);
        }
    }
    // Left band (excluding already-sampled top/bottom corners)
    for (let y = marginTop; y < marginBot; y += 3) {
        for (let x = 0; x < marginX; x += 3) {
            const idx = (y * w + x) * 4;
            edgePixels.push((data[idx] + data[idx + 1] + data[idx + 2]) / 3);
        }
    }
    // Right band
    for (let y = marginTop; y < marginBot; y += 3) {
        for (let x = w - marginX; x < w; x += 3) {
            const idx = (y * w + x) * 4;
            edgePixels.push((data[idx] + data[idx + 1] + data[idx + 2]) / 3);
        }
    }

    if (edgePixels.length === 0) return 0;

    // Sort and check: at least 80% of edge pixels must be white (>200)
    const whiteCount = edgePixels.filter(v => v >= 200).length;
    const whitePct = (whiteCount / edgePixels.length) * 100;
    const avg = edgePixels.reduce((a, b) => a + b, 0) / edgePixels.length;

    console.log('[WHITENESS] avg:', avg.toFixed(1), 'white%:', whitePct.toFixed(1) + '%', 'threshold: 80% white');
    return { avg, whitePct };
}

// ============================================================
// UPLOAD-SPECIFIC WHITE BACKGROUND DETECTION
// ============================================================
const WHITE_THRESHOLD = 210;
const COLOR_TOLERANCE = 35;
const REQUIRED_WHITE_PERCENT = 80;
const WHITE_DETECTION_DEBUG = false;

function detectWhiteBackground(source) {
    const w = source.naturalWidth || source.width;
    const h = source.naturalHeight || source.height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    // Define 7 sampling zones — edges only, avoid center
    const zones = {
        topLeft:     { x1: 0,             y1: 0,              x2: Math.round(w * 0.25), y2: Math.round(h * 0.20) },
        topCenter:   { x1: Math.round(w * 0.30), y1: 0,              x2: Math.round(w * 0.70), y2: Math.round(h * 0.15) },
        topRight:    { x1: Math.round(w * 0.75), y1: 0,              x2: w,                     y2: Math.round(h * 0.20) },
        left:        { x1: 0,             y1: Math.round(h * 0.25), x2: Math.round(w * 0.12), y2: Math.round(h * 0.75) },
        right:       { x1: Math.round(w * 0.88), y1: Math.round(h * 0.25), x2: w,                     y2: Math.round(h * 0.75) },
        bottomLeft:  { x1: 0,             y1: Math.round(h * 0.80), x2: Math.round(w * 0.25), y2: h },
        bottomRight: { x1: Math.round(w * 0.75), y1: Math.round(h * 0.80), x2: w,                     y2: h }
    };

    const zoneResults = {};
    let totalSampled = 0;
    let totalWhite = 0;
    let totalBrightness = 0;

    for (const [name, z] of Object.entries(zones)) {
        let zSampled = 0, zWhite = 0, zBrightness = 0;
        for (let y = z.y1; y < z.y2; y += 3) {
            for (let x = z.x1; x < z.x2; x += 3) {
                const idx = (y * w + x) * 4;
                const r = data[idx], g = data[idx + 1], b = data[idx + 2];
                const brightness = (r + g + b) / 3;
                const colorRange = Math.max(r, g, b) - Math.min(r, g, b);
                const isWhite = brightness >= WHITE_THRESHOLD && colorRange <= COLOR_TOLERANCE;
                zSampled++;
                zBrightness += brightness;
                if (isWhite) zWhite++;
            }
        }
        const zPct = zSampled > 0 ? (zWhite / zSampled) * 100 : 0;
        zoneResults[name] = {
            sampled: zSampled,
            white: zWhite,
            pct: zPct,
            avgBrightness: zSampled > 0 ? zBrightness / zSampled : 0
        };
        totalSampled += zSampled;
        totalWhite += zWhite;
        totalBrightness += zBrightness;
    }

    const overallWhitePct = totalSampled > 0 ? (totalWhite / totalSampled) * 100 : 0;
    const overallAvgBrightness = totalSampled > 0 ? totalBrightness / totalSampled : 0;

    const result = {
        passed: overallWhitePct >= REQUIRED_WHITE_PERCENT,
        whitePct: overallWhitePct,
        averageBrightness: overallAvgBrightness,
        sampledPixels: totalSampled,
        whitePixels: totalWhite,
        threshold: WHITE_THRESHOLD,
        colorTolerance: COLOR_TOLERANCE,
        requiredPercent: REQUIRED_WHITE_PERCENT,
        zones: zoneResults
    };

    console.log('[UPLOAD WHITENESS]', {
        passed: result.passed,
        whitePct: result.whitePct.toFixed(1) + '%',
        averageBrightness: result.averageBrightness.toFixed(1),
        sampledPixels: result.sampledPixels,
        whitePixels: result.whitePixels
    });
    console.log('[UPLOAD WHITENESS ZONES]', Object.fromEntries(
        Object.entries(zoneResults).map(([k, v]) => [k, v.pct.toFixed(1) + '%'])
    ));
    console.log('[UPLOAD PIPELINE]', result.passed ? 'BACKGROUND PASS' : 'BACKGROUND FAIL');

    return result;
}

// ============================================================
// UPLOAD-SPECIFIC PROCESSING PIPELINE (DO NOT MODIFY CAMERA)
// ============================================================
async function processUploadedImage(source) {
    const srcW = source.naturalWidth || source.width;
    const srcH = source.naturalHeight || source.height;
    console.log('[UPLOAD] Original image loaded:', srcW, 'x', srcH);

    // Step 1: White background check FIRST — before any cropping
    const bgResult = detectWhiteBackground(source);

    if (!bgResult.passed) {
        console.warn('[UPLOAD] Image rejected because background is not white enough');
        document.getElementById('rejectDetected').textContent = bgResult.whitePct.toFixed(1) + '%';
        document.getElementById('rejectModal').classList.remove('hidden');
        return;
    }

    console.log('[UPLOAD] Background passed. Continuing to face crop.');

    // Background passed — commit the raw original file for the Drive full-size upload
    originalPhotoFile = pendingOriginalFile;
    pendingOriginalFile = null;

    // Step 2: Face detection
    let faceRegion = null;
    if (modelsLoaded) {
        const DETECT_SIZE = 512;
        const detectCanvas = document.createElement('canvas');
        const scale = DETECT_SIZE / Math.max(srcW, srcH);
        detectCanvas.width = Math.round(srcW * scale);
        detectCanvas.height = Math.round(srcH * scale);
        const dCtx = detectCanvas.getContext('2d');
        dCtx.drawImage(source, 0, 0, detectCanvas.width, detectCanvas.height);

        try {
            const detections = await faceapi
                .detectAllFaces(detectCanvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.4 }))
                .withFaceLandmarks(true);

            if (detections.length > 0) {
                const det = detections.reduce((a, b) =>
                    a.detection.box.area > b.detection.box.area ? a : b
                );
                const positions = det.landmarks.positions;
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const p of positions) {
                    if (p.x < minX) minX = p.x;
                    if (p.y < minY) minY = p.y;
                    if (p.x > maxX) maxX = p.x;
                    if (p.y > maxY) maxY = p.y;
                }
                const tightW = maxX - minX;
                const tightH = maxY - minY;
                const padX = tightW * 0.15;
                const padY = tightH * 0.15;
                faceRegion = {
                    x: (minX - padX) / scale,
                    y: (minY - padY) / scale,
                    width: (tightW + padX * 2) / scale,
                    height: (tightH + padY * 2) / scale
                };
                console.log('[UPLOAD] Face detected:', Math.round(faceRegion.width), 'x', Math.round(faceRegion.height));
            }
        } catch (err) {
            console.warn('[UPLOAD] Face detection failed:', err);
        }
    }

    // Step 3: Crop to square
    capturedPhotoData = cropToSquare(source, faceRegion, srcW, srcH);

    // Step 4: Store whiteness for preview modal
    lastWhiteness = bgResult;

    // Step 5: Show preview
    closeCameraModal();
    showPreviewModal();
}

function updateFaceChecks(faceDetected, centered, goodSize, goodLighting, whiteBg, straight) {
    const checks = {
        checkFace:   faceDetected,
        checkCenter: centered,
        checkSize:   goodSize,
        checkBg:     whiteBg
    };
    Object.entries(checks).forEach(([id, passed]) => {
        const el = document.getElementById(id);
        if (el) el.className = `check-item ${passed ? 'passed' : ''}`;
    });
}

function resetFaceChecks() {
    ['checkFace', 'checkCenter', 'checkSize', 'checkBg'].forEach(id => {
        document.getElementById(id).className = 'check-item';
    });
    allChecksPassed = false;
    updateCaptureButton();
}

function updateCaptureButton() {
    const captureBtn = document.getElementById('captureBtn');
    if (allChecksPassed) {
        captureBtn.removeAttribute('disabled');
    } else {
        captureBtn.setAttribute('disabled', 'disabled');
    }
}

function updateFaceStatus(text, type) {
    const status = document.getElementById('faceStatus');
    status.querySelector('.status-text').textContent = text;
    status.className = `face-status ${type}`;
}

function capturePhoto() {
    console.log('capturePhoto called');
    const video = document.getElementById('cameraPreview');
    
    if (!video || !video.srcObject) {
        console.error('No video stream found');
        showStatus('Camera not ready', 'info');
        return;
    }
    
    if (!video.videoWidth || !video.videoHeight) {
        console.log('Video not ready yet, retrying...');
        video.onloadedmetadata = () => capturePhoto();
        return;
    }
    
    // Always use canvas path — reliable coordinate mapping
    captureWithCanvas(video);
}

function captureWithCanvas(video) {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    capturedPhotoData = canvas.toDataURL('image/jpeg', 0.92);
    // Keep the full uncropped frame as the original for the Drive full-size upload
    originalPhotoFile = dataURLtoFile(capturedPhotoData, 'photo_full.jpg');
    processCapturedImage(canvas);
}

async function processCapturedImage(source) {
    const srcW = source.naturalWidth || source.width;
    const srcH = source.naturalHeight || source.height;
    console.log('[PIPELINE] Captured:', srcW, 'x', srcH);

    let faceRegion = null;

    if (modelsLoaded) {
        // Downscale to 512px for reliable detection
        const DETECT_SIZE = 512;
        const detectCanvas = document.createElement('canvas');
        const scale = DETECT_SIZE / Math.max(srcW, srcH);
        detectCanvas.width = Math.round(srcW * scale);
        detectCanvas.height = Math.round(srcH * scale);
        const dCtx = detectCanvas.getContext('2d');
        dCtx.drawImage(source, 0, 0, detectCanvas.width, detectCanvas.height);

        try {
            const detections = await faceapi
                .detectAllFaces(detectCanvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.4 }))
                .withFaceLandmarks(true);

            console.log('[PIPELINE] Faces found:', detections.length);

            if (detections.length > 0) {
                const det = detections.reduce((a, b) =>
                    a.detection.box.area > b.detection.box.area ? a : b
                );

                // Get all 68 landmark points and compute tight face bounds
                const landmarks = det.landmarks;
                const positions = landmarks.positions;

                // Find min/max across all landmark points
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const p of positions) {
                    if (p.x < minX) minX = p.x;
                    if (p.y < minY) minY = p.y;
                    if (p.x > maxX) maxX = p.x;
                    if (p.y > maxY) maxY = p.y;
                }

                // Add 15% padding around the tight landmark bounds
                const tightW = maxX - minX;
                const tightH = maxY - minY;
                const padX = tightW * 0.15;
                const padY = tightH * 0.15;

                faceRegion = {
                    x: (minX - padX) / scale,
                    y: (minY - padY) / scale,
                    width: (tightW + padX * 2) / scale,
                    height: (tightH + padY * 2) / scale
                };

                console.log('[PIPELINE] Landmark face region:',
                    'x=' + Math.round(faceRegion.x),
                    'y=' + Math.round(faceRegion.y),
                    'w=' + Math.round(faceRegion.width),
                    'h=' + Math.round(faceRegion.height));

                // Also log detector box for comparison
                const box = det.detection.box;
                console.log('[PIPELINE] Detector box (loose):',
                    'w=' + Math.round(box.width / scale),
                    'h=' + Math.round(box.height / scale));
            }
        } catch (err) {
            console.warn('[PIPELINE] Detection failed:', err);
        }
    }

    capturedPhotoData = cropToSquare(source, faceRegion, srcW, srcH);
    closeCameraModal();
    showPreviewModal();
}

function cropToSquare(source, faceRegion, srcW, srcH) {
    let cropSize, cx, cy;

    if (faceRegion) {
        // faceRegion is the tight landmark-based face bounds with 15% padding
        // Crop so that this region fills 75% of the square (reduced from 85%)
        cropSize = Math.max(faceRegion.width, faceRegion.height) / 0.65;
        cropSize = Math.min(cropSize, srcW, srcH);

        // Center on the face region, shifted 10% up for more forehead
        cx = faceRegion.x + faceRegion.width / 2;
        cy = faceRegion.y + faceRegion.height / 2 - cropSize * 0.10;

        let sx = Math.round(cx - cropSize / 2);
        let sy = Math.round(cy - cropSize / 2);
        if (sx < 0) sx = 0;
        if (sy < 0) sy = 0;
        if (sx + cropSize > srcW) sx = srcW - cropSize;
        if (sy + cropSize > srcH) sy = srcH - cropSize;
        sx = Math.max(0, sx);
        sy = Math.max(0, sy);

        console.log('[CROP] Landmark crop:', sx, sy, Math.round(cropSize), '-> 600x600');

        const out = document.createElement('canvas');
        out.width = 600;
        out.height = 600;
        const ctx = out.getContext('2d');
        ctx.drawImage(source, sx, sy, cropSize, cropSize, 0, 0, 600, 600);
        return out.toDataURL('image/jpeg', 0.92);
    }

    // Fallback: center crop
    cropSize = Math.min(srcW, srcH);
    const sx = Math.round((srcW - cropSize) / 2);
    const sy = Math.round((srcH - cropSize) / 2);

    console.log('[CROP] No face — center crop:', sx, sy, Math.round(cropSize));

    const out = document.createElement('canvas');
    out.width = 600;
    out.height = 600;
    const ctx = out.getContext('2d');
    ctx.drawImage(source, sx, sy, cropSize, cropSize, 0, 0, 600, 600);
    return out.toDataURL('image/jpeg', 0.92);
}

function showPreviewModal() {
    const modal = document.getElementById('previewModal');
    modal.classList.remove('hidden');
    document.getElementById('capturedPhoto').src = capturedPhotoData;

    const approveBtn = document.getElementById('approveBtn');
    const bgNote = document.getElementById('bgNote');
    console.log('[PREVIEW] Enabling approve button');
    approveBtn.removeAttribute('disabled');
    approveBtn.textContent = '✓ Use Photo';
    approveBtn.style.opacity = '1';
    approveBtn.style.pointerEvents = 'auto';
    if (bgNote) {
        bgNote.textContent = '';
        bgNote.classList.add('hidden');
    }
}

function approvePhoto() {
    selectedFile = dataURLtoFile(capturedPhotoData, 'photo.jpg');
    
    const preview = document.getElementById('photoPreview');
    preview.innerHTML = `<img src="${capturedPhotoData}" alt="Student Photo">`;
    
    showPhotoValidation('✓ Photo approved', 'valid');
    document.getElementById('previewModal').classList.add('hidden');
}

function rejectPhoto() {
    capturedPhotoData = null;
    originalPhotoFile = null;
    document.getElementById('previewModal').classList.add('hidden');
    openCameraModal();
}

function dataURLtoFile(dataURL, filename) {
    const arr = dataURL.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    
    return new File([u8arr], filename, { type: mime });
}

function showPhotoValidation(message, type) {
    const validation = document.getElementById('photoValidation');
    validation.textContent = message;
    validation.className = `photo-validation ${type}`;
    validation.classList.remove('hidden');
}

// Form Submit
let currentStudentData = null;
let pendingDuplicateOverride = false;

async function handleSubmit(e) {
    e.preventDefault();
    
    if (!selectedFile) {
        showStatus('Please capture a photo first', 'info');
        return;
    }

    const parentVal = document.getElementById('parentName').value.trim();
    const parentWords = parentVal.split(/\s+/).filter(Boolean);
    if (parentWords.length < 2) {
        showStatus('Parent/Guardian name must be at least 2 words (e.g. Juan Dela Cruz)', 'info');
        document.getElementById('parentName').focus();
        return;
    }
    
    openConfirmModal();
}

function openConfirmModal() {
    const photoSrc = capturedPhotoData || (selectedFile ? URL.createObjectURL(selectedFile) : '');
    document.getElementById('confirmPhoto').src = photoSrc;

    const firstName = document.getElementById('firstName').value.trim();
    const middleName = document.getElementById('middleName').value.trim();
    const lastName  = document.getElementById('lastName').value.trim();
    const mi       = document.getElementById('mi') ? document.getElementById('mi').value.trim() : '';
    const fullName  = [firstName, middleName, lastName].filter(Boolean).join(' ');

    document.getElementById('confirmName').textContent     = fullName;
    document.getElementById('confirmSection').textContent   = document.getElementById('classSelect').value;
    document.getElementById('confirmLRN').textContent       = document.getElementById('lrn').value || '—';
    document.getElementById('confirmBirthday').textContent  = document.getElementById('birthday').value || '—';
    document.getElementById('confirmSex').textContent       = document.getElementById('sex').value || '—';

    const town = document.getElementById('town').value || '';
    const brgy = document.getElementById('barangay').value || '';
    const loc  = document.getElementById('specificLocation').value || '';
    document.getElementById('confirmAddress').textContent = [loc, brgy, town].filter(Boolean).join(', ') || '—';

    document.getElementById('confirmParent').textContent  = document.getElementById('parentName').value || '—';
    document.getElementById('confirmContact').textContent = document.getElementById('contactNumber').value || '—';

    document.getElementById('confirmModal').classList.remove('hidden');
}

function closeRejectModal() {
    document.getElementById('rejectModal').classList.add('hidden');
}

function closeConfirmModal() {
    document.getElementById('confirmModal').classList.add('hidden');
}

let pendingOverrideData = null;

async function confirmAndGenerate() {
    closeConfirmModal();
    
    const firstName = document.getElementById('firstName').value.trim();
    const lastName  = document.getElementById('lastName').value.trim();
    const lrn      = document.getElementById('lrn').value.trim();
    
    showLoading('Checking for duplicates...');
    
    try {
        const checkRes = await fetch(`${API_URL}/api/students/check-duplicate?firstName=${encodeURIComponent(firstName)}&lastName=${encodeURIComponent(lastName)}&lrn=${encodeURIComponent(lrn)}`);
        const checkData = await checkRes.json();
        
        if (checkData.isDuplicate) {
            hideLoading();
            showDuplicateModal(checkData, firstName, lastName, lrn);
            return;
        }
    } catch (err) {
        console.warn('Duplicate check failed, proceeding:', err);
    }
    
    await submitNewStudent();
}

function showDuplicateModal(checkData, firstName, lastName, lrn) {
    document.getElementById('dupNewLast').textContent = lastName;
    document.getElementById('dupNewFirst').textContent = firstName;
    document.getElementById('dupNewLRN').textContent = lrn;

    const match = checkData.matches[0];
    document.getElementById('dupOldLast').textContent = match.lastName;
    document.getElementById('dupOldFirst').textContent = match.firstName;
    document.getElementById('dupOldLRN').textContent = match.lrn;
    document.getElementById('dupOldSection').textContent = match.section;

    document.getElementById('dupMatchName').style.display = checkData.matchedByName ? 'block' : 'none';
    document.getElementById('dupMatchLRN').style.display = checkData.matchedByLRN ? 'block' : 'none';

    pendingOverrideData = { existingId: match.id };

    document.getElementById('duplicateModal').classList.remove('hidden');
}

function cancelOverride() {
    document.getElementById('duplicateModal').classList.add('hidden');
    pendingOverrideData = null;
    showStatus('Entry cancelled by user', 'info');
}

async function confirmOverride() {
    document.getElementById('duplicateModal').classList.add('hidden');
    
    if (!pendingOverrideData) return;
    
    showLoading('Deleting old record and creating new one...');
    
    const formData = new FormData();
    formData.append('firstName', document.getElementById('firstName').value);
    formData.append('middleName', document.getElementById('middleName').value);
    formData.append('lastName', document.getElementById('lastName').value);
    formData.append('sex', document.getElementById('sex').value);
    formData.append('birthday', document.getElementById('birthday').value);
    formData.append('lrn', document.getElementById('lrn').value);
    formData.append('section', document.getElementById('classSelect').value);
    formData.append('address', document.getElementById('address').value);
    formData.append('parentName', document.getElementById('parentName').value);
    formData.append('contactNumber', document.getElementById('contactNumber').value);
    formData.append('photo', selectedFile);
    if (originalPhotoFile) formData.append('photoOriginal', originalPhotoFile);
    formData.append('existingId', pendingOverrideData.existingId);
    
    try {
        const response = await fetch(`${API_URL}/api/students/override`, {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (result.success) {
            currentStudentData = result.student;
            showStatus('Override complete! New record created.', 'success');
            saveFormData();
            const queueId = result.queue?.queueId;
            const position = result.queue?.position || 0;
            hideLoading();
            if (queueId) {
                showQueueBar(position);
                pollDOCXQueue(queueId, result.student);
            } else {
                finalizeSubmission(result.student);
            }
        } else {
            hideLoading();
            showStatus(result.error || 'Override failed', 'info');
        }
    } catch (error) {
        hideLoading();
        showStatus('Error during override: ' + error.message, 'info');
    }
    
    pendingOverrideData = null;
}

function showQueueBar(position) {
    const bar = document.getElementById('queueBar');
    const text = document.getElementById('queueBarText');
    if (bar && text) {
        text.textContent = `Position ${position} in queue — please do not close this window`;
        bar.classList.remove('hidden');
    }
    // Disable submit button while in queue
    const submitBtn = document.querySelector('#studentForm button[type="submit"]');
    if (submitBtn) submitBtn.setAttribute('disabled', 'disabled');
    window.__queueActive = true;
    window.addEventListener('beforeunload', window.__queueWarnHandler = (e) => {
        if (window.__queueActive) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
}

function hideQueueBar() {
    const bar = document.getElementById('queueBar');
    if (bar) bar.classList.add('hidden');
    // Re-enable submit button
    const submitBtn = document.querySelector('#studentForm button[type="submit"]');
    if (submitBtn) submitBtn.removeAttribute('disabled');
    window.__queueActive = false;
    if (window.__queueWarnHandler) {
        window.removeEventListener('beforeunload', window.__queueWarnHandler);
    }
}

async function pollDOCXQueue(queueId, student, attempt = 0) {
    const maxAttempts = 60;
    try {
        const res = await fetch(`${API_URL}/api/queue-status/${queueId}`);
        
        // 404 = job completed and cleaned up from memory
        if (res.status === 404) {
            hideQueueBar();
            finalizeSubmission(student);
            return;
        }

        const data = await res.json();

        if (data.status === 'done') {
            hideQueueBar();
            finalizeSubmission(student);
            return;
        }
        if (data.status === 'error') {
            hideQueueBar();
            showStatus('ID card generation failed. Please try again.', 'info');
            return;
        }
        const bar = document.getElementById('queueBar');
        const text = document.getElementById('queueBarText');
        if (data.status === 'generating') {
            if (text) text.textContent = `Generating ID card... (${data.activeCount}/${data.maxConcurrent} slots) — please do not close this window`;
        } else if (data.position > 0) {
            if (text) text.textContent = `Position ${data.position} in queue — please do not close this window`;
        }
        if (attempt >= maxAttempts) {
            hideQueueBar();
            showStatus('Timed out waiting for ID card generation.', 'info');
            return;
        }
    } catch (error) {
        if (attempt >= maxAttempts) {
            hideQueueBar();
            showStatus('Could not check queue status.', 'info');
            return;
        }
    }
    setTimeout(() => pollDOCXQueue(queueId, student, attempt + 1), 2000);
}

function finalizeSubmission(student) {
    currentStudentData = student;
    hideQueueBar();
    showStatus('ID generated successfully!', 'success');
    updateIDPreview(student);
    document.getElementById('idPreview').classList.remove('hidden');
    document.getElementById('downloadSection').classList.remove('hidden');
    setDriveNote('Uploading to Google Drive…', 'pending');
    pollUploadStatus(student.id);
    hideLoading();
}

async function submitNewStudent() {
    showLoading('Submitting...');
    
    const formData = new FormData();
    formData.append('firstName', document.getElementById('firstName').value);
    formData.append('middleName', document.getElementById('middleName').value);
    formData.append('lastName', document.getElementById('lastName').value);
    formData.append('sex', document.getElementById('sex').value);
    formData.append('birthday', document.getElementById('birthday').value);
    formData.append('lrn', document.getElementById('lrn').value);
    formData.append('section', document.getElementById('classSelect').value);
    formData.append('address', document.getElementById('address').value);
    formData.append('parentName', document.getElementById('parentName').value);
    formData.append('contactNumber', document.getElementById('contactNumber').value);
    formData.append('photo', selectedFile);
    if (originalPhotoFile) formData.append('photoOriginal', originalPhotoFile);
    
    try {
        const response = await fetch(`${API_URL}/api/students`, {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (result.success) {
            currentStudentData = result.student;
            saveFormData();
            const queueId = result.queue?.queueId;
            const position = result.queue?.position || 0;
            hideLoading();
            if (queueId) {
                showQueueBar(position);
                pollDOCXQueue(queueId, result.student);
            } else {
                finalizeSubmission(result.student);
            }
        } else if (response.status === 409 && result.duplicate) {
            hideLoading();
            const firstName = document.getElementById('firstName').value.trim();
            const lastName = document.getElementById('lastName').value.trim();
            const lrn = document.getElementById('lrn').value.trim();
            showDuplicateModal({
                isDuplicate: true,
                matchedByName: result.matchedByName,
                matchedByLRN: result.matchedByLRN,
                matches: [result.existing]
            }, firstName, lastName, lrn);
        } else {
            hideLoading();
            showStatus(result.error || 'Error saving data', 'info');
        }
    } catch (error) {
        hideLoading();
        showStatus('Error connecting to server', 'info');
    }
}

function setDriveNote(message, state) {
    const note = document.getElementById('driveNote');
    if (!note) return;
    note.textContent = message;
    note.className = `drive-note ${state || ''}`.trim();
}

async function pollUploadStatus(studentId, attempt = 0) {
    const maxAttempts = 60;
    try {
        const res = await fetch(`${API_URL}/api/students/${studentId}/status`);
        const data = await res.json();

        if (data.uploadStatus === 'uploaded') {
            setDriveNote('✓ Saved to Google Drive', 'ok');
            return;
        }
        if (data.uploadStatus === 'failed') {
            setDriveNote('⚠ Drive upload failed. Tap to retry.', 'fail');
            const note = document.getElementById('driveNote');
            note.style.cursor = 'pointer';
            note.onclick = () => resyncUpload(studentId);
            return;
        }
        if (attempt >= maxAttempts) {
            setDriveNote('Still uploading… check back shortly.', 'pending');
            return;
        }
    } catch (error) {
        if (attempt >= maxAttempts) {
            setDriveNote('Could not confirm upload status.', 'fail');
            return;
        }
    }

    setTimeout(() => pollUploadStatus(studentId, attempt + 1), 1500);
}

async function resyncUpload(studentId) {
    setDriveNote('Retrying upload…', 'pending');
    try {
        await fetch(`${API_URL}/api/students/${studentId}/resync`, { method: 'POST' });
    } catch (error) {
        // fall through to polling
    }
    pollUploadStatus(studentId);
}

function updateIDPreview(student) {
    const fullName = student.middleName 
        ? `${student.firstName} ${student.middleName} ${student.lastName}`
        : `${student.firstName} ${student.lastName}`;
    
    const formattedDate = new Date(student.birthday).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    document.getElementById('idName').textContent = fullName;
    document.getElementById('idSex').textContent = student.sex || '-';
    document.getElementById('idClass').textContent = student.section;
    document.getElementById('idLRN').textContent = student.lrn;
    document.getElementById('idBirthday').textContent = formattedDate;
    document.getElementById('idAddress').textContent = student.address;
    document.getElementById('idParent').textContent = student.parentName;
    document.getElementById('idContact').textContent = student.contactNumber;
    
    if (student.photoUrl) {
        document.getElementById('idPhoto').innerHTML = 
            `<img src="${student.photoUrl}" alt="Student Photo">`;
    }
}

async function saveToDrive() {
    showStatus('Saving to Google Drive...', 'info');
    
    setTimeout(() => {
        showStatus('Google Drive integration pending - add credentials to .env', 'info');
    }, 1000);
}

function showStatus(message, type) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = `status ${type}`;
    status.classList.remove('hidden');
}

function showLoading(text, subtext) {
    const overlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');
    const loadingSubtext = document.getElementById('loadingSubtext');
    
    if (text) loadingText.textContent = text;
    if (subtext) loadingSubtext.textContent = subtext;
    else loadingSubtext.textContent = 'Please wait';
    
    overlay.classList.remove('hidden');
    
    const submitBtn = document.querySelector('#studentForm button[type="submit"]');
    if (submitBtn) submitBtn.setAttribute('disabled', 'disabled');
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    overlay.classList.add('hidden');
    
    const submitBtn = document.querySelector('#studentForm button[type="submit"]');
    if (submitBtn) submitBtn.removeAttribute('disabled');
}

function getFileBaseName() {
    if (!currentStudentData) return '';
    return `${currentStudentData.lastName}_${currentStudentData.firstName}`;
}

function downloadAll() {
    downloadReceipt();
    setTimeout(() => downloadIDCard(), 500);
    setTimeout(() => downloadPhoto(), 1000);
    showStatus('Downloading all files...', 'valid');
}

function downloadPhoto() {
    if (!capturedPhotoData) {
        showStatus('No photo available', 'info');
        return;
    }
    const link = document.createElement('a');
    link.download = `${getFileBaseName()}_PIC.jpg`;
    link.href = capturedPhotoData;
    link.click();
    showStatus('✓ Photo downloaded', 'valid');
}

function downloadReceipt() {
    if (!currentStudentData || !capturedPhotoData) {
        showStatus('No data available for receipt', 'info');
        return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 700;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#f0f0f3';
    ctx.fillRect(0, 0, 400, 700);

    ctx.fillStyle = '#667eea';
    ctx.fillRect(0, 0, 400, 80);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('CABIAO SENIOR HIGH SCHOOL', 200, 35);

    ctx.font = '12px Arial';
    ctx.fillText('TEMPORARY ID', 200, 55);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(140, 100, 120, 150);
    ctx.strokeStyle = '#667eea';
    ctx.lineWidth = 2;
    ctx.strokeRect(140, 100, 120, 150);

    const img = new Image();
    img.onload = () => {
        ctx.drawImage(img, 145, 105, 110, 140);

        const fullName = currentStudentData.middleName
            ? `${currentStudentData.firstName} ${currentStudentData.middleName} ${currentStudentData.lastName}`
            : `${currentStudentData.firstName} ${currentStudentData.lastName}`;

        ctx.fillStyle = '#333333';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(fullName, 200, 280);

        ctx.font = '12px Arial';
        ctx.fillStyle = '#555555';
        ctx.fillText(`Section: ${currentStudentData.section}`, 200, 310);
        ctx.fillText(`LRN: ${currentStudentData.lrn}`, 200, 335);

        const formattedDate = new Date(currentStudentData.birthday).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        ctx.fillText(`Birthday: ${formattedDate}`, 200, 360);
        ctx.fillText(`Address: ${currentStudentData.address}`, 200, 385);
        ctx.fillText(`Parent: ${currentStudentData.parentName}`, 200, 410);
        ctx.fillText(`Contact: ${currentStudentData.contactNumber}`, 200, 435);

        ctx.strokeStyle = '#667eea';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(40, 460);
        ctx.lineTo(360, 460);
        ctx.stroke();

        ctx.fillStyle = '#667eea';
        ctx.font = 'bold 11px Arial';
        ctx.fillText('GENERATION DETAILS', 200, 480);

        ctx.fillStyle = '#555555';
        ctx.font = '10px Arial';
        ctx.fillText(`Generated on: ${new Date().toLocaleString()}`, 200, 500);
        ctx.fillText('This is a computer-generated ID.', 200, 515);

        const driveStatus = currentStudentData.driveUploaded ? 'Uploaded to Drive' : 'Pending upload';
        ctx.fillText(`Drive Status: ${driveStatus}`, 200, 530);

        ctx.fillStyle = '#667eea';
        ctx.fillRect(0, 620, 400, 80);

        ctx.fillStyle = '#ffffff';
        ctx.font = '10px Arial';
        ctx.fillText('CABIAO SENIOR HIGH SCHOOL', 200, 655);
        ctx.fillText('Cabiao, Nueva Ecija', 200, 670);

        const link = document.createElement('a');
        link.download = `${getFileBaseName()}_receipt.jpg`;
        link.href = canvas.toDataURL('image/jpeg', 0.92);
        link.click();
        showStatus('✓ Receipt downloaded', 'valid');
    };
    img.src = capturedPhotoData;
}

function downloadIDCard() {
    if (!currentStudentData || !capturedPhotoData) {
        showStatus('No data available for ID card', 'info');
        return;
    }
    
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 700;
    const ctx = canvas.getContext('2d');
    
    // Background
    ctx.fillStyle = '#f0f0f3';
    ctx.fillRect(0, 0, 400, 700);
    
    // Header
    ctx.fillStyle = '#667eea';
    ctx.fillRect(0, 0, 400, 80);
    
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('CABIAO SENIOR HIGH SCHOOL', 200, 35);
    
    ctx.font = '12px Arial';
    ctx.fillText('TEMPORARY ID', 200, 55);
    
    // Photo
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(140, 100, 120, 150);
    ctx.strokeStyle = '#667eea';
    ctx.lineWidth = 2;
    ctx.strokeRect(140, 100, 120, 150);
    
    // Draw photo
    const img = new Image();
    img.onload = () => {
        ctx.drawImage(img, 145, 105, 110, 140);
        
        // Name
        const fullName = currentStudentData.middleName 
            ? `${currentStudentData.firstName} ${currentStudentData.middleName} ${currentStudentData.lastName}`
            : `${currentStudentData.firstName} ${currentStudentData.lastName}`;
        
        ctx.fillStyle = '#333333';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(fullName, 200, 280);
        
        // Info
        ctx.font = '12px Arial';
        ctx.fillStyle = '#555555';
        ctx.fillText(`Section: ${currentStudentData.section}`, 200, 310);
        ctx.fillText(`LRN: ${currentStudentData.lrn}`, 200, 335);
        
        const formattedDate = new Date(currentStudentData.birthday).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        ctx.fillText(`Birthday: ${formattedDate}`, 200, 360);
        ctx.fillText(`Address: ${currentStudentData.address}`, 200, 385);
        ctx.fillText(`Parent: ${currentStudentData.parentName}`, 200, 410);
        ctx.fillText(`Contact: ${currentStudentData.contactNumber}`, 200, 435);
        
        // Generation Details divider
        ctx.strokeStyle = '#667eea';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(40, 460);
        ctx.lineTo(360, 460);
        ctx.stroke();
        
        ctx.fillStyle = '#667eea';
        ctx.font = 'bold 11px Arial';
        ctx.fillText('GENERATION DETAILS', 200, 480);
        
        ctx.fillStyle = '#555555';
        ctx.font = '10px Arial';
        ctx.fillText(`Generated on: ${new Date().toLocaleString()}`, 200, 500);
        ctx.fillText('This is a computer-generated ID.', 200, 515);
        
        const driveStatus = currentStudentData.driveUploaded ? 'Uploaded to Drive' : 'Pending upload';
        ctx.fillText(`Drive Status: ${driveStatus}`, 200, 530);
        
        // Footer
        ctx.fillStyle = '#667eea';
        ctx.fillRect(0, 620, 400, 80);
        
        ctx.fillStyle = '#ffffff';
        ctx.font = '10px Arial';
        ctx.fillText('CABIAO SENIOR HIGH SCHOOL', 200, 655);
        ctx.fillText('Cabiao, Nueva Ecija', 200, 670);
        
        // Download
        const link = document.createElement('a');
        link.download = `${getFileBaseName()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        showStatus('✓ ID card downloaded', 'valid');
    };
    img.src = capturedPhotoData;
}
