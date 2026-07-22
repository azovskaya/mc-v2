/* Face recognition helpers for Meal Kiosk v2 */
const FACE = {
  REQUIRED_CONSECUTIVE: 3,
  FRAME_INTERVAL_MS: 550,
  DIST_OK: 0.45,
  DIST_BORDER: 0.55,
  MIN_DESCRIPTOR_VAR: 0.015,
  EAR_BLINK_THRESHOLD: 0.21,
  MIN_FACE_RATIO: 0.16
};

let _modelsReady = false;
let _stream = null;
let _scanTimer = null;
let _pending = { id: null, frames: [], ears: [] };

async function loadFaceModels(base = './models') {
  if (_modelsReady) return;
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(base),
    faceapi.nets.faceLandmark68Net.loadFromUri(base),
    faceapi.nets.faceRecognitionNet.loadFromUri(base)
  ]);
  _modelsReady = true;
}

async function startCamera(videoEl) {
  stopCamera(videoEl);
  _stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
  });
  videoEl.srcObject = _stream;
  await videoEl.play();
}

function stopCamera(videoEl) {
  stopFaceScan();
  if (_stream) {
    _stream.getTracks().forEach(t => t.stop());
    _stream = null;
  }
  if (videoEl) videoEl.srcObject = null;
}

function eyeAspectRatio(eye) {
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  return (d(eye[1], eye[5]) + d(eye[2], eye[4])) / (2 * d(eye[0], eye[3]));
}

function descriptorVariance(list) {
  if (list.length < 2) return 0;
  let sum = 0, n = 0;
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1], b = list[i];
    let s = 0;
    for (let j = 0; j < a.length; j++) {
      const d = a[j] - b[j];
      s += d * d;
    }
    sum += Math.sqrt(s / a.length);
    n++;
  }
  return n ? sum / n : 0;
}

async function detectFace(videoEl) {
  if (!videoEl || videoEl.readyState < 2) return null;
  const det = await faceapi
    .detectSingleFace(videoEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!det) return null;
  const box = det.detection.box;
  const ratio = box.width / videoEl.videoWidth;
  if (ratio < FACE.MIN_FACE_RATIO) return { tooFar: true };
  const left = det.landmarks.getLeftEye();
  const right = det.landmarks.getRightEye();
  const ear = (eyeAspectRatio(left) + eyeAspectRatio(right)) / 2;
  return { descriptor: det.descriptor, ear, box };
}

function buildMatcher(employees) {
  const labeled = [];
  for (const emp of employees) {
    const d = parseFaceDescriptor(emp.faceDescriptor);
    if (!d) continue;
    labeled.push(new faceapi.LabeledFaceDescriptors(String(emp.employeeId), [d]));
  }
  if (!labeled.length) return null;
  return new faceapi.FaceMatcher(labeled, FACE.DIST_BORDER);
}

/**
 * onStatus(text, kind)
 * onMatch({ employee, distance, liveness })
 */
function startFaceScan(videoEl, employees, { onStatus, onMatch }) {
  stopFaceScan();
  _pending = { id: null, frames: [], ears: [] };
  const matcher = buildMatcher(employees);
  if (!matcher) {
    onStatus?.('Нет сотрудников с Face ID. Добавьте в админке.', 'warn');
    return;
  }

  let busy = false;
  const tick = async () => {
    if (busy || !_scanTimer) return;
    busy = true;
    try {
      const hit = await detectFace(videoEl);
      if (!_scanTimer) return;
      if (!hit) {
        _pending = { id: null, frames: [], ears: [] };
        onStatus?.('Подойдите ближе к камере', '');
        return;
      }
      if (hit.tooFar) {
        onStatus?.('Подойдите ближе', 'warn');
        return;
      }

      const best = matcher.findBestMatch(hit.descriptor);
      if (best.label === 'unknown' || best.distance > FACE.DIST_BORDER) {
        _pending = { id: null, frames: [], ears: [] };
        onStatus?.('Лицо не распознано', 'warn');
        return;
      }

      const id = best.label;
      if (_pending.id !== id) {
        _pending = { id, frames: [hit.descriptor], ears: [hit.ear] };
        onStatus?.('Смотрите в камеру…', '');
        return;
      }

      _pending.frames.push(hit.descriptor);
      _pending.ears.push(hit.ear);
      if (_pending.frames.length > 6) {
        _pending.frames.shift();
        _pending.ears.shift();
      }

      if (_pending.frames.length < FACE.REQUIRED_CONSECUTIVE) {
        onStatus?.('Ещё секунду…', '');
        return;
      }

      if (best.distance > FACE.DIST_OK) {
        onStatus?.('Чуть ровнее к камере', 'warn');
        return;
      }

      // Liveness: моргнуть ИЛИ небольшое движение головой (анти-фото)
      const ears = _pending.ears;
      const blinked = ears.some((e, i) => i > 0 && ears[i - 1] > FACE.EAR_BLINK_THRESHOLD && e < FACE.EAR_BLINK_THRESHOLD);
      const motion = descriptorVariance(_pending.frames) >= FACE.MIN_DESCRIPTOR_VAR;
      if (!blinked && !motion) {
        onStatus?.('Моргните', 'warn');
        return;
      }

      const emp = employees.find(e => String(e.employeeId) === String(id));
      if (!emp) return;
      stopFaceScan();
      onMatch?.({ employee: emp, distance: best.distance, liveness: blinked ? 'blink' : 'motion' });
    } catch (err) {
      onStatus?.('Ошибка камеры', 'err');
      console.error(err);
    } finally {
      busy = false;
    }
  };

  _scanTimer = setInterval(tick, FACE.FRAME_INTERVAL_MS);
  tick();
}

