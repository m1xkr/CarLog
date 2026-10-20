import { loadDb, saveDb, loadSettings, saveSettings, alive, upsert, remove, uid, mergeDb, normalize } from './store.js';
import { ceToRecords, importInto } from './ce-import.js';
import * as S from './stats.js';
import * as disk from './yadisk.js';
import { createSync } from './sync.js';
import { YANDEX_CLIENT_ID, APP_VERSION } from './config.js';

// ---------------------------------------------------------------- форматирование
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (v, d = 0) => (v == null || !Number.isFinite(v)) ? '—' : v.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
const money = (v, d = 0) => v == null ? '—' : `${nf(v, d)} ₽`;
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_IN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
const MON_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const fmtDate = iso => { const [y, m, d] = iso.split('-'); return `${+d} ${MON_SHORT[+m - 1]} ${y}`; };
const fmtDay = iso => { const [, m, d] = iso.split('-'); return `${+d} ${MON_SHORT[+m - 1]}`; };
const monthTitle = key => { const [y, m] = key.split('-'); return `${MONTHS[+m - 1]} ${y}`; };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const shiftDate = (iso, months) => { const d = new Date(iso + 'T12:00:00'); d.setMonth(d.getMonth() + months); return d.toISOString().slice(0, 10); };
const parseNum = v => { const x = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(x) ? x : null; };
const $ = sel => document.querySelector(sel);

// ---------------------------------------------------------------- состояние
const app = {
  db: loadDb(),
  settings: loadSettings(),
  tab: 'overview',
  expFilter: 'all',
  expQuery: '',
  statsPeriod: '12m',
  syncState: 'off',
  render: () => render(),
  setSyncState: (state, msg) => { app.syncState = state; app.syncMsg = msg; renderSync(); },
};
const sync = createSync(app);

function commit() {
  saveDb(app.db);
  render();
  sync.schedule();
}

function clientId() { return YANDEX_CLIENT_ID || app.settings.yandexClientId || ''; }

function vehicles() { return alive(app.db.vehicles).sort((a, b) => a.name.localeCompare(b.name, 'ru')); }
function currentVehicle() {
  const list = vehicles();
  return list.find(v => v.id === app.settings.vehicleId) || list[0] || null;
}
function data() {
  const v = currentVehicle();
  const cats = app.db.categories;
  const refuels = v ? alive(app.db.refuels).filter(r => r.vehicleId === v.id) : [];
  const expenses = v ? alive(app.db.expenses).filter(e => e.vehicleId === v.id)
    .map(e => ({ ...e, income: !!cats[e.categoryId]?.income })) : [];
  return { v, refuels, expenses };
}
const fuelName = id => app.db.fuelTypes[id]?.name || 'Топливо';

// ---------------------------------------------------------------- отрисовка
function render() {
  const v = currentVehicle();
  $('#vehicleName').textContent = v ? v.name : 'Бортжурнал';
  $('#vehicleBtn').classList.toggle('multi', vehicles().length > 1);
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === app.tab));
  const view = $('#view');
  const html = ({ overview: viewOverview, refuels: viewRefuels, expenses: viewExpenses, stats: viewStats, more: viewMore })[app.tab]();
  view.innerHTML = html;
  renderSync();
}

