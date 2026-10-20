// Выгрузка в формат резервной копии Car Expenses (ce_db_backup_v_30.87_ГГГГММДД.db + preferences_backup_….xml),
// чтобы данные можно было восстановить в Car Expenses на Android через «Резервное копирование».
// База собирается в браузере библиотекой sql.js по схеме CE (версия БД 29).
// id из Car Expenses сохраняются (ce-p-4 → шаблон 4 и т.д.), новые записи получают номера после них.
import { CE_SCHEMA, CE_MENU, CE_MENU_COLUMNS, CE_DB_VERSION, CE_APP_VERSION } from './ce-template.js';
import { withConsumption } from './stats.js';

const PALETTE = ['#e5484d', '#f76b15', '#ffc53d', '#46a758', '#12a594', '#0090ff', '#3e63dd', '#8e4ec6',
  '#d6409f', '#978365', '#ad7f58', '#6f6e77', '#29a383', '#5b5bd6', '#e54666', '#a18072', '#2b9a66'];

const ymd = iso => iso ? Number(iso.replace(/-/g, '')) : 0;
const r2 = v => Math.round((Number(v) || 0) * 100) / 100;

// Раздаёт числовые id: берёт номер из id Car Expenses, если он есть, остальным — следующие свободные.
function numberer(list, fromId) {
  const map = new Map(), used = new Set();
  for (const r of list) { const n = fromId(r); if (n && !used.has(n)) { map.set(r.id, n); used.add(n); } }
  let next = Math.max(0, ...used) + 1;
  for (const r of list) if (!map.has(r.id)) { while (used.has(next)) next++; map.set(r.id, next); used.add(next); }
  return map;
}
const tail = re => r => { const m = String(r.id).match(re); return m ? Number(m[1]) : null; };

export function buildCeDb(SQL, data) {
  const { vehicles, fuelTypes, categories, works, refuels, expenses } = data;
  const db = new SQL.Database();
  try {
    for (const sql of CE_SCHEMA) db.run(sql);
    db.run(`PRAGMA user_version = ${CE_DB_VERSION}`);
    db.run("INSERT INTO android_metadata (locale) VALUES ('ru_RU')");
    const ins = (table, row) => {
      const cols = Object.keys(row);
      db.run(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map(c => row[c] ?? null));
    };
    for (const r of CE_MENU) ins('menu_table', Object.fromEntries(CE_MENU_COLUMNS.map((c, i) => [c, r[i]])));

    const vehId = numberer(vehicles, v => v.ceId || null);
    const fuelId = numberer(fuelTypes, tail(/^ce-f-(\d+)$/));
    const catId = numberer(categories, tail(/^ce-c-(\d+)$/));

    // Шаблоны: виды работ + «Прочее» для категорий, где есть расходы без вида работ.
    const fallbackPat = new Map();
    const patList = [...works];
    for (const e of expenses) {
      if ((e.workIds || []).some(id => works.find(w => w.id === id))) continue;
      const key = e.categoryId || '_none';
      if (!fallbackPat.has(key)) {
        const pid = `x-other-${key}`;
        fallbackPat.set(key, pid);
        patList.push({ id: pid, name: `Прочее${categories.find(c => c.id === e.categoryId) ? ` (${categories.find(c => c.id === e.categoryId).name})` : ''}`, categoryId: e.categoryId, remind: false });
      }
    }
    const patId = numberer(patList, w => w.ceId || tail(/^ce-p-(\d+)$/)(w));
    const defaultCat = categories.find(c => !c.income)?.id;

    for (const v of vehicles) {
      const pts = [...refuels.filter(r => r.vehicleId === v.id), ...expenses.filter(e => e.vehicleId === v.id && e.odo && !e.odoEstimated)]
        .sort((a, b) => (b.odo || 0) - (a.odo || 0));
      ins('veh_table', {
        _id: vehId.get(v.id), name: v.name, comment: v.comment || '', currency: 'руб.', order_currency: 1, tank_main: 2,
        tank_volume: v.tankVolume || 0, tank_volume_rest: 0, tank_volume_1: v.tankVolume || 0,
        veh_manufacturer: v.make || '', veh_model: v.model || '', veh_vin: v.vin || '',
        veh_birthday: /^\d{4}$/.test(v.year || '') ? Number(v.year + '0101') : 0,
        last_mileage: pts[0]?.odo || 0, last_date: ymd(pts[0]?.date),
      });
    }
    for (const f of fuelTypes) {
      const last = refuels.filter(r => r.fuelTypeId === f.id).sort((a, b) => b.date.localeCompare(a.date))[0];
      ins('fuel_table', { _id: fuelId.get(f.id), name: f.name, parse: (f.name.match(/\d{2,3}/) || [''])[0], tank_numb: 1, last_price: r2(last?.pricePerL), color: -16537100 });
    }
    for (const c of categories) {
      ins('cat_table', { _id: catId.get(c.id), name: c.name, comment: c.comment || '', expense_type: c.income ? 0 : 1,
        color: Math.max(0, PALETTE.indexOf(c.color)), stat_included: 1, fuel_includes: /топлив/i.test(c.name) ? 1 : 0 });
    }
    for (const w of patList) {
      const type = w.onceDate ? 5 : w.onceKm ? 4 : w.everyKm && w.everyMonths ? 3 : w.everyMonths ? 2 : w.everyKm ? 1 : 0;
      const cat = categories.find(c => c.id === w.categoryId);
      ins('pat_table', {
        _id: patId.get(w.id), name: w.name, comment: '', avatar: 0, id_category: catId.get(w.categoryId) || catId.get(defaultCat) || 0,
        period_type: type, period_mileage: w.everyKm || 0, period_month: w.everyMonths || 0,
        period_mileage_once: w.onceKm || 0, period_date_once: ymd(w.onceDate), event_show: w.remind && type ? 1 : 0,
        expense_when: 0, expense_type: cat?.income ? 0 : 1, id_vehicle: 0, fuel_includes: 0, period_from_first: 0, period_done: 0,
      });
    }

    // Расходы: id из Car Expenses (ce-e-Машина-N), если он свободен.
    const expId = numberer(expenses, tail(/-(\d+)$/));
    for (const e of [...expenses].sort((a, b) => expId.get(a.id) - expId.get(b.id))) {
      const wids = (e.workIds || []).filter(id => patId.has(id));
      if (!wids.length) wids.push(fallbackPat.get(e.categoryId || '_none'));
      const names = wids.map(id => patList.find(w => w.id === id)?.name).filter(Boolean);
      const kindTitle = names.join(' + ');
      const skip = new Set([kindTitle, e.kind, e.title, 'пробег оценочный', 'покупка запчасти'].filter(Boolean));
      const note = (e.note || '').split(/;\s*/).map(x => x.trim()).filter(x => x && !skip.has(x) && !/^запчасти [\d.,]+ \/ работа [\d.,]+$/.test(x)).join('; ');
      let part = r2(e.parts), work = r2(e.work);
      const total = r2(e.total);
      if (Math.abs(part + work - total) > 0.01) { if (part) work = r2(total - part); else part = total; }
      const id = expId.get(e.id);
      ins('exp_table', {
        _id: id, id_vehicle: vehId.get(e.vehicleId) || 1, date: ymd(e.date),
        mileage: e.odoEstimated ? 0 : (e.odo || 0), predicated_mileage: e.odoEstimated ? (e.odo || 0) : 0,
        name: e.title && !names.includes(e.title) && e.title !== kindTitle ? e.title : '', note,
        total_costpart: part, total_costwork: work,
      });
      wids.forEach((wid, i) => ins('exp_pat_table', { id_expense: id, id_pattern: patId.get(wid), costpart: i ? 0 : part, costwork: i ? 0 : work, note: '' }));
    }

    // Заправки: по машинам и пробегу; пробег между заправками и расход — как считает Car Expenses.
    for (const v of vehicles) {
      const list = refuels.filter(r => r.vehicleId === v.id).sort((a, b) => a.odo - b.odo || a.date.localeCompare(b.date));
      const cons = withConsumption(list);
      let prev = null;
      for (const r of list) {
        const add = prev ? Math.max(0, r.odo - prev.odo) : 0;
        const c = cons.get(r.id);
        ins('rec_table', {
          date: ymd(r.date), id_vehicle: vehId.get(v.id), note: r.note || '', mileage: r.odo,
          volume: r2(r.litres), volumecost: r2(r.pricePerL), cost: r2(r.total),
          type: fuelTypes.find(f => f.id === r.fuelTypeId)?.name || '', id_fueltype: fuelId.get(r.fuelTypeId) || 0,
          mark: r.full ? 10 : 0, mileageadd: add, current_tank: 0, used_tank: 0, tankvolume: -1,
          volumemileage: c ? c.l100 : 0, costmileage: c && add ? r.total / add : 0, volumemileage_1: 0, costmileage_1: 0,
          mil_coef: 1, missed: r.missed ? 1 : 0,
        });
        prev = r;
      }
    }
    return db.export();
  } finally {
    db.close();
  }
}

