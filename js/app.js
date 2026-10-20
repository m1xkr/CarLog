import { loadDb, saveDb, loadSettings, saveSettings, alive, upsert, remove, uid, mergeDb, normalize } from './store.js';
import { ceToRecords, ceObjToRecords, importInto } from './ce-import.js';
import * as S from './stats.js';
import * as disk from './yadisk.js';
import { createSync, provider } from './sync.js';
import * as gd from './gdrive.js';
import * as EV from './events.js';
import * as P from './parts.js';
import { buildReport, REPORT_CSS } from './report.js';
import { maintain, workFrequency, CATALOG_ORDER, normName } from './catalog.js';
import { loadSqlJs, isSqlite, ceDbToObj } from './ce-db.js';
import { YANDEX_CLIENT_ID, YANDEX_PROXY, GOOGLE_CLIENT_ID, APP_VERSION } from './config.js';

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
  eventsSeg: 'service',
  syncState: 'off',
  render: () => render(),
  setSyncState: (state, msg) => { app.syncState = state; app.syncMsg = msg; renderSync(); },
  afterMerge: db => maintain(db, () => uid('wrk')),
  reauth: () => googleSilentReauth(),
};
const sync = createSync(app);

function commit() {
  saveDb(app.db);
  render();
  sync.schedule();
}

function clientId() { return YANDEX_CLIENT_ID || app.settings.yandexClientId || ''; }
function googleClientId() { return GOOGLE_CLIENT_ID || app.settings.googleClientId || ''; }

// Тихое продление входа в Google: короткий переход на Google и обратно без вопросов.
// Не чаще раза в 2 минуты, не во время заполнения формы и не после неудачной попытки.
function googleSilentReauth() {
  const s = app.settings;
  if (s.syncProvider !== 'google' || !s.googleToken || s.googleNeedsLogin || !googleClientId()) return false;
  if (document.visibilityState !== 'visible' || !$('#sheetBackdrop').hidden || !$('#report').hidden) return false;
  if (Date.now() - (s.googleReauthAt || 0) < 120000) return false;
  s.googleReauthAt = Date.now(); saveSettings(s);
  location.href = gd.authUrl(googleClientId(), { silent: true, hint: s.googleEmail || '' });
  return true;
}
function googleLogin() {
  if (!googleClientId()) { toast('Не задан Client ID Google'); return; }
  location.href = gd.authUrl(googleClientId(), { hint: app.settings.googleEmail || '' });
}

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
  const works = alive(app.db.works);
  const parts = v ? alive(app.db.parts).filter(p => p.vehicleId === v.id) : [];
  return { v, refuels, expenses, works, parts };
}
function partsData() {
  const { v, refuels, expenses, parts } = data();
  const cur = EV.currentPosition([...refuels, ...expenses.filter(e => e.odo && !e.odoEstimated)]);
  const list = parts.map(part => ({ part, usage: P.partUsage(part, cur, today()) }));
  const rank = { installed: 0, new: 1, stored: 2, retired: 3 };
  list.sort((a, b) => rank[a.usage.status] - rank[b.usage.status] || (b.usage.wear ?? -1) - (a.usage.wear ?? -1));
  return { v, cur, list };
}
function eventsData() {
  const { v, refuels, expenses, works } = data();
  return { v, ...EV.computeEvents(works, expenses, refuels, today()) };
}
const fuelName = id => app.db.fuelTypes[id]?.name || 'Топливо';

// ---------------------------------------------------------------- отрисовка
function render() {
  const v = currentVehicle();
  $('#vehicleName').textContent = v ? v.name : 'Бортжурнал';
  $('#vehicleBtn').classList.toggle('multi', vehicles().length > 1);
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === app.tab));
  const view = $('#view');
  const html = ({ overview: viewOverview, events: viewEvents, refuels: viewRefuels, expenses: viewExpenses, stats: viewStats, more: viewMore })[app.tab]();
  view.innerHTML = html;
  const urgent = v ? eventsData().events.filter(e => e.status === 'overdue' || e.status === 'soon').length
    + partsData().list.filter(x => x.usage.status === 'installed' && x.usage.wear >= 0.9).length : 0;
  const badge = $('#eventsBadge');
  badge.textContent = urgent; badge.hidden = !urgent;
  $('#gearBtn').classList.toggle('active', app.tab === 'more');
  renderSync();
}

