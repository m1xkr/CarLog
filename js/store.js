// Хранилище данных: коллекции записей с id/updatedAt/deleted, сохранение в localStorage,
// слияние двух копий (локальной и облачной) по принципу «побеждает более свежая правка».

export const COLLECTIONS = ['vehicles', 'fuelTypes', 'categories', 'works', 'refuels', 'expenses'];
const DATA_KEY = 'carlog.data.v1';
const SETTINGS_KEY = 'carlog.settings.v1';

export function emptyDb() {
  const db = { version: 1 };
  for (const c of COLLECTIONS) db[c] = {};
  return db;
}

export function uid(prefix = 'x') {
  const rnd = (crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(2)) : [Math.random() * 2 ** 32, Date.now()]);
  return `${prefix}-${Date.now().toString(36)}-${rnd[0].toString(36)}${rnd[1].toString(36)}`;
}

export const now = () => Date.now();

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

export function loadDb() {
  const raw = safeGet(DATA_KEY);
  if (!raw) return emptyDb();
  try { return normalize(JSON.parse(raw)); } catch { return emptyDb(); }
}

export function saveDb(db) {
  return safeSet(DATA_KEY, JSON.stringify(db));
}

export function loadSettings() {
  try { return { ...defaultSettings(), ...JSON.parse(safeGet(SETTINGS_KEY) || '{}') }; }
  catch { return defaultSettings(); }
}
export function saveSettings(s) { safeSet(SETTINGS_KEY, JSON.stringify(s)); }

function defaultSettings() {
  return { vehicleId: null, yandexToken: null, yandexTokenExpires: null, yandexClientId: '', lastSync: null, lastSyncError: null };
}

export function normalize(db) {
  const out = emptyDb();
  if (!db || typeof db !== 'object') return out;
  for (const c of COLLECTIONS) {
    const src = db[c] || {};
    for (const [id, rec] of Object.entries(src)) {
      if (rec && typeof rec === 'object') out[c][id] = { ...rec, id };
    }
  }
  return out;
}

// Слияние: для каждой записи берём ту версию, у которой updatedAt больше.
export function mergeDb(a, b) {
  const out = emptyDb();
  for (const c of COLLECTIONS) {
    const ids = new Set([...Object.keys(a[c] || {}), ...Object.keys(b[c] || {})]);
    for (const id of ids) {
      const x = a[c]?.[id], y = b[c]?.[id];
      if (!x) out[c][id] = y;
      else if (!y) out[c][id] = x;
      else out[c][id] = (y.updatedAt || 0) > (x.updatedAt || 0) ? y : x;
    }
  }
  return out;
}

// Стабильная сериализация, чтобы понять, изменилось ли что-то после слияния.
export function fingerprint(db) {
  const parts = [];
  for (const c of COLLECTIONS) {
    const ids = Object.keys(db[c] || {}).sort();
    for (const id of ids) parts.push(c + ':' + id + ':' + (db[c][id].updatedAt || 0) + ':' + (db[c][id].deleted ? 1 : 0));
  }
  return parts.join('|');
}

export function alive(collection) {
  return Object.values(collection || {}).filter(r => !r.deleted);
}

export function upsert(db, collection, rec) {
  const id = rec.id || uid(collection.slice(0, 3));
  db[collection][id] = { ...db[collection][id], ...rec, id, updatedAt: now() };
  return db[collection][id];
}

export function remove(db, collection, id) {
  if (!db[collection][id]) return;
  db[collection][id] = { id, deleted: true, updatedAt: now() };
}
