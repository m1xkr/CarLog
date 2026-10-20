// Отчёт по обслуживанию для покупателя: данные машины, регламентные работы, хронология работ.
// Возвращает самостоятельный HTML-фрагмент со своими стилями (подходит и для экрана, и для печати в PDF).

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (v, d = 0) => (v == null || !Number.isFinite(v)) ? '—' : v.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
const dmy = iso => iso ? iso.split('-').reverse().join('.') : '—';

function duration(fromIso, toIso) {
  const a = new Date(fromIso + 'T12:00:00'), b = new Date(toIso + 'T12:00:00');
  let m = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
  if (b.getDate() < a.getDate()) m--;
  const y = Math.floor(m / 12), mm = m % 12;
  const pl = (n, f) => { const x = n % 100, z = x % 10; return x > 10 && x < 20 ? f[2] : z === 1 ? f[0] : z > 1 && z < 5 ? f[1] : f[2]; };
  return [y ? `${y} ${pl(y, ['год', 'года', 'лет'])}` : '', mm ? `${mm} мес` : ''].filter(Boolean).join(' ') || 'меньше месяца';
}

export const REPORT_CSS = `
.rep { font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #1c1c1e; background: #fff; max-width: 820px; margin: 0 auto; padding: 24px 20px 40px; }
.rep h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: -.01em; }
.rep h2 { font-size: 15px; margin: 26px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #1f7a5c; color: #1f7a5c; text-transform: uppercase; letter-spacing: .03em; }
.rep h3 { font-size: 14px; margin: 16px 0 6px; }
.rep .sub { color: #6e6e76; font-size: 13px; }
.rep .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 8px 16px; margin-top: 14px; }
.rep .facts div { border-left: 3px solid #e5e5ea; padding: 2px 0 2px 10px; }
.rep .facts b { display: block; font-size: 16px; overflow-wrap: anywhere; }
.rep .facts span { color: #6e6e76; font-size: 12px; }
.rep table { width: 100%; border-collapse: collapse; font-size: 13px; }
.rep th { text-align: left; font-weight: 600; color: #6e6e76; font-size: 11.5px; text-transform: uppercase; letter-spacing: .02em; padding: 6px 8px 6px 0; border-bottom: 1px solid #d1d1d6; }
.rep td { padding: 6px 8px 6px 0; border-bottom: 1px solid #ececf0; vertical-align: top; }
.rep td.n, .rep th.n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.rep td.d { white-space: nowrap; font-variant-numeric: tabular-nums; }
.rep .note { color: #6e6e76; font-size: 12px; }
.rep .over { color: #c62828; font-weight: 600; }
.rep .foot { margin-top: 28px; color: #8e8e93; font-size: 11.5px; border-top: 1px solid #e5e5ea; padding-top: 10px; }
.rep tr { break-inside: avoid; }
.rep h2, .rep h3 { break-after: avoid; }
@media (max-width: 560px) { .rep { padding: 16px 12px 32px; } .rep table { font-size: 12px; } .rep .hide-sm { display: none; } }
`;

/**
 * @param o.vehicle   машина {name, make, model, year, vin, plate}
 * @param o.expenses  расходы (alive, с income/workIds)
 * @param o.refuels   заправки (alive)
 * @param o.events    результат computeEvents().events
 * @param o.parts     [{part, usage}]
 * @param o.categories словарь категорий
 * @param o.include   Set id категорий, попадающих в хронологию
 * @param o.showCosts показывать суммы
 * @param o.summary   S.summary за всё время
 */