export function cePrefsXml(firstVehicleId = 1) {
  const s = (k, v) => `    <string name="${k}">${v}</string>`;
  const b = (k, v) => `    <boolean name="${k}" value="${v}" />`;
  return ["<?xml version='1.0' encoding='utf-8' standalone='yes' ?>", '<map>',
    s('sett_card_column_count_landscape_key', 0), s('sett_mileage_prediction', 1), b('sett_check_entered_data', true),
    s('sett_image_quality_key', 1), s('sett_card_column_count_portrait_key', 0), s('pref_selected_vehicle', firstVehicleId),
    b('sett_exp_to_predicate_mileage', true), b('pref_visible_exit_dialog', true), s('sett_calc_trip_cost', 0),
    b('sett_event_prediction_field', true), s('sett_reminder_calendar', '0;0;0;0;0;9;0;'), s('sett_reminder_popup', '0;0;0;0;0;9;0;'),
    s('sett_reminder_push', '0;0;0;0;0;9;0;'), b('pref_correct_menu_visibility', true), s('pref_color', 0),
    s('sett_dbx_linked', 'false'), s('sett_gdr_linked', 'false'), b('pref_refuels_bar_show', true), b('pref_refuels_trip_cost_show', true),
    s('sett_value_label_numbers_portrait_key', 16), s('sett_value_label_numbers_landscape_key', 32), s('pref_language', 0),
    s('sett_interface_add_button_key', 2), s('sett_calc_rest_period', 1), s('sett_first_run', 'false'), b('pref_animation', true),
    b('sett_show_consumption_true', false), s('pref_theme', 0), s('sett_backup_freq', 0), b('sett_autosubstitution', true),
    s('sett_last_version', CE_APP_VERSION), b('pref_profit_is_positive', false), '</map>', ''].join('\n');
}

export const ceBackupName = (ext, d = new Date()) =>
  `${ext === 'db' ? 'ce_db_backup' : 'preferences_backup'}_v_${CE_APP_VERSION}_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.${ext}`;