function stopFaceScan() {
  if (_scanTimer) {
    clearInterval(_scanTimer);
    _scanTimer = null;
  }
}

async function waitForVideoReady(videoEl, timeoutMs = 5000) {
  if (!videoEl) return false;
  try { await videoEl.play(); } catch {}
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (videoEl.readyState >= 2 && videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
      return true;
    }
    await new Promise(r => setTimeout(r, 80));
  }
  return !!(videoEl.videoWidth > 0 && videoEl.videoHeight > 0);
}

function isValidPhotoDataUrl(url) {
  // Safari иногда отдаёт «data:,» или JPEG без полезной нагрузки
  return typeof url === 'string'
    && url.startsWith('data:image/')
    && url.length > 800
    && !url.endsWith('base64,');
}

async function captureFrame(videoEl, maxW = 360, quality = 0.55) {
  await waitForVideoReady(videoEl);
  if (!videoEl || !videoEl.videoWidth || !videoEl.videoHeight) return '';

  const scale = Math.min(1, maxW / videoEl.videoWidth);
  const w = Math.max(1, Math.round(videoEl.videoWidth * scale));
  const h = Math.max(1, Math.round(videoEl.videoHeight * scale));

  // Несколько попыток: Safari иногда отдаёт пустой кадр с первой попытки
  for (let attempt = 0; attempt < 6; attempt++) {
    try { await videoEl.play(); } catch {}

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return '';

    try {
      // createImageBitmap стабильнее на Safari, чем прямой drawImage
      if (typeof createImageBitmap === 'function') {
        const bmp = await createImageBitmap(videoEl);
        ctx.drawImage(bmp, 0, 0, w, h);
        if (bmp.close) bmp.close();
      } else {
        ctx.drawImage(videoEl, 0, 0, w, h);
      }
    } catch {
      try { ctx.drawImage(videoEl, 0, 0, w, h); } catch { /* next attempt */ }
    }

    let url = '';
    try {
      url = canvas.toDataURL('image/jpeg', quality);
    } catch {
      try { url = canvas.toDataURL('image/png'); } catch { url = ''; }
    }

    if (isValidPhotoDataUrl(url)) return url;

    // PNG как запасной вариант, если JPEG пустой
    try {
      url = canvas.toDataURL('image/png');
      if (isValidPhotoDataUrl(url)) return url;
    } catch {}

    await new Promise(r => setTimeout(r, 120));
  }
  return '';
}

/** Миниатюра из того же кадра — без второго снимка с камеры. */
function resizeDataUrl(dataUrl, maxW = 160, quality = 0.55) {
  return new Promise(resolve => {
    if (!isValidPhotoDataUrl(dataUrl)) {
      resolve('');
      return;
    }
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxW / img.naturalWidth);
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve('');
    img.src = dataUrl;
  });
}

async function computeDescriptorFromVideo(videoEl) {
  const hit = await detectFace(videoEl);
  if (!hit || hit.tooFar) return null;
  return Array.from(hit.descriptor);
}
