// Импорт из Car Expenses: текстового экспорта (CE v.30.x, разделы "### ... info" через табуляцию)
// и базы резервной копии (.db, см. ce-db.js) — оба приводятся к одной структуре и разбираются здесь.
// Записям даются стабильные id, поэтому повторный импорт не создаёт дублей.
import { normName } from './catalog.js';

const PALETTE = ['#e5484d', '#f76b15', '#ffc53d', '#46a758', '#12a594', '#0090ff', '#3e63dd', '#8e4ec6',
  '#d6409f', '#978365', '#ad7f58', '#6f6e77', '#29a383', '#5b5bd6', '#e54666', '#a18072', '#2b9a66'];

const num = s => {
  const t = String(s ?? '').trim().replace(/\s/g, '').replace(',', '.');
  const v = parseFloat(t);
  return Number.isFinite(v) ? v : 0;
};
const isoDate = yyyymmdd => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
const splitList = s => String(s ?? '').split(';').map(x => x.trim());

export function parseCeText(text) {
  const sections = {};
  let cur = null, header = null;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith('###')) {
      cur = raw.replace(/^###\s*/, '').trim();
      sections[cur] = [];
      header = null;
      continue;
    }
    if (!cur || !raw.trim()) continue;
    const cells = raw.split('\t').map(c => c.trim());
    if (!header) { header = cells; continue; }
    const row = {};
    header.forEach((h, i) => { if (!(h in row)) row[h] = cells[i] ?? ''; });
    sections[cur].push(row);
  }
  const pick = prefix => Object.entries(sections).filter(([k]) => k.startsWith(prefix)).flatMap(([, v]) => v);
  if (!Object.keys(sections).some(k => k.startsWith('CE v.'))) throw new Error('Это не похоже на экспорт Car Expenses');
  return {
    vehicles: pick('vehicle info'),
    fuelTypes: pick('fuel_type info'),
    categories: pick('category info'),
    patterns: pick('pattern info'),
    expenses: pick('expenses info'),
    records: pick('records info'),
  };
}

// Возвращает набор записей в формате приложения (без updatedAt — его ставит importInto).
export function ceToRecords(text) {
  return ceObjToRecords(parseCeText(text));
}

export function ceObjToRecords(ce) {
  const out = { vehicles: [], fuelTypes: [], categories: [], works: [], refuels: [], expenses: [] };

  const vehIdByName = {};
  for (const v of ce.vehicles) {
    const id = `ce-v-${v.name}`;
    vehIdByName[v.name] = id;
    out.vehicles.push({ id, ceId: num(v._id) || null, name: v.name, comment: v.comment || '', tankVolume: num(v.tank_volume) || null,
      make: v.veh_manufacturer || '', model: v.veh_model || '', vin: (v.veh_vin || '').toUpperCase(),
      year: v.veh_birthday && v.veh_birthday !== '0' ? String(v.veh_birthday).slice(0, 4) : '' });
  }
  const fuelName = {};
  for (const f of ce.fuelTypes) {
    fuelName[f._id] = f.name;
    out.fuelTypes.push({ id: `ce-f-${f._id}`, name: f.name });
  }
  const catById = {};
  for (const c of ce.categories) {
    catById[c._id] = c;
    out.categories.push({
      id: `ce-c-${c._id}`, name: c.name,
      color: PALETTE[num(c.color) % PALETTE.length],
      income: c.expense_type === '0',
    });
  }
  const patterns = Object.fromEntries(ce.patterns.map(p => [p._id, p]));

  // Шаблоны трат CE → виды работ. period_type: 0 — нет, 1 — км, 2 — месяцы, 3 — км и месяцы,
  // 4 — разово при пробеге, 5 — разово к дате.
  for (const p of ce.patterns) {
    const type = p.period_type;
    const km = Math.round(num(p.period_mileage)), months = num(p.period_month);
    const onceDate = /^\d{8}$/.test(p.period_date_once || '') && p.period_date_once !== '0' ? isoDate(p.period_date_once) : null;
    out.works.push({
      id: `ce-p-${p._id}`,
      ceId: num(p._id) || null,
      name: p.name,
      categoryId: catById[p.id_category] ? `ce-c-${p.id_category}` : null,
      everyKm: (type === '1' || type === '3') && km ? km : null,
      everyMonths: (type === '2' || type === '3') && months ? months : null,
      onceKm: type === '4' ? Math.round(num(p.period_mileage_once)) || null : null,
      onceDate: type === '5' ? onceDate : null,
      remind: p.event_show === '1' && ((type === '1' || type === '3') && km > 0 || (type === '2' || type === '3') && months > 0 || type === '4' || type === '5'),
    });
  }

  for (const r of ce.records) {
    const vid = vehIdByName[r.id_vehicle] || `ce-v-${r.id_vehicle}`;
    const litres = num(r.volume), price = num(r.volumecost);
    out.refuels.push({
      id: `ce-r-${r.id_vehicle}-${r.date}-${num(r.mileage)}`,
      vehicleId: vid,
      date: isoDate(r.date),
      odo: Math.round(num(r.mileage)),
      litres, pricePerL: price,
      total: num(r.cost) || Math.round(litres * price * 100) / 100,
      fuelTypeId: fuelName[r.id_fueltype] !== undefined ? `ce-f-${r.id_fueltype}` : null,
      full: r.mark === '10' || r.mark === '',
      missed: r.missed === '1',
      note: r.note || '',
    });
  }

  for (const e of ce.expenses) {
    const vid = vehIdByName[e.id_vehicle] || `ce-v-${e.id_vehicle}`;
    const pids = splitList(e.id_pattern).filter(p => patterns[p]);
    const names = pids.map(p => patterns[p].name);
    const catId = pids.length ? patterns[pids[0]].id_category : null;
    const parts = num(e.total_costpart), work = num(e.total_costwork);
    let total = parts + work;
    if (!total) total = [...splitList(e.costpart), ...splitList(e.costwork)].reduce((s, x) => s + num(x), 0);
    let odo = Math.round(num(e.mileage));
    const odoEstimated = odo === 0;
    if (odoEstimated) odo = Math.round(num(e.predicated_mileage));
    const extra = [e.name, e.note, ...splitList(e.comment)].filter(Boolean);
    const patternTitle = names.join(' + ');
    const title = (extra.length && names.length === 1) ? extra[0] : (patternTitle || 'Расход');
    const notes = [...new Set([...(title !== patternTitle ? [patternTitle] : []), ...extra].filter(x => x && x !== title))];
    out.expenses.push({
      id: `ce-e-${e.id_vehicle}-${e._id}`,
      vehicleId: vid,
      date: isoDate(e.date),
      odo: odo || null,
      odoEstimated,
      title,
      kind: patternTitle,
      workIds: pids.map(p => `ce-p-${p}`),
      categoryId: catId && catById[catId] ? `ce-c-${catId}` : null,
      parts, work,
      total: Math.round(total * 100) / 100,
      note: notes.join('; '),
    });
  }
  return out;
}