function renderSync() {
  const btn = $('#syncBtn'), t = $('#syncText');
  const s = app.settings;
  const p = provider(s);
  const name = p?.name === 'google' ? 'Google' : 'Яндекс';
  let state = !p && app.syncState !== 'error' ? 'off' : app.syncState;
  if (p?.name === 'google' && s.googleNeedsLogin) state = 'reauth';
  btn.dataset.state = state === 'reauth' ? 'error' : state;
  t.textContent = state === 'busy' ? 'Синхронизация…'
    : state === 'reauth' ? 'Войти в Google'
    : state === 'error' ? 'Ошибка синхр.'
    : state === 'ok' ? `${name} · ${new Date(s.lastSync).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
    : p ? `${name} Диск` : 'Без облака';
}

function welcome() {
  return `
    <div class="card hero" style="margin-top:8px">
      <div class="big" style="font-size:26px">Добро пожаловать</div>
      <p style="color:var(--muted);margin:8px 0 0">Учёт заправок и расходов на автомобиль. Перенесите историю из Car Expenses или начните с чистого листа.</p>
    </div>
    <div class="picker" style="margin-top:12px">
      <button class="btn primary block" data-act="import">Импорт из Car Expenses</button>
      <p class="note" style="margin:0 4px">Подойдёт резервная копия <b>ce_db_backup_….db</b> (сразу все машины) или экспорт в .csv.</p>
      <button class="btn block" data-act="new-vehicle">Добавить автомобиль вручную</button>
      ${provider(app.settings) ? '' : '<button class="btn soft block" data-act="go-more">Подключить облако для синхронизации</button>'}
    </div>
    <p class="note">Уже пользуетесь приложением на другом устройстве? Подключите то же облако в «⚙» — данные подтянутся сами.</p>`;
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
    ${overviewEvents()}
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
  const p = provider(s);
  const syncAt = s.lastSync ? 'синхр. ' + new Date(s.lastSync).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'ещё не синхронизировано';
  return `
    <h2 class="section" style="margin-top:8px">Синхронизация</h2>
    <div class="list">
      ${p ? `
        <div class="set-row"><span>${p.name === 'google' ? 'Google Диск' : 'Яндекс Диск'}${p.name === 'google' && s.googleEmail ? `<br><span class="hint">${esc(s.googleEmail)}</span>` : ''}</span><span class="hint">${syncAt}</span></div>
        ${s.lastSyncError ? `<div class="set-row"><span class="hint" style="color:var(--danger)">${esc(s.lastSyncError)}</span></div>` : ''}
        ${p.name === 'google' && (s.googleNeedsLogin || p.expired) ? '<button class="set-row accent" data-act="g-login">Войти в Google снова</button>' : ''}
        <button class="set-row accent" data-act="sync-now">Синхронизировать сейчас</button>
        ${p.name === 'yandex' ? '<button class="set-row" data-act="ya-check"><span>Проверить связь с Диском</span><span class="go">›</span></button>' : ''}
        <button class="set-row danger" data-act="${p.name === 'google' ? 'g-logout' : 'ya-logout'}">Отключить</button>`
      : `
        ${GOOGLE_CLIENT_ID ? '' : `<div class="field"><label for="gcid">Google Client ID</label><input id="gcid" placeholder="….apps.googleusercontent.com" value="${esc(s.googleClientId || '')}" autocomplete="off" autocapitalize="off" spellcheck="false"></div>`}
        <button class="set-row accent" data-act="g-connect"><span>Войти через Google</span><span class="hint">Google Диск</span></button>
        <button class="set-row" data-act="ya-login"><span>Войти через Яндекс</span><span class="hint">может понадобиться прокси</span></button>`}
    </div>
    ${p?.name === 'yandex' ? `<div class="list" style="margin-top:10px">
      <div class="field stack"><label>Прокси (если Диск недоступен из браузера)</label>
        <input id="proxyUrl" value="${esc(s.yandexProxy || '')}" placeholder="${esc(YANDEX_PROXY || 'https://functions.yandexcloud.net/…')}" autocomplete="off" autocapitalize="off" spellcheck="false" style="text-align:left"></div>
      <button class="set-row accent" data-act="proxy-save">Сохранить прокси</button></div>` : ''}
    <p class="note">Данные хранятся в одном файле в скрытой папке приложения на вашем ${p?.name === 'yandex' ? 'Яндекс' : 'Google'} Диске — приложение видит только её. Синхронизация идёт при запуске и после каждой записи.${p?.name === 'google' ? ' Google выдаёт вход на час, дальше приложение продлевает его само коротким переходом на Google.' : ''}</p>

    <h2 class="section">Данные</h2>
    <div class="list">
      <button class="set-row accent" data-act="import"><span>Импорт файла</span><span class="hint">Car Expenses (.db, .csv) или копия</span></button>
      <button class="set-row" data-act="export-json"><span>Сохранить резервную копию</span><span class="go">›</span></button>
      <button class="set-row" data-act="export-csv"><span>Выгрузить таблицу (CSV)</span><span class="go">›</span></button>
      <button class="set-row accent" data-act="report"><span>Отчёт по обслуживанию для продажи</span><span class="go">›</span></button>
    </div>

    <h2 class="section">Автомобиль</h2>
    <div class="list">
      ${vehicles().map(x => `<button class="set-row" data-vehicle="${esc(x.id)}"><span>${esc(x.name)}</span><span class="hint">${x.id === v?.id ? '✓ выбран' : 'выбрать'}</span></button>`).join('')}
      ${v ? '<button class="set-row" data-act="vehicle-details"><span>Данные автомобиля</span><span class="hint">марка, год, VIN</span></button>' : ''}
      <button class="set-row accent" data-act="new-vehicle">Добавить автомобиль</button>
    </div>

    <h2 class="section">Установка на iPhone</h2>
    <div class="card pad" style="font-size:14px;color:var(--muted)">Откройте эту страницу в Safari → кнопка «Поделиться» → «На экран „Домой“». Приложение появится иконкой и будет работать без интернета.</div>
    <p class="note">Бортжурнал ${APP_VERSION} · записи хранятся на устройстве${p ? (p.name === 'google' ? ' и на Google Диске' : ' и на Яндекс Диске') : ''}.</p>
    <input type="file" id="fileInput" hidden>`;
}

// ---------------------------------------------------------------- нижний лист с формой
function openSheet(title, body, { onSave, onDelete, saveLabel = 'Готово' } = {}) {
  // свежий элемент на каждое открытие, чтобы не копились обработчики от прошлых листов
  const old = $('#sheet'), sheet = old.cloneNode(false), back = $('#sheetBackdrop');
  old.replaceWith(sheet);
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

function workLabel(w) {
  const parts = [];
  if (w.everyKm) parts.push(`${nf(w.everyKm)} км`);
  if (w.everyMonths) parts.push(monthsLabel(w.everyMonths));
  if (w.onceKm) parts.push(`разово на ${nf(w.onceKm)} км`);
  if (w.onceDate) parts.push(`разово ${fmtDate(w.onceDate)}`);
  return parts.join(' / ');
}
function monthsLabel(m) {
  if (m % 12 === 0) { const y = m / 12; return `${y} ${plural(y, 'год', 'года', 'лет')}`; }
  return `${nf(m, m % 1 ? 1 : 0)} мес`;
}
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

function expenseForm(rec = null, preset = {}) {
  const { v, refuels, expenses } = data();
  if (!v) return toast('Сначала добавьте автомобиль');
  const titles = [...new Set(expenses.flatMap(e => [e.title, e.kind]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  const lastCat = [...expenses].sort((a, b) => b.date.localeCompare(a.date))[0]?.categoryId;
  const e = rec || { date: today(), odo: S.lastOdo(refuels, expenses), title: preset.title || '', categoryId: preset.categoryId || lastCat, total: null, parts: 0, work: 0, note: '', workIds: preset.workIds || [] };
  const selected = [...(e.workIds || [])];
  let catTouched = !!rec;
  const hasSplit = !!(e.parts && e.work);
  const sheet = openSheet(rec ? 'Расход' : 'Новый расход', `
    <div class="form">
      <div class="field stack"><label>Работы — по ним продлеваются события ТО</label>
        <div class="wchips" id="e-works"></div>
        <div class="wsuggest" id="e-suggest"></div>
        <button type="button" class="wmore" id="e-allbtn">Все работы…</button>
        <div class="wall" id="e-all" hidden>
          <input class="search" id="e-wsearch" type="search" placeholder="Найти работу" autocomplete="off">
          <div id="e-wlist"></div>
        </div>
      </div>
      <div class="field stack"><label>Описание</label><input id="e-title" list="e-titles" value="${esc(e.title)}" placeholder="Замена масла, мойка, страховка…" style="text-align:left"></div>
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
      let title = sheet.querySelector('#e-title').value.trim();
      const parts = parseNum(sheet.querySelector('#e-parts').value) || 0;
      const work = parseNum(sheet.querySelector('#e-work').value) || 0;
      let total = parseNum(sheet.querySelector('#e-total').value);
      if (parts && work) total = parts + work;
      if (total == null) total = parts + work;
      if (!title && selected.length) title = selected.map(id => app.db.works[id]?.name).filter(Boolean).join(' + ');
      if (!title) { toast('Укажите вид работ или описание'); return false; }
      if (total == null || total < 0) { toast('Укажите сумму'); return false; }
      const odo = parseNum(sheet.querySelector('#e-odo').value);
      const cat = sheet.querySelector('#e-cat').value;
      upsert(app.db, 'expenses', {
        ...(rec || {}), id: rec?.id, vehicleId: v.id, title,
        workIds: [...selected],
        kind: selected.map(id => app.db.works[id]?.name).filter(Boolean).join(' + ') || rec?.kind || '',
        categoryId: cat === '__new' ? null : cat,
        date: sheet.querySelector('#e-date').value || today(),
        odo: odo ? Math.round(odo) : null,
        odoEstimated: rec && odo === rec.odo ? !!rec.odoEstimated : false,
        total: Math.round(total * 100) / 100, parts, work,
        note: sheet.querySelector('#e-note').value.trim(),
      });
      commit();
      const extended = selected.map(id => app.db.works[id]).filter(w => w?.remind && (w.everyKm || w.everyMonths));
      toast(extended.length ? `Сохранено. Продлено событий: ${extended.length}` : (rec ? 'Сохранено' : 'Расход добавлен'));
    },
    onDelete: rec ? () => { remove(app.db, 'expenses', rec.id); commit(); } : null,
  });
  handleNewOption(sheet.querySelector('#e-cat'), 'categories', 'Название категории', { color: '#8e4ec6', income: false });
  sheet.querySelector('#e-cat').addEventListener('change', () => { catTouched = true; });

  const chipsEl = sheet.querySelector('#e-works'), sugEl = sheet.querySelector('#e-suggest');
  const allEl = sheet.querySelector('#e-all'), listEl = sheet.querySelector('#e-wlist'), searchEl = sheet.querySelector('#e-wsearch');
  const freq = workFrequency(expenses);
  const allWorks = () => alive(app.db.works);
  // частые работы этой машины, дополненные популярными из справочника
  const suggestions = () => {
    const byFreq = allWorks().filter(w => freq.has(w.id))
      .sort((a, b) => freq.get(b.id).count - freq.get(a.id).count || freq.get(b.id).last.localeCompare(freq.get(a.id).last));
    const extra = CATALOG_ORDER.map(id => app.db.works[id]).filter(w => w && !w.deleted && !freq.has(w.id) && w.remind);
    return [...byFreq, ...extra].filter(w => !selected.includes(w.id)).slice(0, 12);
  };
  const pick = id => {
    if (selected.includes(id)) { selected.splice(selected.indexOf(id), 1); renderWorks(); return; }
    selected.push(id);
    const w = app.db.works[id];
    const titleEl = sheet.querySelector('#e-title');
    if (!titleEl.value.trim() && selected.length === 1) titleEl.value = w.name;
    if (!catTouched && w.categoryId && selected.length === 1) sheet.querySelector('#e-cat').value = w.categoryId;
    renderWorks();
  };
  const renderList = () => {
    const q = normName(searchEl.value);
    const items = allWorks().filter(w => !q || normName(w.name).includes(q));
    const groups = new Map();
    for (const w of items) {
      const k = w.categoryId || '_none';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(w);
    }
    const exact = items.some(w => normName(w.name) === q);
    listEl.innerHTML = sortGroups(groups, freq)
      .map(([cid, ws]) => `<div class="wgroup">${esc(app.db.categories[cid]?.name || 'Без категории')}</div>`
        + ws.sort((a, b) => (freq.get(b.id)?.count || 0) - (freq.get(a.id)?.count || 0) || a.name.localeCompare(b.name, 'ru'))
          .map(w => `<button type="button" class="wopt ${selected.includes(w.id) ? 'on' : ''}" data-wpick="${esc(w.id)}">
            <span>${esc(w.name)}</span><span class="wmeta">${freq.get(w.id) ? `×${freq.get(w.id).count}` : ''}${w.remind && workLabel(w) ? ` · ${esc(workLabel(w))}` : ''}</span></button>`).join('')).join('')
      + (q && !exact ? `<button type="button" class="wopt add" data-wnew="1">＋ Новая работа «${esc(searchEl.value.trim())}»</button>` : '')
      + (!items.length && !q ? '<div class="hint">Список пуст</div>' : '');
  };
  const renderWorks = () => {
    chipsEl.innerHTML = selected.map(id => `<span class="wchip">${esc(app.db.works[id]?.name || '?')}<button type="button" data-rmwork="${esc(id)}" aria-label="Убрать">✕</button></span>`).join('');
    chipsEl.hidden = !selected.length;
    sugEl.innerHTML = suggestions().map(w => `<button type="button" class="wsug" data-wpick="${esc(w.id)}">＋ ${esc(w.name)}</button>`).join('');
    if (!allEl.hidden) renderList();
  };
  renderWorks();
  sheet.querySelector('#e-allbtn').addEventListener('click', () => {
    allEl.hidden = !allEl.hidden;
    sheet.querySelector('#e-allbtn').textContent = allEl.hidden ? 'Все работы…' : 'Свернуть список';
    if (!allEl.hidden) { renderList(); }
  });
  searchEl.addEventListener('input', renderList);
  sheet.querySelector('.form').addEventListener('click', ev => {
    const rm = ev.target.closest('[data-rmwork]')?.dataset.rmwork;
    if (rm) { selected.splice(selected.indexOf(rm), 1); renderWorks(); return; }
    const id = ev.target.closest('[data-wpick]')?.dataset.wpick;
    if (id) { pick(id); return; }
    if (ev.target.closest('[data-wnew]')) {
      const name = searchEl.value.trim();
      const cat = sheet.querySelector('#e-cat').value;
      const w = upsert(app.db, 'works', { id: uid('wrk'), name, categoryId: cat === '__new' ? null : cat, everyKm: null, everyMonths: null, remind: false });
      saveDb(app.db);
      searchEl.value = '';
      pick(w.id);
    }
  });

  const recalc = () => {
    const p = parseNum(sheet.querySelector('#e-parts').value), w = parseNum(sheet.querySelector('#e-work').value);
    const tot = sheet.querySelector('#e-total');
    tot.closest('.field').classList.toggle('calc', !!(p && w));
    if (p && w) tot.value = String(Math.round((p + w) * 100) / 100).replace('.', ',');
  };
  sheet.querySelector('#e-parts').addEventListener('input', recalc);
  sheet.querySelector('#e-work').addEventListener('input', recalc);
}