function renderSync() {
  const btn = $('#syncBtn'), t = $('#syncText');
  const s = app.settings;
  const state = !s.yandexToken && app.syncState !== 'error' ? 'off' : app.syncState;
  btn.dataset.state = state;
  t.textContent = state === 'busy' ? 'Синхронизация…'
    : state === 'error' ? 'Ошибка синхр.'
    : state === 'ok' ? `Диск · ${new Date(s.lastSync).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
    : s.yandexToken ? 'Яндекс Диск' : 'Без облака';
}

function welcome() {
  return `
    <div class="card hero" style="margin-top:8px">
      <div class="big" style="font-size:26px">Добро пожаловать</div>
      <p style="color:var(--muted);margin:8px 0 0">Учёт заправок и расходов на автомобиль. Перенесите историю из Car Expenses или начните с чистого листа.</p>
    </div>
    <div class="picker" style="margin-top:12px">
      <button class="btn primary block" data-act="import">Импорт из Car Expenses</button>
      <button class="btn block" data-act="new-vehicle">Добавить автомобиль вручную</button>
      ${app.settings.yandexToken ? '' : '<button class="btn soft block" data-act="go-more">Подключить Яндекс Диск</button>'}
    </div>
    <p class="note">Уже пользуетесь приложением на другом устройстве? Подключите Яндекс Диск во вкладке «Ещё» — данные подтянутся сами.</p>`;
}

function viewOverview() {
  const { v, refuels, expenses } = data();
  if (!v) return welcome();
  const t = today();
  const year = S.summary(refuels, expenses, { from: `${t.slice(0, 4)}-01-01`, to: t });
  const month = S.summary(refuels, expenses, { from: `${t.slice(0, 7)}-01`, to: t });
  const last12 = S.summary(refuels, expenses, { from: shiftDate(t, -12), to: t });
  const cons = S.withConsumption(refuels);
  const sorted = S.sortRefuels(refuels);
  const lastRef = sorted[sorted.length - 1];
  const lastCons = [...sorted].reverse().map(r => cons.get(r.id)).find(Boolean);
  const odo = S.lastOdo(refuels, expenses);

  const recent = [
    ...refuels.map(r => ({ kind: 'refuel', date: r.date, odo: r.odo, rec: r })),
    ...expenses.map(e => ({ kind: 'expense', date: e.date, odo: e.odo, rec: e })),
  ].sort((a, b) => b.date.localeCompare(a.date) || (b.odo || 0) - (a.odo || 0)).slice(0, 6);

  return `
    <div class="card hero">
      <div class="label">Пробег</div>
      <div class="big num">${nf(odo)}<small>км</small></div>
    </div>
    <div class="grid2">
      ${tile('Расход за 12 мес', nf(last12.avgL100, 1), 'л/100', lastCons ? `последний ${nf(lastCons.l100, 1)}` : '')}
      ${tile('1 км за 12 мес', nf(last12.costPerKm, 2), '₽', `топливо ${nf(last12.fuelPerKm, 2)} ₽`)}
      ${tile(`В ${MONTHS_IN[+t.slice(5, 7) - 1]}`, nf(month.total), '₽', `топливо ${nf(month.fuelCost)} ₽`)}
      ${tile(`За ${t.slice(0, 4)} год`, nf(year.total), '₽', `${nf(year.distance)} км`)}
    </div>
    <div class="actions">
      <button class="btn fuel" data-act="add-refuel">＋ Заправка</button>
      <button class="btn primary" data-act="add-expense">＋ Расход</button>
    </div>
    ${lastRef ? `<p class="note">Последняя заправка ${fmtDate(lastRef.date)}: ${nf(lastRef.litres, 2)} л по ${nf(lastRef.pricePerL, 2)} ₽</p>` : ''}
    <h2 class="section">Последние записи</h2>
    ${recent.length ? `<div class="list">${recent.map(x => x.kind === 'refuel' ? refuelRow(x.rec, cons, true) : expenseRow(x.rec, true)).join('')}</div>`
      : `<div class="empty">Записей пока нет</div>`}`;
}

const tile = (label, value, unit, sub = '') =>
  `<div class="tile"><div class="label">${esc(label)}</div><div class="value num">${value}${value !== '—' && unit ? `<small>${unit}</small>` : ''}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`;

function refuelRow(r, cons, withDate = false) {
  const c = cons.get(r.id);
  return `<button class="row" data-edit="refuel:${esc(r.id)}">
    <span class="ico" style="background:var(--fuel)">⛽</span>
    <span class="main"><span class="title">${esc(fuelName(r.fuelTypeId))}${r.full ? '' : ' · неполный'}</span>
      <span class="meta num">${fmtDay(r.date)} · ${nf(r.odo)} км · ${nf(r.litres, 2)} л × ${nf(r.pricePerL, 2)}</span></span>
    <span class="end"><span class="amount num">${money(r.total)}</span>
      ${c ? `<span class="badge num"><b>${nf(c.l100, 1)}</b> л/100</span>` : ''}</span>
  </button>`;
}

function expenseRow(e, withDate = false) {
  const cat = app.db.categories[e.categoryId];
  const color = cat?.color || '#8b8d98';
  const meta = [fmtDay(e.date), e.odo ? `${nf(e.odo)} км${e.odoEstimated ? '≈' : ''}` : null, cat?.name].filter(Boolean).join(' · ');
  return `<button class="row" data-edit="expense:${esc(e.id)}">
    <span class="ico" style="background:${esc(color)}">${esc((e.title || '?').trim().charAt(0).toUpperCase())}</span>
    <span class="main"><span class="title wrap">${esc(e.title)}</span><span class="meta num">${esc(meta)}</span></span>
    <span class="end"><span class="amount num ${e.income ? 'income' : ''}">${e.income ? '+' : ''}${money(e.total)}</span></span>
  </button>`;
}

function groupByMonth(items, rowFn, sumFn) {
  const groups = new Map();
  for (const it of items) {
    const k = it.date.slice(0, 7);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  return [...groups.entries()].map(([k, list]) => `
    <div class="month"><b>${monthTitle(k)}</b><span class="num">${sumFn(list)}</span></div>
    <div class="list">${list.map(rowFn).join('')}</div>`).join('');
}

function viewRefuels() {
  const { v, refuels } = data();
  if (!v) return welcome();
  const cons = S.withConsumption(refuels);
  const list = [...refuels].sort((a, b) => b.date.localeCompare(a.date) || b.odo - a.odo);
  const all = S.summary(refuels, []);
  return `
    <div class="actions" style="margin-top:0"><button class="btn fuel" data-act="add-refuel" style="grid-column:1/-1">＋ Заправка</button></div>
    <div class="grid2">
      ${tile('Средний расход', nf(all.avgL100, 2), 'л/100', `${all.refuelCount} заправок`)}
      ${tile('Средняя цена', nf(all.avgPrice, 2), '₽/л', `${nf(all.litres)} л всего`)}
    </div>
    ${list.length ? groupByMonth(list, r => refuelRow(r, cons), l => money(l.reduce((s, r) => s + r.total, 0)))
      : '<div class="empty">Заправок пока нет</div>'}`;
}

function expensesList(expenses) {
  const q = app.expQuery.trim().toLowerCase();
  const list = expenses
    .filter(e => app.expFilter === 'all' || e.categoryId === app.expFilter)
    .filter(e => !q || `${e.title} ${e.note} ${e.kind || ''}`.toLowerCase().includes(q))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.odo || 0) - (a.odo || 0));
  const total = list.filter(e => !e.income).reduce((s, e) => s + e.total, 0);
  return `<p class="note num">${list.length} записей · ${money(total)}</p>
    ${list.length ? groupByMonth(list, e => expenseRow(e), l => money(l.filter(e => !e.income).reduce((s, e) => s + e.total, 0)))
      : '<div class="empty">Ничего не найдено</div>'}`;
}

function viewExpenses() {
  const { v, expenses } = data();
  if (!v) return welcome();
  const usedCats = [...new Set(expenses.map(e => e.categoryId))]
    .map(id => ({ id, name: app.db.categories[id]?.name || 'Без категории', color: app.db.categories[id]?.color || '#8b8d98' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return `
    <div class="actions" style="margin-top:0"><button class="btn primary" data-act="add-expense" style="grid-column:1/-1">＋ Расход</button></div>
    <div style="height:12px"></div>
    <input class="search" id="expSearch" type="search" placeholder="Поиск: масло, колодки, мойка…" value="${esc(app.expQuery)}">
    <div class="chips">
      <button class="chip ${app.expFilter === 'all' ? 'active' : ''}" data-filter="all">Все</button>
      ${usedCats.map(c => `<button class="chip ${app.expFilter === c.id ? 'active' : ''}" data-filter="${esc(c.id)}"><i style="background:${esc(c.color)}"></i>${esc(c.name)}</button>`).join('')}
    </div>
    <div id="expList">${expensesList(expenses)}</div>`;
}

function viewStats() {
  const { v, refuels, expenses } = data();
  if (!v) return welcome();
  const t = today();
  const years = [...new Set([...refuels, ...expenses].map(r => r.date.slice(0, 4)))].sort().reverse();
  const p = app.statsPeriod;
  const range = p === '12m' ? { from: shiftDate(t, -12), to: t } : p === 'all' ? {} : { from: `${p}-01-01`, to: `${p}-12-31` };
  const sm = S.summary(refuels, expenses, range);
  const inR = r => (!range.from || r.date >= range.from) && (!range.to || r.date <= range.to);
  const cats = S.byCategory(expenses.filter(inR), app.db.categories);
  const catMax = cats.reduce((s, c) => s + c.total, 0) || 1;

  // столбики: по годам (всё время) или по месяцам (год / 12 мес)
  let bars;
  if (p === 'all') {
    bars = S.byYear(refuels, expenses).map(y => ({ label: y.year.slice(2), title: y.year, a: y.fuelCost, b: y.expCost }));
  } else {
    const start = p === '12m' ? shiftDate(t, -11).slice(0, 7) : `${p}-01`;
    bars = [];
    for (let i = 0; i < 12; i++) {
      const k = shiftDate(start + '-15', i).slice(0, 7);
      const f = refuels.filter(r => r.date.startsWith(k)).reduce((s, r) => s + r.total, 0);
      const e = expenses.filter(x => x.date.startsWith(k) && !x.income).reduce((s, x) => s + x.total, 0);
      bars.push({ label: MON_SHORT[+k.slice(5) - 1].slice(0, 3), title: monthTitle(k), a: f, b: e });
    }
  }
  const cons = S.withConsumption(refuels);
  const consPts = S.sortRefuels(refuels).filter(inR).map(r => ({ r, c: cons.get(r.id) })).filter(x => x.c);

  return `
    <div class="chips" style="margin-bottom:6px">
      <button class="chip ${p === '12m' ? 'active' : ''}" data-period="12m">12 месяцев</button>
      <button class="chip ${p === 'all' ? 'active' : ''}" data-period="all">Всё время</button>
      ${years.map(y => `<button class="chip ${p === y ? 'active' : ''}" data-period="${y}">${y}</button>`).join('')}
    </div>
    <div class="card hero">
      <div class="label">Всего потрачено</div>
      <div class="big num">${nf(sm.total)}<small>₽</small></div>
      <div class="label num" style="margin-top:4px">топливо ${money(sm.fuelCost)} · прочее ${money(sm.expCost)}${sm.income ? ` · доход ${money(sm.income)}` : ''}</div>
    </div>
    <div class="grid2">
      ${tile('Пробег', nf(sm.distance), 'км')}
      ${tile('Стоимость 1 км', nf(sm.costPerKm, 2), '₽', `топливо ${nf(sm.fuelPerKm, 2)} ₽`)}
      ${tile('Средний расход', nf(sm.avgL100, 2), 'л/100')}
      ${tile('Цена литра', nf(sm.avgPrice, 2), '₽', `${nf(sm.litres)} л`)}
    </div>

    <h2 class="section">${p === 'all' ? 'Расходы по годам' : 'Расходы по месяцам'}</h2>
    <div class="card pad">${barChart(bars)}
      <div class="legend"><span><i style="background:var(--fuel)"></i>Топливо</span><span><i style="background:var(--exp)"></i>Прочие расходы</span></div>
    </div>

    ${consPts.length > 1 ? `<h2 class="section">Расход топлива, л/100 км</h2>
    <div class="card pad">${lineChart(consPts.map(x => ({ x: x.r.date, y: x.c.l100 })), sm.avgL100)}
      <div class="legend"><span><i style="background:var(--accent)"></i>${consPts.length > 40 ? 'Среднее по 5 заправкам' : 'Между заправками'}</span><span><i style="background:var(--muted)"></i>Среднее ${nf(sm.avgL100, 2)}</span></div>
    </div>` : ''}

    <h2 class="section">По категориям</h2>
    <div class="card pad">${cats.length ? cats.map(c => `
      <div class="cat-row"><span>${esc(c.name)}</span><span class="num">${money(c.total)}<span class="pct">${nf(c.total / catMax * 100)}%</span></span>
        <span class="bar"><i style="width:${(c.total / catMax * 100).toFixed(1)}%;background:${esc(c.color)}"></i></span></div>`).join('')
      : '<div class="empty" style="padding:12px">Нет расходов за период</div>'}</div>

    ${p === 'all' ? `<h2 class="section">Сводка по годам</h2>
    <div class="card pad" style="overflow-x:auto"><table class="ytable num">
      <tr><th>Год</th><th>Км</th><th>Топливо</th><th>Прочее</th><th>л/100</th><th>₽/км</th></tr>
      ${S.byYear(refuels, expenses).reverse().map(y => `<tr><td>${y.year}</td><td>${nf(y.distance)}</td><td>${nf(y.fuelCost)}</td><td>${nf(y.expCost)}</td><td>${nf(y.avgL100, 1)}</td><td>${nf(y.costPerKm, 1)}</td></tr>`).join('')}
    </table></div>` : ''}`;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map(m => m * p).find(m => m >= v);
}
const short = v => v >= 1e6 ? `${nf(v / 1e6, 1)} млн` : v >= 1e3 ? `${nf(v / 1e3)} т` : nf(v);

function barChart(bars) {
  const W = 340, H = 170, L = 34, B = 18, T = 8;
  const max = niceMax(Math.max(...bars.map(b => b.a + b.b), 1));
  const bw = (W - L) / bars.length;
  const y = v => T + (H - T - B) * (1 - v / max);
  const grid = [0, .5, 1].map(f => `<line class="grid" x1="${L}" x2="${W}" y1="${y(max * f)}" y2="${y(max * f)}"/><text x="${L - 4}" y="${y(max * f) + 3}" text-anchor="end">${short(max * f)}</text>`).join('');
  const rects = bars.map((b, i) => {
    const x = L + i * bw + bw * .18, w = bw * .64;
    const ya = y(b.a), yb = y(b.a + b.b);
    return `<g><title>${esc(b.title)}: топливо ${money(b.a)}, прочее ${money(b.b)}</title>
      <rect x="${x}" y="${ya}" width="${w}" height="${Math.max(0, y(0) - ya)}" rx="2" fill="var(--fuel)"/>
      <rect x="${x}" y="${yb}" width="${w}" height="${Math.max(0, ya - yb)}" rx="2" fill="var(--exp)"/>
      <text x="${x + w / 2}" y="${H - 4}" text-anchor="middle">${esc(b.label)}</text></g>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${grid}${rects}</svg>`;
}

function lineChart(pts, avg) {
  const W = 340, H = 150, L = 30, B = 18, T = 8;
  const ys = pts.map(p => p.y);
  const lo = Math.floor(Math.min(...ys) - .5), hi = Math.ceil(Math.max(...ys) + .5);
  const t0 = Date.parse(pts[0].x), t1 = Date.parse(pts[pts.length - 1].x) || t0 + 1;
  const x = d => L + (W - L - 4) * ((Date.parse(d) - t0) / Math.max(1, t1 - t0));
  const y = v => T + (H - T - B) * (1 - (v - lo) / Math.max(1, hi - lo));
  const toPath = arr => arr.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
  // при большом числе точек показываем скользящее среднее по 5 заправкам, сырые данные — бледно
  const k = pts.length > 40 ? 5 : 1;
  const smooth = k === 1 ? pts : pts.map((p, i) => {
    const w = pts.slice(Math.max(0, i - k + 1), i + 1);
    return { x: p.x, y: w.reduce((s, q) => s + q.y, 0) / w.length };
  });
  const grid = [lo, (lo + hi) / 2, hi].map(v => `<line class="grid" x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${nf(v, 0)}</text>`).join('');
  const y0 = pts[0].x.slice(0, 4), y1 = pts[pts.length - 1].x.slice(0, 4);
  const labels = `<text x="${L}" y="${H - 4}">${fmtDate(pts[0].x).replace(/ \d{4}$/, '')} ${y0}</text><text x="${W}" y="${H - 4}" text-anchor="end">${fmtDate(pts[pts.length - 1].x).replace(/ \d{4}$/, '')} ${y1}</text>`;
  const dots = pts.length <= 40 ? pts.map(p => `<circle cx="${x(p.x)}" cy="${y(p.y)}" r="2.2" fill="var(--accent)"/>`).join('') : '';
  const avgLine = avg ? `<line x1="${L}" x2="${W}" y1="${y(avg)}" y2="${y(avg)}" stroke="var(--muted)" stroke-dasharray="4 3"/>` : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${grid}${avgLine}${k > 1 ? `<path d="${toPath(pts)}" fill="none" stroke="var(--accent)" stroke-opacity=".22" stroke-width="1"/>` : ''}<path d="${toPath(smooth)}" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linejoin="round"/>${dots}${labels}</svg>`;
}

