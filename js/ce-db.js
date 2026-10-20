// Импорт базы из резервной копии Car Expenses (ce_db_backup_*.db, SQLite).
// SQLite читается библиотекой sql.js, которая подгружается с CDN только при таком импорте.
// В базе сразу все машины и точные суммы по каждой работе.

const SQLJS = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.14.2/';

let sqlPromise = null;
export function loadSqlJs() {
  if (sqlPromise) return sqlPromise;
  sqlPromise = new Promise((resolve, reject) => {
    if (globalThis.initSqlJs) { resolve(globalThis.initSqlJs); return; }
    const s = document.createElement('script');
    s.src = SQLJS + 'sql-wasm.js';
    s.onload = () => resolve(globalThis.initSqlJs);
    s.onerror = () => reject(new Error('Не удалось загрузить модуль чтения базы — нужен интернет'));
    document.head.appendChild(s);
  }).then(init => init({ locateFile: f => SQLJS + f }))
    .catch(e => { sqlPromise = null; throw e; });
  return sqlPromise;
}

export function isSqlite(bytes) {
  const head = new TextDecoder().decode(bytes.slice(0, 15));
  return head === 'SQLite format 3';
}

const str = v => v == null ? '' : String(v);
const r2 = v => v == null ? '' : String(Math.round(Number(v) * 100) / 100);

// Приводит таблицы базы к той же структуре, что и текстовый экспорт (см. parseCeText).
export function ceDbToObj(SQL, bytes) {
  const db = new SQL.Database(bytes);
  try {
    const all = sql => {
      const res = db.exec(sql);
      if (!res.length) return [];
      const { columns, values } = res[0];
      return values.map(row => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
    };
    const tables = new Set(all("select name from sqlite_master where type='table'").map(r => r.name));
    for (const t of ['veh_table', 'exp_table', 'rec_table', 'pat_table', 'cat_table']) {
      if (!tables.has(t)) throw new Error('Это не база Car Expenses');
    }
    const veh = all('select * from veh_table');
    const vname = Object.fromEntries(veh.map(v => [v._id, v.name]));
    const items = new Map();
    for (const it of all('select * from exp_pat_table order by _id')) {
      if (!items.has(it.id_expense)) items.set(it.id_expense, []);
      items.get(it.id_expense).push(it);
    }
    return {
      vehicles: veh.map(v => ({ ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, str(x)])) })),
      fuelTypes: all('select * from fuel_table').map(f => ({ _id: str(f._id), name: str(f.name) })),
      categories: all('select * from cat_table').map(c => ({ _id: str(c._id), name: str(c.name), comment: str(c.comment), color: str(c.color), expense_type: str(c.expense_type) })),
      patterns: all('select * from pat_table').map(p => Object.fromEntries(Object.entries(p).map(([k, x]) => [k, str(x)]))),
      expenses: all('select * from exp_table').map(e => {
        const its = items.get(e._id) || [];
        return {
          _id: str(e._id), id_vehicle: vname[e.id_vehicle] ?? str(e.id_vehicle), date: str(e.date),
          mileage: str(e.mileage), predicated_mileage: str(e.predicated_mileage),
          name: str(e.name), note: str(e.note),
          id_pattern: its.map(i => i.id_pattern).join('; '),
          costpart: its.map(i => r2(i.costpart)).join('; '), costwork: its.map(i => r2(i.costwork)).join('; '),
          comment: its.map(i => str(i.note)).join('; '),
          total_costpart: r2(e.total_costpart), total_costwork: r2(e.total_costwork),
        };
      }),
      records: all('select * from rec_table').map(r => ({
        id_vehicle: vname[r.id_vehicle] ?? str(r.id_vehicle), date: str(r.date), note: str(r.note),
        mileage: str(r.mileage), volume: r2(r.volume), volumecost: r2(r.volumecost), cost: r2(r.cost),
        id_fueltype: str(r.id_fueltype), type: str(r.type), mark: str(r.mark), missed: str(r.missed),
      })),
    };
  } finally {
    db.close();
  }
}