// ---------------------------------------------------------------- события ТО
const STATUS = {
  overdue: { color: 'var(--danger)', label: 'Просрочено' },
  soon: { color: 'var(--fuel)', label: 'Скоро' },
  ok: { color: 'var(--accent)', label: 'В норме' },
  unknown: { color: 'var(--muted)', label: 'Нет данных' },
  done: { color: 'var(--muted)', label: 'Выполнено' },
};

function daysText(d) {
  const n = Math.abs(d);
  return `${nf(n)} ${plural(n, 'день', 'дня', 'дней')}`;
}

function eventLines(ev) {
  const km = ev.dueKm != null ? `${nf(ev.dueKm)} км` : ev.estKm != null ? `≈ ${nf(ev.estKm)} км` : '';
  const date = ev.dueDate ? fmtDate(ev.dueDate) : ev.estDate ? `≈ ${fmtDate(ev.estDate)}` : '';
  const leftKm = ev.leftKm != null ? ev.leftKm : ev.estLeftKm;
  const leftKmEst = ev.leftKm == null && ev.estLeftKm != null;
  const leftDays = ev.leftDays != null ? ev.leftDays : ev.estDays;
  const leftDaysEst = ev.leftDays == null && ev.estDays != null;
  let overShown = false;
  const chip = (val, text, est) => {
    if (val == null) return '';
    if (val >= 0) return `<span class="due">${est ? '≈ ' : ''}${text}</span>`;
    const prefix = overShown ? '' : 'просрочено '; overShown = true;
    return `<span class="due over">${prefix}${est ? '≈ ' : ''}${text}</span>`;
  };
  return {
    target: [km, date].filter(Boolean).join(' · '),
    left: [chip(leftKm, leftKm != null ? `${nf(Math.abs(leftKm))} км` : '', leftKmEst),
      chip(leftDays, leftDays != null ? daysText(leftDays) : '', leftDaysEst)].filter(Boolean).join(''),
  };
}

function eventRow(ev) {
  const st = STATUS[ev.status];
  const l = eventLines(ev);
  const cat = app.db.categories[ev.work.categoryId];
  return `<button class="row ev" data-event="${esc(ev.work.id)}">
    <span class="ico" style="background:${st.color}">${esc(ev.work.name.trim().charAt(0).toUpperCase())}${ev.count ? `<b class="cnt">${ev.count}</b>` : ''}</span>
    <span class="main">
      <span class="title wrap">${esc(ev.work.name)}</span>
      ${ev.status === 'done' ? `<span class="meta">выполнено ${fmtDate(ev.last.date)}${ev.last.odo ? ` на ${nf(ev.last.odo)} км` : ''}</span>`
        : ev.status === 'unknown' ? `<span class="meta">${ev.neverDone ? 'ещё не выполнялось — отметьте первое выполнение' : 'нет пробега у последней записи'}</span>`
        : `<span class="meta num">${l.target}</span><span class="left num">${l.left}</span>`}
      ${ev.progress != null && ev.status !== 'done' ? `<span class="prog"><i style="width:${(ev.progress * 100).toFixed(0)}%;background:${st.color}"></i></span>` : ''}
    </span>
  </button>`;
}

function overviewEvents() {
  const { events } = eventsData();
  const top = events.filter(e => e.status === 'overdue' || e.status === 'soon').slice(0, 4);
  const next = top.length ? top : events.filter(e => e.status === 'ok').slice(0, 2);
  if (!next.length) return '';
  return `<h2 class="section">${top.length ? 'Обслуживание: пора' : 'Ближайшее обслуживание'}</h2>
    <div class="list">${next.map(eventRow).join('')}</div>
    <button class="btn soft block" style="margin-top:10px" data-tab-go="events">Все события</button>`;
}