function viewMore() {
  const s = app.settings;
  const v = currentVehicle();
  const cid = clientId();
  const connected = !!s.yandexToken;
  return `
    <h2 class="section" style="margin-top:8px">Яндекс Диск</h2>
    <div class="list">
      ${connected ? `
        <div class="set-row"><span>Подключён</span><span class="hint">${s.lastSync ? 'синхр. ' + new Date(s.lastSync).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'ещё не синхронизировано'}</span></div>
        ${s.lastSyncError ? `<div class="set-row"><span class="hint" style="color:var(--danger)">${esc(s.lastSyncError)}</span></div>` : ''}
        <button class="set-row accent" data-act="sync-now">Синхронизировать сейчас</button>
        <button class="set-row danger" data-act="ya-logout">Отключить Диск</button>`
      : `
        ${YANDEX_CLIENT_ID ? '' : `<div class="field"><label for="cid">ClientID</label><input id="cid" placeholder="из oauth.yandex.ru" value="${esc(s.yandexClientId)}" autocomplete="off" autocapitalize="off" spellcheck="false"></div>`}
        <button class="set-row accent" data-act="ya-login" ${cid || !YANDEX_CLIENT_ID ? '' : 'disabled'}>Войти через Яндекс</button>
        <button class="set-row" data-act="ya-manual"><span>Войти по коду</span><span class="hint">если вход не вернулся в приложение</span></button>`}
    </div>
    <p class="note">Данные хранятся в одном файле в папке «Приложения» на вашем Диске. Приложение видит только её. Синхронизация идёт при запуске и после каждой записи.</p>

    <h2 class="section">Данные</h2>
    <div class="list">
      <button class="set-row accent" data-act="import"><span>Импорт файла</span><span class="hint">Car Expenses или резервная копия</span></button>
      <button class="set-row" data-act="export-json"><span>Сохранить резервную копию</span><span class="go">›</span></button>
      <button class="set-row" data-act="export-csv"><span>Выгрузить таблицу (CSV)</span><span class="go">›</span></button>
    </div>

    <h2 class="section">Автомобиль</h2>
    <div class="list">
      ${vehicles().map(x => `<button class="set-row" data-vehicle="${esc(x.id)}"><span>${esc(x.name)}</span><span class="hint">${x.id === v?.id ? '✓ выбран' : 'выбрать'}</span></button>`).join('')}
      ${v ? '<button class="set-row" data-act="rename-vehicle">Переименовать текущий</button>' : ''}
      <button class="set-row accent" data-act="new-vehicle">Добавить автомобиль</button>
    </div>

    <h2 class="section">Установка на iPhone</h2>
    <div class="card pad" style="font-size:14px;color:var(--muted)">Откройте эту страницу в Safari → кнопка «Поделиться» → «На экран „Домой“». Приложение появится иконкой и будет работать без интернета.</div>
    <p class="note">Бортжурнал ${APP_VERSION} · записи хранятся на устройстве${connected ? ' и на Яндекс Диске' : ''}.</p>
    <input type="file" id="fileInput" accept=".csv,.json,.txt,text/plain,text/csv,application/json" hidden>`;
}

