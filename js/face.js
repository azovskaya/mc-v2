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

  const tick = async () => {
    try {
      const hit = await detectFace(videoEl);
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

async function captureFrame(videoEl, maxW = 360, quality = 0.55) {
  if (!videoEl || videoEl.readyState < 2) return '';
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, maxW / videoEl.videoWidth);
  canvas.width = Math.round(videoEl.videoWidth * scale);
  canvas.height = Math.round(videoEl.videoHeight * scale);
  canvas.getContext('2d').drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

async function computeDescriptorFromVideo(videoEl) {
  const hit = await detectFace(videoEl);
  if (!hit || hit.tooFar) return null;
  return Array.from(hit.descriptor);
}
