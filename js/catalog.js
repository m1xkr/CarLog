// Готовый справочник видов работ с рекомендуемыми интервалами.
// Названия совпадают с шаблонами Car Expenses, поэтому история после импорта ложится на них без дублей.
// Записи справочника получают стабильные id и метку updatedAt = SEED_STAMP: на разных устройствах
// они совпадают при синхронизации, а любая правка пользователя «новее» справочника.
import { alive } from './store.js';

export const SEED_STAMP = 2;

const CATS = {
  service: { name: 'Обслуживание', color: '#46a758', re: /основн|обслуж|^то$/i },
  repair: { name: 'Ремонт', color: '#e5484d', re: /незаплан|ремонт/i },
  upkeep: { name: 'Страховка, налоги, штрафы', color: '#0090ff', re: /содерж|страх|налог/i },
  road: { name: 'Парковка и дороги', color: '#f76b15', re: /парков|дорог|содерж/i },
  care: { name: 'Мойка и уход', color: '#12a594', re: /чистот|уход|мойк/i },
  tuning: { name: 'Аксессуары и тюнинг', color: '#8e4ec6', re: /аксесс|тюнинг/i },
};

// [ключ, название, категория, км, месяцев, напоминать]
const W = [
  ['oil', 'Моторное масло и фильтра (замена)', 'service', 7500, 12, true],
  ['air', 'Воздушный фильтр (замена)', 'service', 15000, null, true],
  ['cabin', 'Салонный фильтр (замена)', 'service', 15000, 12, true],
  ['fuelf', 'Топливный фильтр (замена)', 'service', 60000, null, true],
  ['plugs', 'Свечи зажигания (замена)', 'service', 45000, null, true],
  ['brakefl', 'Тормозная жидкость (замена)', 'service', 60000, 24, true],
  ['coolant', 'Антифриз (замена)', 'service', 100000, 60, true],
  ['gearoil', 'Масло в коробке передач (замена)', 'service', 60000, null, true],
  ['alt', 'Ремень генератора (замена)', 'service', 60000, null, true],
  ['timing', 'Ремень ГРМ и натяжные ролики (замена)', 'service', 90000, 60, true],
  ['brakes', 'Обслуживание тормозов', 'service', 40000, null, true],
  ['ac', 'Замена фреона', 'service', null, 24, false],
  ['padsf', 'Передние тормозные колодки (замена)', 'service', null, null, false],
  ['padsr', 'Задние тормозные колодки (замена)', 'service', null, null, false],
  ['discs', 'Тормозные диски (замена)', 'service', null, null, false],
  ['wipers', 'Щетки стеклоочистителя (замена)', 'service', null, 12, false],
  ['tyres', 'Сезонный шиномонтаж', 'service', null, null, false],
  ['align', 'Сход-развал', 'service', null, null, false],
  ['balance', 'Балансировка', 'service', null, null, false],
  ['chassis', 'Диагностика ходовой', 'service', null, null, false],
  ['diag', 'Диагностика', 'service', null, null, false],
  ['topup', 'Масло на доливку', 'service', null, null, false],
  ['washer', 'Незамерзающая жидкость', 'service', null, null, false],
  ['consum', 'Покупка (расходные материалы)', 'service', null, null, false],
  ['to', 'Плановое ТО', 'service', 15000, 12, false],
  ['breakdown', 'Замена (поломки)', 'repair', null, null, false],
  ['repparts', 'Ремонт (запчасти)', 'repair', null, null, false],
  ['tyrefix', 'Шиномонтаж (ремонт)', 'repair', null, null, false],
  ['shocks', 'Замена амортизаторов', 'repair', null, null, false],
  ['body', 'Рихтовка', 'repair', null, null, false],
  ['paint', 'Покраска', 'repair', null, null, false],
  ['osago', 'ОСАГО', 'upkeep', null, 12, true],
  ['kasko', 'КАСКО', 'upkeep', null, 12, false],
  ['inspect', 'Техосмотр', 'upkeep', null, 24, false],
  ['tax', 'Налог', 'upkeep', null, 12, false],
  ['fine', 'Штраф ГИБДД', 'upkeep', null, null, false],
  ['parking', 'Парковка', 'road', null, null, false],
  ['toll', 'Платная дорога', 'road', null, null, false],
  ['wash', 'Мойка (полная)', 'care', null, null, false],
  ['washout', 'Мойка (снаружи)', 'care', null, null, false],
  ['washin', 'Мойка (салон)', 'care', null, null, false],
  ['dryclean', 'Химчистка', 'care', null, null, false],
  ['buyparts', 'Покупка (запчасти)', 'tuning', null, null, false],
  ['accessory', 'Аксессуары', 'tuning', null, null, false],
];

export const normName = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();