function segControl() {
  return `<div class="seg">
    <button class="${app.eventsSeg === 'service' ? 'active' : ''}" data-seg="service">Обслуживание</button>
    <button class="${app.eventsSeg === 'parts' ? 'active' : ''}" data-seg="parts">Запчасти</button>
  </div>`;
}

function viewEvents() {
  const { v, events, rate } = eventsData();
  if (!v) return welcome();
  if (app.eventsSeg === 'parts') return segControl() + viewParts();
  const active = events.filter(e => e.status !== 'done' && e.status !== 'unknown');
  const fresh = events.filter(e => e.status === 'unknown');
  const done = events.filter(e => e.status === 'done');
  const n = st => events.filter(e => e.status === st).length;
  return `${segControl()}
    <div class="actions" style="margin-top:0">
      <button class="btn primary" data-act="add-event">＋ Событие</button>
      <button class="btn" data-act="ics-all">В Календарь</button>
    </div>
    <div class="grid2">
      ${tile('Просрочено', String(n('overdue')), '', n('overdue') ? 'нужно сделать' : 'всё в порядке')}
      ${tile('Скоро', String(n('soon')), '', '30 дней или 1000 км')}
    </div>
    ${active.length ? `<h2 class="section">Плановое обслуживание</h2><div class="list">${active.map(eventRow).join('')}</div>`
      : `<div class="empty">Событий пока нет.<br>Добавьте интервал, например «Замена масла — каждые 7 500 км или 1 год».</div>`}
    ${fresh.length ? `<h2 class="section">Ещё не отмечались</h2><div class="list">${fresh.map(eventRow).join('')}</div>
      <p class="note">Отметьте последнее выполнение — и срок посчитается от него.</p>` : ''}
    <button class="btn block" style="margin-top:14px" data-act="works-manager">Настроить список работ и интервалы</button>
    ${done.length ? `<h2 class="section">Разовые, выполнены</h2><div class="list">${done.map(eventRow).join('')}</div>` : ''}
    <p class="note">Срок считается от последнего расхода с этим видом работ. Добавили расход — событие продлилось само.
      ${rate ? `Оценки «≈» — по среднему пробегу ${nf(rate)} км в день за последний год.` : ''}</p>`;
}

function eventSheet(workId) {
  const { v, events } = eventsData();
  const ev = events.find(e => e.work.id === workId);
  const w = app.db.works[workId];
  if (!w) return;
  const l = ev ? eventLines(ev) : null;
  const hist = ev ? [...ev.history].reverse() : [];
  const sheet = openSheet(w.name, `
    <div class="card pad">
      <div class="label" style="color:var(--muted);font-size:13px">Интервал</div>
      <div style="font-size:17px;font-weight:600;margin-top:2px">${esc(workLabel(w) || 'не задан')}</div>
      ${ev && ev.status !== 'done' && ev.status !== 'unknown' ? `
        <div class="label" style="color:var(--muted);font-size:13px;margin-top:12px">Следующий раз</div>
        <div class="num" style="font-size:17px;font-weight:600;margin-top:2px">${l.target}</div>
        <div class="left num" style="margin-top:6px">${l.left}</div>` : ''}
      ${ev?.last ? `<div class="label" style="color:var(--muted);font-size:13px;margin-top:12px">Последний раз</div>
        <div class="num">${fmtDate(ev.last.date)}${ev.last.odo ? ` · ${nf(ev.last.odo)} км` : ''} · ${money(ev.last.total)}</div>` : ''}
    </div>
    <div class="form-gap"></div>
    <button class="btn primary block" data-evact="done">Отметить выполнение</button>
    <div class="form-gap"></div>
    <div class="actions" style="margin-top:0">
      <button class="btn" data-evact="edit">Настроить</button>
      <button class="btn" data-evact="ics" ${ev && (ev.dueDate || ev.estDate) && ev.status !== 'done' ? '' : 'disabled style="opacity:.4"'}>В Календарь</button>
    </div>
    ${hist.length ? `<h2 class="section">История · ${hist.length}</h2>
      <div class="list">${hist.map(e => `<button class="row" data-edit="expense:${esc(e.id)}">
        <span class="main"><span class="title num">${fmtDate(e.date)}${e.odo ? ` · ${nf(e.odo)} км${e.odoEstimated ? '≈' : ''}` : ''}</span>
        <span class="meta">${esc(e.title)}</span></span><span class="end amount num">${money(e.total)}</span></button>`).join('')}</div>` : ''}`);
  sheet.addEventListener('click', e => {
    const a = e.target.closest('[data-evact]')?.dataset.evact;
    if (a === 'done') { closeSheet(); expenseForm(null, { workIds: [w.id], title: w.name, categoryId: w.categoryId }); }
    if (a === 'edit') { closeSheet(); workForm(w); }
    if (a === 'ics' && ev) addToCalendar([ev], v);
  });
}

function workForm(w = null, { pickExisting = false } = {}) {
  const x = w || { name: '', categoryId: alive(app.db.categories).find(c => /основн|обслуж/i.test(c.name))?.id, everyKm: null, everyMonths: null, onceKm: null, onceDate: null, remind: true };
  const candidates = alive(app.db.works).filter(k => !k.remind || !EV.hasSchedule(k)).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const sheet = openSheet(w ? 'Работа и интервал' : 'Новое событие', `
    ${pickExisting && candidates.length ? `<div class="form">${field('Вид работ', `<select id="w-pick"><option value="">— новый —</option>${candidates.map(k => `<option value="${esc(k.id)}">${esc(k.name)}</option>`).join('')}</select>`)}</div>
      <p class="form-hint">Выберите вид работ из истории, чтобы срок посчитался от последнего выполнения, или создайте новый.</p><div class="form-gap"></div>` : ''}
    <div class="form">
      <div class="field stack"><label>Название</label><input id="w-name" value="${esc(x.name)}" placeholder="Замена масла в двигателе" style="text-align:left"></div>
      ${field('Категория', `<select id="w-cat">${optionList('categories', x.categoryId, '＋ Новая категория…')}</select>`)}
    </div>
    <div class="form-gap"></div>
    <div class="form">
      ${field('Каждые', numInput('w-km', x.everyKm, 'inputmode="numeric" placeholder="—"'), 'км')}
      ${field('или каждые', numInput('w-mon', x.everyMonths, 'placeholder="—"'), 'мес')}
    </div>
    <p class="form-hint">Можно задать одно или оба условия — сработает то, что наступит раньше. Например, масло: 7 500 км или 12 мес.</p>
    <div class="form-gap"></div>
    <div class="form">
      ${field('Разово при пробеге', numInput('w-okm', x.onceKm, 'inputmode="numeric" placeholder="—"'), 'км')}
      ${field('Разово к дате', `<input id="w-odate" type="date" value="${esc(x.onceDate || '')}">`)}
    </div>
    <p class="form-hint">Для разовых задач (ТО-1, техосмотр к дате), если нет регулярного интервала.</p>
    <div class="form-gap"></div>
    <div class="form">${field('Напоминать', `<input id="w-remind" type="checkbox" ${x.remind ? 'checked' : ''}>`)}</div>`,
  {
    onSave() {
      const pick = sheet.querySelector('#w-pick')?.value;
      const base = pick ? app.db.works[pick] : w;
      const name = sheet.querySelector('#w-name').value.trim();
      if (!name) { toast('Укажите название'); return false; }
      const everyKm = parseNum(sheet.querySelector('#w-km').value);
      const everyMonths = parseNum(sheet.querySelector('#w-mon').value);
      const onceKm = parseNum(sheet.querySelector('#w-okm').value);
      const onceDate = sheet.querySelector('#w-odate').value || null;
      const remind = sheet.querySelector('#w-remind').checked;
      if (remind && !everyKm && !everyMonths && !onceKm && !onceDate) { toast('Задайте интервал по пробегу, времени или разовый срок'); return false; }
      const cat = sheet.querySelector('#w-cat').value;
      upsert(app.db, 'works', {
        ...(base || {}), id: (base?.id && app.db.works[base.id] ? base.id : null) || uid('wrk'), name,
        categoryId: cat === '__new' ? null : cat,
        everyKm: everyKm ? Math.round(everyKm) : null, everyMonths: everyMonths || null,
        onceKm: onceKm ? Math.round(onceKm) : null, onceDate, remind,
      });
      commit();
      toast('Событие сохранено');
    },
    onDelete: w ? () => {
      const used = alive(app.db.expenses).some(e => (e.workIds || []).includes(w.id));
      if (used) { upsert(app.db, 'works', { ...w, remind: false }); toast('Напоминание выключено — вид работ остался в истории расходов'); }
      else remove(app.db, 'works', w.id);
      commit();
    } : null,
  });
  handleNewOption(sheet.querySelector('#w-cat'), 'categories', 'Название категории', { color: '#46a758', income: false });
  sheet.querySelector('#w-pick')?.addEventListener('change', ev => {
    const k = app.db.works[ev.target.value];
    if (!k) return;
    sheet.querySelector('#w-name').value = k.name;
    if (k.categoryId) sheet.querySelector('#w-cat').value = k.categoryId;
    sheet.querySelector('#w-km').value = k.everyKm ? String(k.everyKm) : '';
    sheet.querySelector('#w-mon').value = k.everyMonths ? String(k.everyMonths).replace('.', ',') : '';
  });
}