export function buildReport(o) {
  const { vehicle: v, expenses, refuels, events, parts, categories, include, showCosts, summary, todayIso } = o;
  const works = expenses
    .filter(e => !e.income && (include.has(e.categoryId || '_none') || (e.workIds || []).length && include.has('_works')))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.odo || 0) - (b.odo || 0));
  const allDates = [...refuels, ...expenses].map(r => r.date).sort();
  const first = allDates[0], lastOdoRec = [...refuels, ...expenses.filter(e => e.odo && !e.odoEstimated)].sort((a, b) => (b.odo || 0) - (a.odo || 0))[0];
  const total = works.reduce((s, e) => s + (e.total || 0), 0);
  const title = [v.make, v.model].filter(Boolean).join(' ') || v.name;

  const regular = events.filter(e => e.status !== 'done' && !e.once && e.count);
  const regRows = regular.map(e => {
    const interval = [e.work.everyKm ? `${nf(e.work.everyKm)} км` : '', e.work.everyMonths ? `${nf(e.work.everyMonths)} мес` : ''].filter(Boolean).join(' / ');
    const next = [e.dueKm != null ? `${nf(e.dueKm)} км` : '', e.dueDate ? dmy(e.dueDate) : ''].filter(Boolean).join(', ');
    const over = e.status === 'overdue';
    return `<tr><td>${esc(e.work.name)}</td><td class="hide-sm">${interval}</td>
      <td class="d">${dmy(e.last.date)}${e.last.odo ? `<br><span class="note">${nf(e.last.odo)} км</span>` : ''}</td>
      <td class="${over ? 'over' : ''}">${next || '—'}${over ? '<br><span class="note">срок прошёл</span>' : ''}</td>
      <td class="n hide-sm">${e.count}</td></tr>`;
  }).join('');

  const byYear = new Map();
  for (const e of works) {
    const y = e.date.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(e);
  }
  const chrono = [...byYear.entries()].reverse().map(([y, list]) => `
    <h3>${y} <span class="sub">· ${list.length} ${list.length % 10 === 1 && list.length % 100 !== 11 ? 'запись' : 'записей'}${showCosts ? ` · ${nf(list.reduce((s, e) => s + e.total, 0))} ₽` : ''}</span></h3>
    <table><tr><th>Дата</th><th class="n">Пробег</th><th>Работы</th>${showCosts ? '<th class="n">Сумма</th>' : ''}</tr>
    ${[...list].reverse().map(e => {
      const extra = [...new Set([e.kind, e.note].filter(Boolean).flatMap(x => x.split(/;\s*/)).map(x => x.trim()).filter(x => x && x !== e.title))].join('; ');
      return `<tr><td class="d">${dmy(e.date)}</td><td class="n">${e.odo ? (e.odoEstimated ? '≈ ' : '') + nf(e.odo) : '—'}</td>
        <td>${esc(e.title)}${extra ? `<br><span class="note">${esc(extra)}</span>` : ''}<br><span class="note">${esc(categories[e.categoryId]?.name || '')}</span></td>
        ${showCosts ? `<td class="n">${nf(e.total)} ₽</td>` : ''}</tr>`;
    }).join('')}</table>`).join('');

  const partRows = (parts || []).filter(x => x.usage.status !== 'retired').map(({ part: p, usage: u }) => `
    <tr><td>${esc(p.name)}${p.note ? `<br><span class="note">${esc(p.note)}</span>` : ''}</td>
      <td>${u.status === 'installed' ? 'установлена' : 'на хранении'}</td>
      <td class="n">${nf(u.km)} км${p.resourceKm ? `<br><span class="note">из ${nf(p.resourceKm)}</span>` : ''}</td>
      <td class="n hide-sm">${u.months != null ? nf(u.months / 12, 1) + ' г.' : '—'}</td>
      <td class="n">${u.wear != null ? nf(u.wear * 100) + '%' : '—'}</td></tr>`).join('');

  return `<div class="rep">
    <h1>История обслуживания автомобиля</h1>
    <div class="sub">${esc(title)}${v.year ? `, ${esc(v.year)} г.` : ''} · отчёт от ${dmy(todayIso)}</div>
    <div class="facts">
      ${v.vin ? `<div><b>${esc(v.vin)}</b><span>VIN</span></div>` : ''}
      ${v.plate ? `<div><b>${esc(v.plate)}</b><span>Госномер</span></div>` : ''}
      <div><b>${nf(lastOdoRec?.odo)} км</b><span>пробег на ${dmy(lastOdoRec?.date)}</span></div>
      ${first ? `<div><b>${duration(first, todayIso)}</b><span>учёт ведётся с ${dmy(first)}</span></div>` : ''}
      <div><b>${works.length}</b><span>записей о работах и ремонте</span></div>
      ${summary.avgL100 ? `<div><b>${nf(summary.avgL100, 1)} л/100 км</b><span>средний расход, ${refuels.length} заправок</span></div>` : ''}
      ${showCosts ? `<div><b>${nf(total)} ₽</b><span>на обслуживание и ремонт</span></div>` : ''}
    </div>
    ${regRows ? `<h2>Регламентные работы</h2>
      <table><tr><th>Работа</th><th class="hide-sm">Интервал</th><th>Последний раз</th><th>Следующий</th><th class="n hide-sm">Раз</th></tr>${regRows}</table>` : ''}
    ${partRows ? `<h2>Запчасти с ресурсом</h2>
      <table><tr><th>Деталь</th><th>Состояние</th><th class="n">Пробег</th><th class="n hide-sm">Возраст</th><th class="n">Износ</th></tr>${partRows}</table>` : ''}
    <h2>Хронология работ</h2>
    ${chrono || '<p class="sub">Нет записей в выбранных категориях.</p>'}
    <div class="foot">Отчёт сформирован в приложении «Бортжурнал» по записям, которые владелец вёл ${first ? `с ${dmy(first)}` : ''}. Пробег со знаком «≈» оценочный.</div>
  </div>`;
}