// Добавляет в базу записи, которых ещё нет. Удалённые пользователем не воскресают.
// Записи, импортированные прежней версией и ни разу не правленные (updatedAt < IMPORT_STAMP),
// обновляются — так к старым данным добавляются новые поля.
// Виды работ сопоставляются по названию: если такой уже есть (из справочника или прошлого импорта),
// используется он, а интервалы из Car Expenses переносятся в него, пока пользователь его не правил.
export const IMPORT_STAMP = 3;
export function importInto(db, recs) {
  const added = {}, updated = {};
  for (const k of Object.keys(recs)) { added[k] = 0; updated[k] = 0; }

  const alias = {};
  const scheduled = w => !!(w.everyKm || w.everyMonths || w.onceKm || w.onceDate);
  // одинаковые названия внутри импорта: оставляем вариант с интервалом
  const byName = new Map();
  for (const w of recs.works || []) {
    const n = normName(w.name);
    const prev = byName.get(n);
    if (!prev) byName.set(n, w);
    else if (!scheduled(prev) && scheduled(w)) { alias[prev.id] = w.id; byName.set(n, w); }
    else alias[w.id] = prev.id;
  }
  const works = [...byName.values()];
  for (const w of works) {
    if (db.works[w.id]) continue;
    const existing = Object.values(db.works).find(x => !x.deleted && x.id !== w.id && normName(x.name) === normName(w.name));
    if (!existing) continue;
    alias[w.id] = existing.id;
    for (const [from, to] of Object.entries(alias)) if (to === w.id) alias[from] = existing.id;
    if ((existing.updatedAt || 0) < IMPORT_STAMP) {
      db.works[existing.id] = { ...existing, ceId: existing.ceId || w.ceId, categoryId: w.categoryId || existing.categoryId, everyKm: w.everyKm, everyMonths: w.everyMonths,
        onceKm: w.onceKm, onceDate: w.onceDate, remind: w.remind, updatedAt: IMPORT_STAMP };
      updated.works++;
    } else if (!existing.ceId && w.ceId) {
      // номер шаблона из Car Expenses — служебное поле для обратной выгрузки, правку пользователя не трогаем
      db.works[existing.id] = { ...existing, ceId: w.ceId };
    }
  }
  const mapWork = id => alias[id] || id;
  const list = {
    ...recs,
    works: works.filter(w => !alias[w.id]),
    expenses: (recs.expenses || []).map(e => ({ ...e, workIds: [...new Set((e.workIds || []).map(mapWork))] })),
  };

  for (const [coll, items] of Object.entries(list)) {
    for (const r of items) {
      const cur = db[coll][r.id];
      if (!cur) { db[coll][r.id] = { ...r, updatedAt: IMPORT_STAMP }; added[coll]++; }
      else if (!cur.deleted && (cur.updatedAt || 0) < IMPORT_STAMP) { db[coll][r.id] = { ...cur, ...r, updatedAt: IMPORT_STAMP }; updated[coll]++; }
    }
  }
  return { added, updated };
}