// ---------------------------------------------------------------- запчасти с ресурсом
const wearColor = w => w == null ? 'var(--muted)' : w >= 1 ? 'var(--danger)' : w >= 0.85 ? 'var(--fuel)' : 'var(--accent)';
const yearsText = months => months == null ? '—' : months >= 12 ? `${nf(months / 12, 1)} г.` : `${nf(months)} мес`;

function resourceText(p, u) {
  const parts = [];
  if (p.resourceKm) parts.push(`${nf(u.km)} из ${nf(p.resourceKm)} км`);
  else parts.push(`${nf(u.km)} км`);
  if (p.resourceMonths) parts.push(`${yearsText(u.months)} из ${yearsText(p.resourceMonths)}`);
  else if (u.months != null) parts.push(yearsText(u.months));
  return parts.join(' · ');
}

function partRow({ part: p, usage: u }) {
  const color = u.status === 'retired' ? 'var(--muted)' : wearColor(u.wear);
  return `<button class="row ev" data-part="${esc(p.id)}">
    <span class="ico" style="background:${color}">${esc(p.name.trim().charAt(0).toUpperCase())}</span>
    <span class="main">
      <span class="title wrap">${esc(p.name)}</span>
      <span class="meta">${esc([P.STATUS_LABEL[u.status], p.note].filter(Boolean).join(' · '))}</span>
      <span class="left num"><span class="due ${u.wear >= 1 && u.status !== 'retired' ? 'over' : ''}">${resourceText(p, u)}</span>${u.wear != null ? `<span class="due">износ ${nf(u.wear * 100)}%</span>` : ''}</span>
      ${u.wear != null && u.status !== 'retired' ? `<span class="prog"><i style="width:${Math.min(100, u.wear * 100).toFixed(0)}%;background:${color}"></i></span>` : ''}
    </span>
  </button>`;
}

function viewParts() {
  const { list } = partsData();
  const active = list.filter(x => x.usage.status !== 'retired');
  const retired = list.filter(x => x.usage.status === 'retired');
  return `
    <div class="actions" style="margin-top:0"><button class="btn primary" data-act="add-part" style="grid-column:1/-1">＋ Запчасть</button></div>
    ${active.length ? `<h2 class="section">В работе и на хранении</h2><div class="list">${active.map(partRow).join('')}</div>`
      : '<div class="empty">Запчастей пока нет.<br>Добавьте шины, аккумулятор, колодки — приложение посчитает износ по пробегу и сроку службы.</div>'}
    ${retired.length ? `<h2 class="section">Списаны</h2><div class="list">${retired.map(partRow).join('')}</div>` : ''}
    <p class="note">Пробег копится только пока деталь установлена — удобно для сезонных комплектов шин. Износ — наибольшая из двух долей: по пробегу и по сроку.</p>`;
}

function partForm(p = null) {
  const { v, refuels, expenses } = data();
  if (!v) return toast('Сначала добавьте автомобиль');
  const odo = S.lastOdo(refuels, expenses);
  const x = p || { name: '', note: '', resourceKm: null, resourceMonths: null, buyDate: today(), price: null };
  const sheet = openSheet(p ? 'Запчасть' : 'Новая запчасть', `
    <div class="form">
      <div class="field stack"><label>Название</label><input id="p-name" value="${esc(x.name)}" placeholder="Зимние шины, аккумулятор…" style="text-align:left"></div>
      <div class="field stack"><label>Марка, модель, артикул</label><input id="p-note" value="${esc(x.note || '')}" placeholder="Nokian Hakkapeliitta 9, 205/55 R16" style="text-align:left"></div>
    </div>
    <div class="form-gap"></div>
    <div class="form">
      ${field('Ресурс', numInput('p-rkm', x.resourceKm, 'inputmode="numeric" placeholder="—"'), 'км')}
      ${field('Срок службы', numInput('p-ry', x.resourceMonths ? x.resourceMonths / 12 : null, 'placeholder="—"'), 'лет')}
    </div>
    <p class="form-hint">Задайте пробег, срок или оба — износ считается по тому, что ближе к пределу.</p>
    <div class="form-gap"></div>
    <div class="form">
      ${field('Куплена', `<input id="p-buy" type="date" value="${esc(x.buyDate || '')}">`)}
      ${field('Цена', numInput('p-price', x.price, 'placeholder="—"'), '₽')}
      ${p ? '' : field('Записать в расходы', '<input id="p-exp" type="checkbox" checked>')}
    </div>
    ${p ? '' : `<div class="form-gap"></div>
    <div class="form">
      ${field('Установить сейчас', '<input id="p-inst" type="checkbox" checked>')}
      ${field('Пробег установки', numInput('p-iodo', odo, 'inputmode="numeric"'), 'км')}
    </div>`}`,
  {
    onSave() {
      const name = sheet.querySelector('#p-name').value.trim();
      if (!name) { toast('Укажите название'); return false; }
      const rkm = parseNum(sheet.querySelector('#p-rkm').value);
      const ry = parseNum(sheet.querySelector('#p-ry').value);
      const price = parseNum(sheet.querySelector('#p-price').value);
      const buyDate = sheet.querySelector('#p-buy').value || null;
      const rec = {
        ...(p || {}), id: p?.id || uid('prt'), vehicleId: p?.vehicleId || v.id, name,
        note: sheet.querySelector('#p-note').value.trim(),
        resourceKm: rkm ? Math.round(rkm) : null, resourceMonths: ry ? Math.round(ry * 12 * 10) / 10 : null,
        buyDate, price, installs: p?.installs || [],
      };
      if (!p && sheet.querySelector('#p-inst').checked) {
        const iodo = parseNum(sheet.querySelector('#p-iodo').value);
        rec.installs = [{ onDate: today(), onOdo: iodo ? Math.round(iodo) : null }];
      }
      upsert(app.db, 'parts', rec);
      if (!p && price && sheet.querySelector('#p-exp').checked) {
        const cat = alive(app.db.categories).find(c => /основн|запчаст|обслуж/i.test(c.name));
        upsert(app.db, 'expenses', { id: uid('exp'), vehicleId: v.id, title: `${name}${rec.note ? ' (' + rec.note + ')' : ''}`, categoryId: cat?.id || null,
          date: buyDate || today(), odo: rec.installs[0]?.onOdo || odo || null, total: price, parts: price, work: 0, note: 'покупка запчасти', workIds: [] });
      }
      commit();
      toast('Запчасть сохранена');
    },
    onDelete: p ? () => { remove(app.db, 'parts', p.id); commit(); } : null,
  });
}