export function findWorkByName(db, name) {
  const n = normName(name);
  if (!n) return null;
  return alive(db.works).find(w => normName(w.name) === n) || null;
}

function categoryFor(db, key) {
  const c = CATS[key];
  const cats = alive(db.categories);
  const hit = cats.find(x => normName(x.name) === normName(c.name)) || cats.find(x => c.re.test(x.name) && !x.income);
  if (hit) return hit.id;
  const id = `def-c-${key}`;
  if (!db.categories[id] || db.categories[id].deleted) db.categories[id] = { id, name: c.name, color: c.color, income: false, updatedAt: SEED_STAMP };
  return id;
}

// Добавляет недостающие виды работ из справочника. Возвращает число добавленных.
export function seedCatalog(db) {
  let n = 0;
  for (const [key, name, cat, km, months, remind] of W) {
    const id = `cat-w-${key}`;
    if (db.works[id]) continue;                  // уже есть (в т.ч. удалённая пользователем — не воскрешаем)
    if (findWorkByName(db, name)) continue;      // есть такая же из импорта
    db.works[id] = { id, name, categoryId: categoryFor(db, cat), everyKm: km, everyMonths: months, onceKm: null, onceDate: null, remind, updatedAt: SEED_STAMP };
    n++;
  }
  return n;
}

// Старые записи (импорт до появления видов работ) хранят названия работ в поле kind.
// Привязываем их к видам работ по названию, недостающие виды создаём без интервала.
export function linkLegacyExpenses(db, makeId) {
  let n = 0;
  for (const e of Object.values(db.expenses)) {
    if (e.deleted || Array.isArray(e.workIds) || !e.kind) continue;
    const ids = [];
    for (const name of e.kind.split(' + ').map(s => s.trim()).filter(Boolean)) {
      let w = findWorkByName(db, name);
      if (!w) {
        const id = makeId();
        w = db.works[id] = { id, name, categoryId: e.categoryId || null, everyKm: null, everyMonths: null, onceKm: null, onceDate: null, remind: false, updatedAt: Date.now() };
      }
      if (!ids.includes(w.id)) ids.push(w.id);
    }
    db.expenses[e.id] = { ...e, workIds: ids, updatedAt: Date.now() };
    n++;
  }
  return n;
}

// Частота видов работ в расходах — для списка «Частые работы».
export function workFrequency(expenses) {
  const m = new Map();
  for (const e of expenses) for (const id of e.workIds || []) {
    const cur = m.get(id) || { count: 0, last: '' };
    cur.count++; if (e.date > cur.last) cur.last = e.date;
    m.set(id, cur);
  }
  return m;
}

export const CATALOG_ORDER = W.map(w => `cat-w-${w[0]}`);

// Один вид работ — одна запись: при совпадении названий (например, справочник на одном устройстве
// и импорт из Car Expenses на другом) оставляем «главную», ссылки расходов переводим на неё.
export function dedupeWorks(db) {
  const groups = new Map();
  for (const w of alive(db.works)) {
    const n = normName(w.name);
    if (!groups.has(n)) groups.set(n, []);
    groups.get(n).push(w);
  }
  const score = w => (w.updatedAt > 3 ? 4 : 0) + (String(w.id).startsWith('ce-p-') ? 2 : 0) + ((w.everyKm || w.everyMonths || w.onceKm || w.onceDate) ? 1 : 0);
  const remap = {};
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => score(b) - score(a) || String(a.id).localeCompare(String(b.id)));
    for (const w of list.slice(1)) remap[w.id] = list[0].id;
  }
  const ids = Object.keys(remap);
  if (!ids.length) return 0;
  for (const id of ids) db.works[id] = { id, deleted: true, updatedAt: Date.now() };
  for (const e of Object.values(db.expenses)) {
    if (e.deleted || !e.workIds?.some(id => remap[id])) continue;
    db.expenses[e.id] = { ...e, workIds: [...new Set(e.workIds.map(id => remap[id] || id))], updatedAt: Date.now() };
  }
  return ids.length;
}

// Обслуживание базы после загрузки, слияния или импорта. Возвращает true, если что-то изменилось.
function clearEmptyReminders(db) {
  let n = 0;
  for (const w of Object.values(db.works)) {
    if (w.deleted || !w.remind || w.everyKm || w.everyMonths || w.onceKm || w.onceDate) continue;
    if ((w.updatedAt || 0) > 3) continue;   // правил пользователь — не трогаем
    db.works[w.id] = { ...w, remind: false };
    n++;
  }
  return n;
}

export function maintain(db, makeId) {
  clearEmptyReminders(db);
  const a = seedCatalog(db);
  const b = linkLegacyExpenses(db, makeId);
  const c = dedupeWorks(db);
  return a + b + c > 0;
}