// ---------------------------------------------------------------- нижний лист с формой
function openSheet(title, body, { onSave, onDelete, saveLabel = 'Готово' } = {}) {
  const sheet = $('#sheet'), back = $('#sheetBackdrop');
  sheet.innerHTML = `<div class="grab"></div>
    <div class="sheet-head"><button class="cancel" data-sheet="close">Отмена</button><h3>${esc(title)}</h3>
      ${onSave ? `<button data-sheet="save">${saveLabel}</button>` : '<span style="width:56px"></span>'}</div>
    ${body}
    ${onDelete ? '<div class="form-gap"></div><button class="btn danger block" data-sheet="delete">Удалить запись</button>' : ''}`;
  back.hidden = false;
  document.body.style.overflow = 'hidden';
  sheet.onclick = e => {
    const a = e.target.closest('[data-sheet]')?.dataset.sheet;
    if (a === 'close') closeSheet();
    if (a === 'save' && onSave() !== false) closeSheet();
    if (a === 'delete' && confirm('Удалить запись?')) { onDelete(); closeSheet(); }
  };
  back.onclick = e => { if (e.target === back) closeSheet(); };
  return sheet;
}
function closeSheet() {
  $('#sheetBackdrop').hidden = true;
  $('#sheet').innerHTML = '';
  document.body.style.overflow = '';
}