function partSheet(id, mode = null) {
  const { v, cur, list } = partsData();
  const item = list.find(x => x.part.id === id);
  if (!item) return;
  const { part: p, usage: u } = item;
  const odo = cur?.odo ?? null;
  const installs = [...(p.installs || [])].reverse();
  const action = mode === 'on' ? 'Установка' : mode === 'off' ? 'Снятие' : mode === 'retire' ? 'Списание' : null;
  const sheet = openSheet(p.name, `
    <div class="card pad">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
        <span style="font-size:17px;font-weight:600">${u.wear != null ? `Износ ${nf(u.wear * 100)}%` : 'Ресурс не задан'}</span>
        <span class="hint" style="color:var(--muted);font-size:13px">${P.STATUS_LABEL[u.status]}</span>
      </div>
      ${u.wear != null ? `<span class="prog" style="height:6px"><i style="width:${Math.min(100, u.wear * 100).toFixed(0)}%;background:${wearColor(u.wear)}"></i></span>` : ''}
      <div class="left num" style="margin-top:10px"><span class="due">${resourceText(p, u)}</span>
        ${u.leftKm != null && u.status !== 'retired' ? `<span class="due ${u.leftKm < 0 ? 'over' : ''}">${u.leftKm < 0 ? 'перепробег' : 'осталось'} ${nf(Math.abs(u.leftKm))} км</span>` : ''}</div>
      ${p.note ? `<div class="note" style="margin:10px 0 0">${esc(p.note)}</div>` : ''}
      ${p.buyDate || p.price ? `<div class="note" style="margin:4px 0 0">Куплена ${p.buyDate ? fmtDate(p.buyDate) : ''}${p.price ? ` · ${money(p.price)}` : ''}</div>` : ''}
    </div>
    <div class="form-gap"></div>
    ${action ? `
      <h2 class="section" style="margin-top:4px">${action}</h2>
      <div class="form">
        ${field('Дата', `<input id="pa-date" type="date" value="${today()}">`)}
        ${mode !== 'retire' ? field('Пробег', numInput('pa-odo', odo, 'inputmode="numeric"'), 'км') : ''}
      </div>
      <div class="form-gap"></div>
      <div class="actions" style="margin-top:0"><button class="btn" data-pact="cancel">Отмена</button><button class="btn primary" data-pact="confirm">Сохранить</button></div>`
    : `<div class="actions" style="margin-top:0">
        ${u.status === 'installed' ? '<button class="btn" data-pact="off">Снять</button>'
          : u.status === 'retired' ? '<button class="btn" data-pact="unretire">Вернуть</button>'
          : '<button class="btn primary" data-pact="on">Установить</button>'}
        <button class="btn" data-pact="edit">Изменить</button>
      </div>
      ${u.status !== 'retired' ? '<div class="form-gap"></div><button class="btn danger block" data-pact="retire">Списать</button>' : ''}`}
    ${installs.length ? `<h2 class="section">История установки</h2><div class="list">${installs.map(it => `
      <div class="row"><span class="main"><span class="title num">${fmtDate(it.onDate)}${it.offDate ? ` — ${fmtDate(it.offDate)}` : ' — сейчас'}</span>
      <span class="meta num">${it.onOdo != null ? nf(it.onOdo) : '?'} → ${it.offOdo != null ? nf(it.offOdo) : it.offDate ? '?' : nf(odo)} км</span></span>
      <span class="end num">${it.onOdo != null ? nf(Math.max(0, (it.offOdo ?? odo ?? it.onOdo) - it.onOdo)) + ' км' : ''}</span></div>`).join('')}</div>` : ''}`);
  sheet.addEventListener('click', e => {
    const a = e.target.closest('[data-pact]')?.dataset.pact;
    if (!a) return;
    if (a === 'edit') { closeSheet(); partForm(p); return; }
    if (a === 'cancel') { partSheet(id); return; }
    if (a === 'on' || a === 'off' || a === 'retire') { partSheet(id, a); return; }
    if (a === 'unretire') { upsert(app.db, 'parts', { ...p, retiredDate: null }); commit(); partSheet(id); return; }
    if (a === 'confirm') {
      const date = sheet.querySelector('#pa-date').value || today();
      const o = parseNum(sheet.querySelector('#pa-odo')?.value);
      const ins = [...(p.installs || [])];
      if (mode === 'on') ins.push({ onDate: date, onOdo: o != null ? Math.round(o) : null });
      if (mode === 'off' && ins.length) ins[ins.length - 1] = { ...ins[ins.length - 1], offDate: date, offOdo: o != null ? Math.round(o) : null };
      const patch = { ...p, installs: ins };
      if (mode === 'retire') {
        patch.retiredDate = date;
        const last = ins[ins.length - 1];
        if (last && !last.offDate) ins[ins.length - 1] = { ...last, offDate: date, offOdo: odo };
      }
      upsert(app.db, 'parts', patch);
      commit();
      toast(mode === 'on' ? 'Установлена' : mode === 'off' ? 'Снята' : 'Списана');
      partSheet(id);
    }
  });
}

// ---------------------------------------------------------------- данные машины и отчёт для продажи
function vehicleDetailsForm() {
  const v = currentVehicle();
  if (!v) return;
  const sheet = openSheet('Данные автомобиля', `
    <div class="form">
      <div class="field stack"><label>Название в приложении</label><input id="vd-name" value="${esc(v.name)}" style="text-align:left"></div>
      ${field('Марка', `<input id="vd-make" value="${esc(v.make || '')}" placeholder="Skoda">`)}
      ${field('Модель', `<input id="vd-model" value="${esc(v.model || '')}" placeholder="Rapid">`)}
      ${field('Год выпуска', `<input id="vd-year" inputmode="numeric" value="${esc(v.year || '')}" placeholder="2017">`)}
      ${field('VIN', `<input id="vd-vin" value="${esc(v.vin || '')}" autocapitalize="characters" spellcheck="false" placeholder="17 символов">`)}
      ${field('Госномер', `<input id="vd-plate" value="${esc(v.plate || '')}" autocapitalize="characters" placeholder="А123ВС 777">`)}
    </div>
    <p class="form-hint">Эти данные попадут в отчёт по обслуживанию.</p>`,
  {
    onSave() {
      const name = sheet.querySelector('#vd-name').value.trim() || v.name;
      upsert(app.db, 'vehicles', { ...v, name,
        make: sheet.querySelector('#vd-make').value.trim(), model: sheet.querySelector('#vd-model').value.trim(),
        year: sheet.querySelector('#vd-year').value.trim(), vin: sheet.querySelector('#vd-vin').value.trim().toUpperCase(),
        plate: sheet.querySelector('#vd-plate').value.trim().toUpperCase() });
      commit();
      toast('Сохранено');
    },
  });
}

const DEFAULT_REPORT_CAT = /основн|незаплан|обслуж|ремонт|запчаст|тюнинг|аксесс/i;

