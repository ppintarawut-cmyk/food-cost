// ที่เก็บข้อมูลในเครื่อง (ดู docs/decisions/0001) และไฟล์สำรอง
// ข้อมูลทั้งหมดอยู่ในก้อนเดียว เขียนทับทุกครั้งที่แก้ เพราะข้อมูลของร้านเดียวมีขนาดเล็ก

const DATA_KEY = 'foodcost.data.v1';
const API_KEY_KEY = 'foodcost.apiKey';
const BACKUP_KIND = 'food-cost-backup';
const SCHEMA_VERSION = 1;

export function emptyState() {
  return {
    version: SCHEMA_VERSION,
    settings: {
      gpGrab: 30,
      gpLineman: 30,
      vatOnGp: true,
      sundriesDefault: 5,
      lastBackupAt: null,
    },
    ingredients: [], // { id, name, unit: 'g' | 'ml' | 'pc' }
    purchases: [], // { id, date: 'YYYY-MM-DD', ingredientId, price, qty (หน่วยพื้นฐาน), createdAt }
    menus: [], // { id, name, prices: { store, grab, lineman }, lines: [...] }
    matches: {}, // matchKey(ชื่อบนใบเสร็จ) → { action: 'ingredient', ingredientId, qty } | { action: 'skip' }
  };
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** เติมช่องที่ขาดด้วยค่าเริ่มต้น เพื่อให้ข้อมูลเก่าหรือไฟล์สำรองเก่ายังเปิดได้ */
function normalize(raw) {
  const base = emptyState();
  return {
    version: SCHEMA_VERSION,
    settings: { ...base.settings, ...(raw.settings || {}) },
    ingredients: Array.isArray(raw.ingredients) ? raw.ingredients : [],
    purchases: Array.isArray(raw.purchases) ? raw.purchases : [],
    menus: Array.isArray(raw.menus) ? raw.menus : [],
    matches: raw.matches && typeof raw.matches === 'object' ? raw.matches : {},
  };
}

export function load(storage) {
  try {
    const text = storage.getItem(DATA_KEY);
    return text ? normalize(JSON.parse(text)) : emptyState();
  } catch {
    return emptyState();
  }
}

/** คืน true ถ้าบันทึกสำเร็จ */
export function save(storage, state) {
  try {
    storage.setItem(DATA_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function loadApiKey(storage) {
  try {
    return storage.getItem(API_KEY_KEY) || '';
  } catch {
    return '';
  }
}

export function saveApiKey(storage, key) {
  try {
    if (key) storage.setItem(API_KEY_KEY, key);
    else storage.removeItem(API_KEY_KEY);
    return true;
  } catch {
    return false;
  }
}

/** เนื้อไฟล์สำรอง: ข้อมูลทั้งหมด ยกเว้นคีย์ AI (เก็บแยกคนละที่อยู่แล้ว) */
export function makeBackup(state, now = new Date()) {
  return JSON.stringify({ kind: BACKUP_KIND, exportedAt: now.toISOString(), data: state });
}

export function backupFileName(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `food-cost-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/** อ่านไฟล์สำรอง ถ้าไม่ใช่ไฟล์ของโปรแกรมนี้จะโยน Error พร้อมข้อความภาษาไทย */
export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('ไฟล์นี้ไม่ใช่ไฟล์สำรองของโปรแกรม (อ่านไม่ออก)');
  }
  if (!parsed || parsed.kind !== BACKUP_KIND || !parsed.data) {
    throw new Error('ไฟล์นี้ไม่ใช่ไฟล์สำรองของโปรแกรม');
  }
  return normalize(parsed.data);
}

/** ควรเตือนให้สำรองไหม: มีข้อมูลแล้ว และไม่ได้สำรองเกิน 7 วัน */
export function backupOverdue(state, now = Date.now()) {
  const hasData = state.purchases.length > 0 || state.menus.length > 0;
  if (!hasData) return false;
  const last = state.settings.lastBackupAt;
  return !last || now - last > 7 * 24 * 60 * 60 * 1000;
}