const field = (label, input, unit = '', cls = '') =>
  `<div class="field ${cls}"><label>${label}</label>${input}${unit ? `<span class="unit">${unit}</span>` : ''}</div>`;
const numInput = (id, value, extra = '') =>
  `<input id="${id}" inputmode="decimal" autocomplete="off" value="${value == null ? '' : esc(String(value).replace('.', ','))}" ${extra}>`;

function optionList(collection, selected, addLabel) {
  const items = alive(app.db[collection]).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return items.map(x => `<option value="${esc(x.id)}" ${x.id === selected ? 'selected' : ''}>${esc(x.name)}</option>`).join('')
    + `<option value="__new">${addLabel}</option>`;
}

function handleNewOption(select, collection, promptText, extra = {}) {
  select.addEventListener('change', () => {
    if (select.value !== '__new') return;
    const name = (prompt(promptText) || '').trim();
    if (!name) { select.selectedIndex = 0; return; }
    const rec = upsert(app.db, collection, { id: uid(collection.slice(0, 3)), name, ...extra });
    saveDb(app.db);
    select.insertAdjacentHTML('afterbegin', `<option value="${esc(rec.id)}">${esc(rec.name)}</option>`);
    select.value = rec.id;
  });
}

function refuelForm(rec = null) {
  const { v, refuels } = data();
  if (!v) return toast('Сначала добавьте автомобиль');
  const sorted = S.sortRefuels(refuels);
  const last = sorted[sorted.length - 1];
  const r = rec || { date: today(), odo: null, litres: null, pricePerL: last?.pricePerL ?? null, total: null, fuelTypeId: last?.fuelTypeId ?? alive(app.db.fuelTypes)[0]?.id, full: true, missed: false, note: '' };
  const sheet = openSheet(rec ? 'Заправка' : 'Новая заправка', `
    <div class="form">
      ${field('Дата', `<input id="f-date" type="date" value="${esc(r.date)}">`)}
      ${field('Пробег', numInput('f-odo', r.odo, `inputmode="numeric" placeholder="${last ? nf(last.odo) : ''}"`), 'км')}
      ${field('Топливо', `<select id="f-fuel">${optionList('fuelTypes', r.fuelTypeId, '＋ Новый вид…')}</select>`)}
    </div>
    <div class="form-gap"></div>
    <div class="form">
      ${field('Литров', numInput('f-litres', r.litres, 'placeholder="0"'), 'л')}
      ${field('Цена за литр', numInput('f-price', r.pricePerL, 'placeholder="0"'), '₽')}
      ${field('Сумма', numInput('f-total', r.total, 'placeholder="0"'), '₽')}
    </div>
    <p class="form-hint">Заполните любые два поля — третье посчитается само.</p>
    <div class="form-gap"></div>
    <div class="form">
      ${field('Полный бак', `<input id="f-full" type="checkbox" ${r.full ? 'checked' : ''}>`)}
      ${field('Пропущена заправка до этой', `<input id="f-missed" type="checkbox" ${r.missed ? 'checked' : ''}>`)}
      <div class="field stack"><label>Заметка</label><textarea id="f-note" rows="2">${esc(r.note)}</textarea></div>
    </div>
    <p class="form-hint">${last && !rec ? `Предыдущая заправка: ${fmtDate(last.date)}, ${nf(last.odo)} км.` : ''} Расход считается между заправками до полного бака.</p>`,
  {
    onSave() {
      const odo = parseNum(sheet.querySelector('#f-odo').value);
      const litres = parseNum(sheet.querySelector('#f-litres').value);
      const price = parseNum(sheet.querySelector('#f-price').value);
      const total = parseNum(sheet.querySelector('#f-total').value);
      const fuel = sheet.querySelector('#f-fuel').value;
      if (!odo || odo <= 0) { toast('Укажите пробег'); return false; }
      if (!litres || litres <= 0) { toast('Укажите литры'); return false; }
      upsert(app.db, 'refuels', {
        ...(rec || {}), id: rec?.id, vehicleId: v.id,
        date: sheet.querySelector('#f-date').value || today(),
        odo: Math.round(odo), litres, pricePerL: price ?? (total && litres ? total / litres : 0),
        total: total ?? Math.round(litres * (price || 0) * 100) / 100,
        fuelTypeId: fuel === '__new' ? null : fuel,
        full: sheet.querySelector('#f-full').checked,
        missed: sheet.querySelector('#f-missed').checked,
        note: sheet.querySelector('#f-note').value.trim(),
      });
      commit();
      toast(rec ? 'Сохранено' : 'Заправка добавлена');
    },
    onDelete: rec ? () => { remove(app.db, 'refuels', rec.id); commit(); } : null,
  });
  handleNewOption(sheet.querySelector('#f-fuel'), 'fuelTypes', 'Название топлива, например «АИ-95 Лукойл»');

  // любые два из трёх полей → третье
  const ids = ['f-litres', 'f-price', 'f-total'];
  const order = rec ? ['f-litres', 'f-total'] : (r.pricePerL ? ['f-price'] : []);
  for (const id of ids) {
    sheet.querySelector('#' + id).addEventListener('input', () => {
      const i = order.indexOf(id); if (i >= 0) order.splice(i, 1);
      order.push(id); while (order.length > 2) order.shift();
      if (order.length < 2) return;
      const target = ids.find(x => !order.includes(x));
      const L = parseNum(sheet.querySelector('#f-litres').value), P = parseNum(sheet.querySelector('#f-price').value), T = parseNum(sheet.querySelector('#f-total').value);
      let val = null;
      if (target === 'f-total' && L != null && P != null) val = (L * P).toFixed(2);
      if (target === 'f-litres' && T != null && P) val = (T / P).toFixed(2);
      if (target === 'f-price' && T != null && L) val = (T / L).toFixed(2);
      if (val != null) sheet.querySelector('#' + target).value = val.replace('.', ',');
    });
  }
}

