/* Shared utilities for Meal Kiosk v2 */
const STORAGE_KEY = 'mc_v2_local';
const APP_TZ = 'Asia/Almaty';

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
}

function saveLocal(patch) {
  const cur = { ...loadLocal(), ...patch };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cur));
  return cur;
}

/** URL из ?api= → localStorage → js/config.js (постоянный для всех устройств). */
function getConfiguredApiUrl() {
  return String(window.MC_CONFIG?.apiUrl || '').trim();
}

function getApiUrl() {
  const q = new URLSearchParams(location.search).get('api');
  if (q) {
    saveLocal({ apiUrl: q.trim() });
    return q.trim();
  }
  const saved = (loadLocal().apiUrl || '').trim();
  if (saved) return saved;
  return getConfiguredApiUrl();
}

function setApiUrl(url) {
  saveLocal({ apiUrl: String(url || '').trim() });
}

async function apiGet(action, params = {}) {
  const base = getApiUrl();
  if (!base) throw new Error('Сначала укажите URL сервера в настройках');
  const u = new URL(base);
  u.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  });
  const res = await fetch(u.toString(), { method: 'GET', cache: 'no-store' });
  if (!res.ok) throw new Error('Сеть: ' + res.status);
  return res.json();
}

async function apiPost(action, body) {
  const base = getApiUrl();
  if (!base) throw new Error('Сначала укажите URL сервера в настройках');
  const u = new URL(base);
  u.searchParams.set('action', action);
  const res = await fetch(u.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body || {})
  });
  if (!res.ok) throw new Error('Сеть: ' + res.status);
  return res.json();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function genId() {
  return crypto?.randomUUID?.() || ('id_' + Math.random().toString(36).slice(2) + Date.now());
}

function fmtMoney(n) {
  if (n === '' || n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸';
}

function todayInTz(tz = APP_TZ) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function parseFaceDescriptor(raw) {
  if (!raw) return null;
  if (Array.isArray(raw) && raw.length === 128) return new Float32Array(raw);
  try {
    const a = String(raw).split(',').map(Number);
    if (a.length === 128 && !a.some(Number.isNaN)) return new Float32Array(a);
  } catch {}
  return null;
}

function extractDriveId(url) {
  const s = String(url || '');
  const m = s.match(/\/d\/([a-zA-Z0-9_-]+)/) || s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : '';
}

function photoUrl(photo) {
  const s = String(photo || '').trim();
  if (!s) return '';
  if (s.startsWith('data:image')) return s;
  const id = extractDriveId(s);
  if (id) return `https://drive.google.com/thumbnail?id=${id}&sz=w400`;
  return s;
}