function reportSetup() {
  const { v, expenses } = data();
  if (!v) return toast('Сначала добавьте автомобиль');
  const used = new Map();
  for (const e of expenses) if (!e.income) used.set(e.categoryId || '_none', (used.get(e.categoryId || '_none') || 0) + 1);
  const cats = [...used.entries()].map(([id, n]) => ({ id, n, name: app.db.categories[id]?.name || 'Без категории' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const sheet = openSheet('Отчёт для продажи', `
    <p class="form-hint" style="margin-top:0">История обслуживания для покупателя: регламентные работы, запчасти и хронология ремонтов. Откроется документ, который можно сохранить в PDF или отправить.</p>
    <div class="form-gap"></div>
    ${!v.vin || !v.make ? `<button class="btn soft block" data-rep="details">Добавить марку, год и VIN</button><div class="form-gap"></div>` : ''}
    <h2 class="section" style="margin-top:0">Что включить в хронологию</h2>
    <div class="form">${cats.map(c => field(`${esc(c.name)} <span style="color:var(--muted);font-size:13px">· ${c.n}</span>`,
      `<input type="checkbox" data-repcat="${esc(c.id)}" ${DEFAULT_REPORT_CAT.test(c.name) ? 'checked' : ''}>`)).join('')}</div>
    <div class="form-gap"></div>
    <div class="form">${field('Показывать суммы', '<input id="rep-costs" type="checkbox">')}</div>
    <p class="form-hint">Покупателю обычно важны даты и пробег, а не цены — по умолчанию суммы скрыты.</p>`,
  {
    saveLabel: 'Создать',
    onSave() {
      const include = new Set([...sheet.querySelectorAll('[data-repcat]')].filter(i => i.checked).map(i => i.dataset.repcat));
      showReport({ include, showCosts: sheet.querySelector('#rep-costs').checked });
    },
  });
  sheet.addEventListener('click', e => {
    if (e.target.closest('[data-rep="details"]')) { closeSheet(); vehicleDetailsForm(); }
  });
}

function reportHtml(opts) {
  const { v, refuels, expenses } = data();
  const { events } = eventsData();
  const { list } = partsData();
  return buildReport({ vehicle: v, expenses, refuels, events, parts: list, categories: app.db.categories,
    include: opts.include, showCosts: opts.showCosts, summary: S.summary(refuels, expenses), todayIso: today() });
}

function showReport(opts) {
  const v = currentVehicle();
  const html = reportHtml(opts);
  const box = $('#report');
  box.innerHTML = `<div class="report-bar">
      <button data-repbar="close">Закрыть</button>
      <span>Отчёт</span>
      <span style="display:flex;gap:14px"><button data-repbar="share">Отправить</button><button data-repbar="print">PDF</button></span>
    </div><style>${REPORT_CSS}</style>${html}`;
  box.hidden = false;
  document.body.classList.add('report-open');
  box.scrollTop = 0;
  box.onclick = e => {
    const a = e.target.closest('[data-repbar]')?.dataset.repbar;
    if (a === 'close') { box.hidden = true; box.innerHTML = ''; document.body.classList.remove('report-open'); }
    if (a === 'print') window.print();
    if (a === 'share') {
      const doc = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>История обслуживания — ${esc(v.name)}</title><style>body{margin:0;background:#fff}${REPORT_CSS}</style></head><body>${html}</body></html>`;
      shareOrDownload(`История_обслуживания_${v.name}_${today()}.html`, doc, 'text/html');
    }
  };
}

// Группы категорий: сначала те, где больше выполненных работ; доходы и топливо — в конце.
function sortGroups(groups, freq) {
  const weight = ([cid, ws]) => {
    const c = app.db.categories[cid];
    if (c?.income || /топлив/i.test(c?.name || '')) return -1;
    return ws.reduce((s, w) => s + (freq.get(w.id)?.count || 0), 0) + ws.filter(w => w.remind && EV.hasSchedule(w)).length * 1000;
  };
  return [...groups.entries()].sort((a, b) => weight(b) - weight(a) || (app.db.categories[a[0]]?.name || 'я').localeCompare(app.db.categories[b[0]]?.name || 'я', 'ru'));
}

function worksManager() {
  const { expenses } = data();
  const freq = workFrequency(expenses);
  const sheet = openSheet('Работы и интервалы', `
    <p class="form-hint" style="margin-top:0">Включите напоминание у работ, которые нужно отслеживать. Нажмите на работу, чтобы изменить интервал или название.</p>
    <div class="form-gap"></div>
    <input class="search" id="wm-search" type="search" placeholder="Найти работу" autocomplete="off">
    <div id="wm-list"></div>
    <div class="form-gap"></div>
    <button class="btn primary block" data-wm="new">＋ Новая работа</button>`);
  const listEl = sheet.querySelector('#wm-list'), searchEl = sheet.querySelector('#wm-search');
  const draw = () => {
    const q = normName(searchEl.value);
    const items = alive(app.db.works).filter(w => !q || normName(w.name).includes(q));
    const groups = new Map();
    for (const w of items) { const k = w.categoryId || '_none'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(w); }
    listEl.innerHTML = sortGroups(groups, freq)
      .map(([cid, ws]) => `<h2 class="section">${esc(app.db.categories[cid]?.name || 'Без категории')}</h2><div class="list">`
        + ws.sort((a, b) => ((b.remind && EV.hasSchedule(b)) - (a.remind && EV.hasSchedule(a))) || (freq.get(b.id)?.count || 0) - (freq.get(a.id)?.count || 0) || a.name.localeCompare(b.name, 'ru'))
          .map(w => `<div class="row wm-row">
            <button class="main" data-wm="edit" data-id="${esc(w.id)}" style="text-align:left">
              <span class="title wrap">${esc(w.name)}</span>
              <span class="meta">${esc(workLabel(w) || 'без интервала')}${freq.get(w.id) ? ` · выполнялась ${freq.get(w.id).count} ${plural(freq.get(w.id).count, 'раз', 'раза', 'раз')}` : ''}</span></button>
            <span class="end"><input type="checkbox" class="sw" data-wm="toggle" data-id="${esc(w.id)}" ${w.remind && EV.hasSchedule(w) ? 'checked' : ''} aria-label="Напоминать"></span>
          </div>`).join('') + '</div>').join('') || '<div class="empty">Ничего не найдено</div>';
  };
  draw();
  searchEl.addEventListener('input', draw);
  sheet.addEventListener('click', e => {
    const el = e.target.closest('[data-wm]');
    if (!el) return;
    const w = app.db.works[el.dataset.id];
    if (el.dataset.wm === 'new') { closeSheet(); workForm(null); }
    if (el.dataset.wm === 'edit' && w) { closeSheet(); workForm(w); }
    if (el.dataset.wm === 'toggle' && w) {
      if (el.checked && !EV.hasSchedule(w)) { el.checked = false; closeSheet(); workForm({ ...w, remind: true }); toast('Задайте интервал'); return; }
      upsert(app.db, 'works', { ...w, remind: el.checked });
      saveDb(app.db); render(); sync.schedule();
    }
  });
}

function addToCalendar(list, v) {
  const items = list.filter(ev => ev.status !== 'done' && (ev.dueDate || ev.estDate)).map(ev => {
    const date = ev.dueDate || ev.estDate;
    const l = eventLines(ev);
    return {
      uid: `${ev.work.id}-${date}`, date, title: ev.work.name,
      description: `Срок: ${l.target.replace(/<[^>]+>/g, '')}. Интервал: ${workLabel(ev.work)}.${ev.estDate && !ev.dueDate ? ' Дата оценочная, по среднему пробегу.' : ''}`,
    };
  });
  if (!items.length) { toast('Нет событий с датой'); return; }
  const ics = EV.eventsToIcs(items, v?.name || 'Авто');
  const blob = new Blob([ics], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = items.length === 1 ? `${items[0].title}.ics` : 'Обслуживание.ics';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast(items.length === 1 ? 'Откройте файл, чтобы добавить в Календарь' : `Событий в файле: ${items.length}`);
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
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isSqlite(bytes)) {
    toast('Читаю базу Car Expenses…');
    const SQL = await loadSqlJs();
    return importCe(ceObjToRecords(ceDbToObj(SQL, bytes)));
  }
  const text = new TextDecoder().decode(bytes);
  if (/<map>/.test(text.slice(0, 300)) && /<\?xml/.test(text.slice(0, 100))) {
    toast('Это файл настроек. Выберите базу ce_db_backup_….db из той же папки');
    return;
  }
  if (text.trimStart().startsWith('{')) {
    const incoming = normalize(JSON.parse(text));
    const n = Object.values(incoming.refuels).length + Object.values(incoming.expenses).length;
    if (!confirm(`Резервная копия: ${n} записей. Объединить с текущими данными?`)) return;
    app.db = mergeDb(app.db, incoming);
    maintain(app.db, () => uid('wrk'));
    commit();
    toast('Копия восстановлена');
    return;
  }
  return importCe(ceToRecords(text));
}

function importCe(recs) {
  const cars = recs.vehicles.map(v => {
    const r = recs.refuels.filter(x => x.vehicleId === v.id).length, e = recs.expenses.filter(x => x.vehicleId === v.id).length;
    return `• ${v.name}: ${r} заправок, ${e} расходов`;
  }).join('\n');
  if (!confirm(`Car Expenses\n${cars}\nВидов работ: ${recs.works.length}\n\nИмпортировать? Уже перенесённые записи не задвоятся, правленные вручную не изменятся.`)) return;
  const { added, updated } = importInto(app.db, recs);
  maintain(app.db, () => uid('wrk'));
  if ((!app.settings.vehicleId || !app.db.vehicles[app.settings.vehicleId]) && recs.vehicles[0]) { app.settings.vehicleId = recs.vehicles[0].id; saveSettings(app.settings); }
  app.tab = 'overview';
  commit();
  const upd = Object.values(updated).reduce((s, x) => s + x, 0);
  toast(`Добавлено: машин ${added.vehicles}, заправок ${added.refuels}, расходов ${added.expenses}${upd ? `; обновлено ${upd}` : ''}`);
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
  const seg = t.closest('[data-seg]')?.dataset.seg;
  if (seg) { app.eventsSeg = seg; render(); return; }
  const partId = t.closest('[data-part]')?.dataset.part;
  if (partId) { partSheet(partId); return; }
  const evId = t.closest('[data-event]')?.dataset.event;
  if (evId) { eventSheet(evId); return; }
  const go = t.closest('[data-tab-go]')?.dataset.tabGo;
  if (go) { app.tab = go; render(); window.scrollTo(0, 0); return; }
  if (t.closest('#gearBtn')) { app.tab = 'more'; render(); window.scrollTo(0, 0); return; }
  const filter = t.closest('[data-filter]')?.dataset.filter;
  if (filter) { app.expFilter = filter; render(); return; }
  const period = t.closest('[data-period]')?.dataset.period;
  if (period) { app.statsPeriod = period; render(); return; }
  const veh = t.closest('[data-vehicle]')?.dataset.vehicle;
  if (veh) { app.settings.vehicleId = veh; saveSettings(app.settings); render(); return; }

  if (t.closest('#vehicleBtn')) { if (vehicles().length > 1) vehicleSheet(); return; }
  if (t.closest('#syncBtn')) {
    const pv = provider(app.settings);
    if (!pv) { app.tab = 'more'; render(); return; }
    if (pv.name === 'google' && (app.settings.googleNeedsLogin || pv.expired)) { app.settings.googleNeedsLogin = false; saveSettings(app.settings); googleLogin(); return; }
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
    case 'add-event': workForm(null, { pickExisting: true }); break;
    case 'add-part': partForm(); break;
    case 'works-manager': worksManager(); break;
    case 'report': reportSetup(); break;
    case 'vehicle-details': vehicleDetailsForm(); break;
    case 'ics-all': { const { v, events } = eventsData(); addToCalendar(events, v); break; }
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
    case 'g-connect': {
      const input = $('#gcid');
      if (input) { app.settings.googleClientId = input.value.trim(); saveSettings(app.settings); }
      app.settings.googleNeedsLogin = false; saveSettings(app.settings);
      googleLogin();
      break;
    }
    case 'g-login': app.settings.googleNeedsLogin = false; saveSettings(app.settings); googleLogin(); break;
    case 'g-logout':
      if (confirm('Отключить Google Диск? Данные на устройстве и в облаке останутся.')) {
        const tok = app.settings.googleToken;
        if (tok) fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(tok), { method: 'POST' }).catch(() => {});
        Object.assign(app.settings, { googleToken: null, googleExpires: 0, syncProvider: null, lastSync: null, lastSyncError: null, googleNeedsLogin: false });
        saveSettings(app.settings); app.syncState = 'off'; render();
      }
      break;
    case 'ya-login': {
      const input = $('#cid');
      if (input) { app.settings.yandexClientId = input.value.trim(); saveSettings(app.settings); }
      if (!clientId()) { toast('Введите ClientID приложения из oauth.yandex.ru'); return; }
      app.settings.syncProvider = 'yandex'; saveSettings(app.settings);
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
        app.settings.yandexToken = null; app.settings.lastSync = null; app.settings.lastSyncError = null; app.settings.syncProvider = null;
        saveSettings(app.settings); app.syncState = 'off'; render();
      }
      break;
    case 'ya-check': {
      toast('Проверяю…');
      const res = await disk.diagnose(app.settings.yandexToken);
      openSheet('Связь с Диском', `<div class="list">${res.map(r => `<div class="row"><span class="ico" style="background:${r.ok ? 'var(--accent)' : 'var(--danger)'}">${r.ok ? '✓' : '✕'}</span>
        <span class="main"><span class="title">${esc(r.name)}</span><span class="meta" style="white-space:normal">${esc(r.note)}</span></span></div>`).join('')}</div>
        <p class="form-hint">Сделайте скриншот этого окна и пришлите его, если что-то красное.</p>`);
      break;
    }
    case 'proxy-save': {
      app.settings.yandexProxy = ($('#proxyUrl').value || '').trim();
      saveSettings(app.settings);
      disk.setProxy(app.settings.yandexProxy || YANDEX_PROXY);
      toast(app.settings.yandexProxy ? 'Прокси сохранён' : 'Прокси отключён');
      sync.schedule(200);
      break;
    }
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
  maintain(app.db, () => uid('wrk'));
}

async function connectToken(token, expires) {
  app.settings.syncProvider = 'yandex';
  app.settings.yandexToken = token;
  app.settings.yandexTokenExpires = expires;
  saveSettings(app.settings);
  render();
  await sync.run();
  toast(app.syncState === 'error' ? (app.syncMsg || 'Ошибка синхронизации') : 'Яндекс Диск подключён');
}

// ---------------------------------------------------------------- запуск
if (disk.setProxy) disk.setProxy(app.settings.yandexProxy || YANDEX_PROXY);
const fromG = gd.takeResultFromHash();
const fromYa = fromG ? null : disk.takeTokenFromHash();
try { if (maintain(app.db, () => uid('wrk'))) saveDb(app.db); }
catch (e) { console.error(e); setTimeout(() => toast('Не удалось обновить справочник работ: ' + e.message), 500); }
render();
window.__carlogReady = true;
if (fromG?.token) {
  const first = app.settings.syncProvider !== 'google' || !app.settings.googleToken;
  Object.assign(app.settings, { syncProvider: 'google', googleToken: fromG.token, googleExpires: fromG.expires, googleNeedsLogin: false });
  saveSettings(app.settings);
  render();
  if (!app.settings.googleEmail || first) gd.whoAmI(fromG.token).then(email => { if (email) { app.settings.googleEmail = email; saveSettings(app.settings); render(); } });
  sync.run().then(() => { if (first) toast(app.syncState === 'error' ? (app.syncMsg || 'Ошибка синхронизации') : 'Google Диск подключён'); });
} else if (fromG?.error) {
  if (app.settings.googleToken) { app.settings.googleNeedsLogin = true; saveSettings(app.settings); }
  render();
  toast(fromG.error === 'access_denied' ? 'Доступ к Google Диску не выдан' : 'Войдите в Google ещё раз: «⚙» → «Войти в Google снова»');
} else if (fromYa) connectToken(fromYa.token, fromYa.expires);
else sync.run();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { });
}