function expenseForm(rec = null) {
  const { v, refuels, expenses } = data();
  if (!v) return toast('Сначала добавьте автомобиль');
  const titles = [...new Set(expenses.flatMap(e => [e.title, e.kind]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  const lastCat = [...expenses].sort((a, b) => b.date.localeCompare(a.date))[0]?.categoryId;
  const e = rec || { date: today(), odo: S.lastOdo(refuels, expenses), title: '', categoryId: lastCat, total: null, parts: 0, work: 0, note: '' };
  const hasSplit = !!(e.parts && e.work);
  const sheet = openSheet(rec ? 'Расход' : 'Новый расход', `
    <div class="form">
      <div class="field stack"><label>Что сделано / куплено</label><input id="e-title" list="e-titles" value="${esc(e.title)}" placeholder="Замена масла, мойка, страховка…" style="text-align:left"></div>
      <datalist id="e-titles">${titles.map(t => `<option value="${esc(t)}">`).join('')}</datalist>
      ${field('Категория', `<select id="e-cat">${optionList('categories', e.categoryId, '＋ Новая категория…')}</select>`)}
      ${field('Дата', `<input id="e-date" type="date" value="${esc(e.date)}">`)}
      ${field('Пробег', numInput('e-odo', e.odo, 'inputmode="numeric"'), 'км')}
    </div>
    <div class="form-gap"></div>
    <div class="form">
      ${field('Сумма', numInput('e-total', e.total, 'placeholder="0"'), '₽', hasSplit ? 'calc' : '')}
      ${field('из них запчасти', numInput('e-parts', e.parts || null, 'placeholder="—"'), '₽')}
      ${field('из них работа', numInput('e-work', e.work || null, 'placeholder="—"'), '₽')}
    </div>
    <p class="form-hint">Разбивка необязательна. Если указать и запчасти, и работу, сумма посчитается сама.</p>
    <div class="form-gap"></div>
    <div class="form"><div class="field stack"><label>Заметка</label><textarea id="e-note" rows="3">${esc(e.note)}</textarea></div></div>
    ${rec?.odoEstimated ? '<p class="form-hint">Пробег у этой записи был оценочным (перенесён из Car Expenses).</p>' : ''}`,
  {
    onSave() {
      const title = sheet.querySelector('#e-title').value.trim();
      const parts = parseNum(sheet.querySelector('#e-parts').value) || 0;
      const work = parseNum(sheet.querySelector('#e-work').value) || 0;
      let total = parseNum(sheet.querySelector('#e-total').value);
      if (parts && work) total = parts + work;
      if (total == null) total = parts + work;
      if (!title) { toast('Укажите, на что расход'); return false; }
      if (!total) { toast('Укажите сумму'); return false; }
      const odo = parseNum(sheet.querySelector('#e-odo').value);
      const cat = sheet.querySelector('#e-cat').value;
      upsert(app.db, 'expenses', {
        ...(rec || {}), id: rec?.id, vehicleId: v.id, title,
        categoryId: cat === '__new' ? null : cat,
        date: sheet.querySelector('#e-date').value || today(),
        odo: odo ? Math.round(odo) : null,
        odoEstimated: rec && odo === rec.odo ? !!rec.odoEstimated : false,
        total: Math.round(total * 100) / 100, parts, work,
        note: sheet.querySelector('#e-note').value.trim(),
      });
      commit();
      toast(rec ? 'Сохранено' : 'Расход добавлен');
    },
    onDelete: rec ? () => { remove(app.db, 'expenses', rec.id); commit(); } : null,
  });
  handleNewOption(sheet.querySelector('#e-cat'), 'categories', 'Название категории', { color: '#8e4ec6', income: false });
  const recalc = () => {
    const p = parseNum(sheet.querySelector('#e-parts').value), w = parseNum(sheet.querySelector('#e-work').value);
    const tot = sheet.querySelector('#e-total');
    tot.closest('.field').classList.toggle('calc', !!(p && w));
    if (p && w) tot.value = String(Math.round((p + w) * 100) / 100).replace('.', ',');
  };
  sheet.querySelector('#e-parts').addEventListener('input', recalc);
  sheet.querySelector('#e-work').addEventListener('input', recalc);
}

function vehicleSheet() {
  const list = vehicles();
  const sheet = openSheet('Автомобиль', `<div class="list">${list.map(x =>
    `<button class="set-row" data-pick="${esc(x.id)}"><span>${esc(x.name)}</span><span class="hint">${x.id === currentVehicle()?.id ? '✓' : ''}</span></button>`).join('')}</div>`);
  sheet.addEventListener('click', e => {
    const id = e.target.closest('[data-pick]')?.dataset.pick;
    if (id) { app.settings.vehicleId = id; saveSettings(app.settings); closeSheet(); render(); }
  });
}

// ---------------------------------------------------------------- импорт / экспорт
async function importFile(file) {
  const text = await file.text();
  if (text.trimStart().startsWith('{')) {
    const incoming = normalize(JSON.parse(text));
    const n = Object.values(incoming.refuels).length + Object.values(incoming.expenses).length;
    if (!confirm(`Резервная копия: ${n} записей. Объединить с текущими данными?`)) return;
    app.db = mergeDb(app.db, incoming);
    commit();
    toast('Копия восстановлена');
    return;
  }
  const recs = ceToRecords(text);
  const msg = `Car Expenses: ${recs.vehicles.map(v => v.name).join(', ')}\n${recs.refuels.length} заправок, ${recs.expenses.length} расходов.\n\nИмпортировать? Уже перенесённые записи не задвоятся.`;
  if (!confirm(msg)) return;
  const added = importInto(app.db, recs);
  if (!app.settings.vehicleId && recs.vehicles[0]) { app.settings.vehicleId = recs.vehicles[0].id; saveSettings(app.settings); }
  app.tab = 'overview';
  commit();
  toast(`Добавлено: ${added.refuels} заправок, ${added.expenses} расходов`);
}

async function shareOrDownload(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  try {
    const file = new File([blob], name, { type: mime });
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e?.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function exportCsv() {
  const { v, refuels, expenses } = data();
  const n = x => x == null || x === '' ? '' : String(x).replace('.', ',');
  const q = s => /[;"\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : (s ?? '');
  const rows = [
    ...refuels.map(r => [r.date, 0, ['Заправка', r.odo, 'Топливо', fuelName(r.fuelTypeId), n(r.litres), n(r.pricePerL), '', '', n(r.total), r.note]]),
    ...expenses.map(e => [e.date, 1, [e.income ? 'Доход' : 'Расход', e.odo || '', app.db.categories[e.categoryId]?.name || '', e.title, '', '', n(e.parts || ''), n(e.work || ''), n(e.total), e.note]]),
  ].sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]);
  const lines = [['Дата', 'Тип', 'Пробег, км', 'Категория', 'Наименование', 'Литры', 'Цена за литр', 'Запчасти', 'Работа', 'Сумма', 'Примечание'].join(';'),
    ...rows.map(([d, , vals]) => [d.split('-').reverse().join('.'), ...vals].map(q).join(';'))];
  shareOrDownload(`${v?.name || 'car'}_записи_${today()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
}

// ---------------------------------------------------------------- события
document.addEventListener('click', async e => {
  const t = e.target;
  const tab = t.closest('.tabbar button')?.dataset.tab;
  if (tab) { app.tab = tab; render(); window.scrollTo(0, 0); return; }

  const edit = t.closest('[data-edit]')?.dataset.edit;
  if (edit) {
    const [kind, id] = edit.split(':');
    if (kind === 'refuel') refuelForm(app.db.refuels[id]);
    else expenseForm(app.db.expenses[id]);
    return;
  }
  const filter = t.closest('[data-filter]')?.dataset.filter;
  if (filter) { app.expFilter = filter; render(); return; }
  const period = t.closest('[data-period]')?.dataset.period;
  if (period) { app.statsPeriod = period; render(); return; }
  const veh = t.closest('[data-vehicle]')?.dataset.vehicle;
  if (veh) { app.settings.vehicleId = veh; saveSettings(app.settings); render(); return; }

  if (t.closest('#vehicleBtn')) { if (vehicles().length > 1) vehicleSheet(); return; }
  if (t.closest('#syncBtn')) {
    if (!app.settings.yandexToken) { app.tab = 'more'; render(); return; }
    await sync.run();
    if (app.syncState === 'error') toast(app.syncMsg || 'Ошибка синхронизации');
    else toast('Синхронизировано');
    return;
  }

  const act = t.closest('[data-act]')?.dataset.act;
  if (!act) return;
  switch (act) {
    case 'add-refuel': refuelForm(); break;
    case 'add-expense': expenseForm(); break;
    case 'go-more': app.tab = 'more'; render(); break;
    case 'import': {
      if (app.tab !== 'more') { app.tab = 'more'; render(); }
      $('#fileInput').click();
      break;
    }
    case 'export-json':
      shareOrDownload(`carlog_backup_${today()}.json`, JSON.stringify({ ...app.db, savedAt: new Date().toISOString() }), 'application/json');
      break;
    case 'export-csv': exportCsv(); break;
    case 'new-vehicle': {
      const name = (prompt('Название автомобиля') || '').trim();
      if (!name) return;
      const rec = upsert(app.db, 'vehicles', { id: uid('veh'), name, comment: '' });
      ensureDefaults();
      app.settings.vehicleId = rec.id; saveSettings(app.settings);
      commit();
      break;
    }
    case 'rename-vehicle': {
      const v = currentVehicle();
      const name = (prompt('Новое название', v.name) || '').trim();
      if (name) { upsert(app.db, 'vehicles', { ...v, name }); commit(); }
      break;
    }
    case 'ya-login': {
      const input = $('#cid');
      if (input) { app.settings.yandexClientId = input.value.trim(); saveSettings(app.settings); }
      if (!clientId()) { toast('Введите ClientID приложения из oauth.yandex.ru'); return; }
      location.href = disk.authUrl(clientId());
      break;
    }
    case 'ya-manual': {
      const input = $('#cid');
      if (input) { app.settings.yandexClientId = input.value.trim(); saveSettings(app.settings); }
      if (!clientId()) { toast('Введите ClientID приложения из oauth.yandex.ru'); return; }
      const sheet = openSheet('Вход по коду', `
        <div class="card pad" style="font-size:15px">
          1. Откройте ссылку и разрешите доступ.<br>2. Яндекс покажет код — скопируйте его.<br>3. Вставьте код ниже.
        </div>
        <div class="form-gap"></div>
        <a class="btn soft block" href="${esc(disk.authUrl(clientId(), true))}" target="_blank" rel="noopener">Открыть страницу Яндекса</a>
        <div class="form-gap"></div>
        <div class="form"><div class="field stack"><label>Код (токен)</label><input id="m-token" autocomplete="off" autocapitalize="off" spellcheck="false" style="text-align:left" placeholder="y0_…"></div></div>`,
      {
        saveLabel: 'Подключить',
        onSave() {
          const token = sheet.querySelector('#m-token').value.trim();
          if (!token) { toast('Вставьте код'); return false; }
          connectToken(token, null);
        },
      });
      break;
    }
    case 'ya-logout':
      if (confirm('Отключить Яндекс Диск? Данные на устройстве и на Диске останутся.')) {
        app.settings.yandexToken = null; app.settings.lastSync = null; app.settings.lastSyncError = null;
        saveSettings(app.settings); app.syncState = 'off'; render();
      }
      break;
    case 'sync-now':
      await sync.run();
      toast(app.syncState === 'error' ? (app.syncMsg || 'Ошибка') : 'Синхронизировано');
      render();
      break;
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'expSearch') {
    app.expQuery = e.target.value;
    $('#expList').innerHTML = expensesList(data().expenses);
  }
});

document.addEventListener('change', async e => {
  if (e.target.id === 'fileInput' && e.target.files[0]) {
    try { await importFile(e.target.files[0]); }
    catch (err) { toast(err.message || 'Не удалось прочитать файл'); }
    e.target.value = '';
  }
});

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

function ensureDefaults() {
  if (!alive(app.db.fuelTypes).length) ['АИ-92', 'АИ-95', 'АИ-98', 'ДТ'].forEach((name, i) => upsert(app.db, 'fuelTypes', { id: `def-f-${i}`, name }));
  if (!alive(app.db.categories).length) [
    ['Обслуживание', '#46a758'], ['Ремонт', '#e5484d'], ['Страховка и налоги', '#0090ff'], ['Мойка и уход', '#12a594'], ['Аксессуары', '#8e4ec6'], ['Парковка и дороги', '#f76b15'],
  ].forEach(([name, color], i) => upsert(app.db, 'categories', { id: `def-c-${i}`, name, color, income: false }));
}

async function connectToken(token, expires) {
  app.settings.yandexToken = token;
  app.settings.yandexTokenExpires = expires;
  saveSettings(app.settings);
  render();
  await sync.run();
  toast(app.syncState === 'error' ? (app.syncMsg || 'Ошибка синхронизации') : 'Яндекс Диск подключён');
}

// ---------------------------------------------------------------- запуск
const fromYa = disk.takeTokenFromHash();
render();
if (fromYa) connectToken(fromYa.token, fromYa.expires);
else sync.run();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { });
}
