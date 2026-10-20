// События обслуживания («пул событий»): у вида работ есть интервал по пробегу и/или по времени.
// Следующий срок считается от последней записи расхода с этим видом работ, поэтому
// новая запись о выполнении автоматически «продлевает» событие на следующий интервал.

const DAY = 86400000;
const toTime = iso => Date.parse(iso + 'T12:00:00');
export const addDays = (iso, days) => new Date(toTime(iso) + Math.round(days) * DAY).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((toTime(b) - toTime(a)) / DAY);
export function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const whole = Math.trunc(months), frac = months - whole;
  const t = new Date(Date.UTC(y, m - 1 + whole, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  const base = t.toISOString().slice(0, 10);
  return frac ? addDays(base, frac * 30.44) : base;
}

export function hasSchedule(w) {
  return !!(w.everyKm || w.everyMonths || w.onceKm || w.onceDate);
}

// Средний пробег в день: по записям за последний год (если их мало — за всё время).
export function kmPerDay(points, todayIso) {
  const pts = points.filter(p => p.odo && p.date).sort((a, b) => a.date.localeCompare(b.date) || a.odo - b.odo);
  if (pts.length < 2) return null;
  const yearAgo = addDays(todayIso, -365);
  let use = pts.filter(p => p.date >= yearAgo);
  if (use.length < 2 || daysBetween(use[0].date, use[use.length - 1].date) < 60) use = pts;
  const a = use[0], b = use[use.length - 1];
  const days = daysBetween(a.date, b.date);
  return days > 0 && b.odo > a.odo ? (b.odo - a.odo) / days : null;
}

// Текущее положение: последний известный пробег и дата этой записи.
export function currentPosition(points) {
  let best = null;
  for (const p of points) if (p.odo && (!best || p.odo > best.odo)) best = p;
  return best ? { odo: best.odo, date: best.date } : null;
}

/**
 * @param works     виды работ (alive)
 * @param expenses  расходы машины (alive), с полем workIds
 * @param refuels   заправки машины (alive)
 * @returns массив событий, отсортированный по срочности
 */
export function computeEvents(works, expenses, refuels, todayIso, { soonDays = 30, soonKm = 1000 } = {}) {
  const points = [...refuels.map(r => ({ odo: r.odo, date: r.date })),
    ...expenses.filter(e => e.odo && !e.odoEstimated).map(e => ({ odo: e.odo, date: e.date }))];
  const rate = kmPerDay(points, todayIso);
  const cur = currentPosition(points);
  const curOdoToday = cur && rate ? cur.odo + Math.max(0, daysBetween(cur.date, todayIso)) * rate : cur?.odo ?? null;

  const byWork = new Map();
  for (const e of expenses) for (const wid of e.workIds || []) {
    if (!byWork.has(wid)) byWork.set(wid, []);
    byWork.get(wid).push(e);
  }

  const events = [];
  for (const w of works) {
    if (!w.remind || !hasSchedule(w)) continue;
    const done = (byWork.get(w.id) || []).sort((a, b) => a.date.localeCompare(b.date) || (a.odo || 0) - (b.odo || 0));
    const last = done[done.length - 1] || null;
    const once = !w.everyKm && !w.everyMonths;
    const ev = { work: w, count: done.length, last, history: done, once };

    if (once && done.length) { ev.status = 'done'; events.push(ev); continue; }

    // Плановый срок по пробегу и по дате. Без истории считаем от начала учёта.
    const fromOdo = last ? (last.odo ?? null) : null;
    const fromDate = last ? last.date : null;
    if (once) {
      ev.dueKm = w.onceKm || null;
      ev.dueDate = w.onceDate || null;
    } else {
      ev.dueKm = w.everyKm && fromOdo != null ? fromOdo + w.everyKm : null;
      ev.dueDate = w.everyMonths && fromDate ? addMonths(fromDate, w.everyMonths) : null;
      if (!last) ev.neverDone = true;
    }
    if (ev.dueKm == null && ev.dueDate == null) { ev.status = 'unknown'; events.push(ev); continue; }

    // Остатки. Пробег считаем от последней записи (как Car Expenses), дни — от сегодня.
    if (ev.dueKm != null && cur) ev.leftKm = ev.dueKm - cur.odo;
    if (ev.dueDate) ev.leftDays = daysBetween(todayIso, ev.dueDate);

    // Оценки для второй оси: когда наступит пробег / какой будет пробег к дате.
    if (ev.dueKm != null && !ev.dueDate && cur && rate) {
      ev.estDate = addDays(cur.date, (ev.dueKm - cur.odo) / rate);
      ev.estDays = daysBetween(todayIso, ev.estDate);
    }
    if (ev.dueDate && ev.dueKm == null && cur && rate) {
      ev.estKm = Math.round(cur.odo + daysBetween(cur.date, ev.dueDate) * rate);
      ev.estLeftKm = ev.estKm - cur.odo;
    }

    // Срочность в днях: минимум из срока по дате и оценки по пробегу.
    const kmDays = ev.leftKm != null && rate ? daysBetween(todayIso, addDays(cur.date, ev.leftKm / rate)) : null;
    const cand = [ev.leftDays, kmDays].filter(v => v != null);
    ev.urgencyDays = cand.length ? Math.min(...cand) : Infinity;

    // Доля пройденного интервала — для полоски прогресса.
    const fr = [];
    if (w.everyKm && fromOdo != null && curOdoToday != null) fr.push((cur.odo - fromOdo) / w.everyKm);
    if (w.everyMonths && fromDate) fr.push(daysBetween(fromDate, todayIso) / Math.max(1, daysBetween(fromDate, ev.dueDate)));
    ev.progress = fr.length ? Math.max(0, Math.min(1, Math.max(...fr))) : null;

    const overdue = (ev.leftKm != null && ev.leftKm < 0) || (ev.leftDays != null && ev.leftDays < 0);
    const soon = (ev.leftKm != null && ev.leftKm <= soonKm) || ev.urgencyDays <= soonDays;
    ev.status = overdue ? 'overdue' : soon ? 'soon' : 'ok';
    events.push(ev);
  }

  const rank = { overdue: 0, soon: 1, ok: 2, unknown: 3, done: 4 };
  events.sort((a, b) => rank[a.status] - rank[b.status] || (a.urgencyDays ?? 1e9) - (b.urgencyDays ?? 1e9) || a.work.name.localeCompare(b.work.name, 'ru'));
  return { events, rate, cur };
}

// Файл календаря (.ics) с напоминаниями за неделю и за день до срока.
export function eventsToIcs(items, vehicleName) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const escIcs = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Bortzhurnal//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const it of items) {
    const d = it.date.replace(/-/g, '');
    const next = addDays(it.date, 1).replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:${it.uid}@bortzhurnal`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next}`,
      `SUMMARY:${escIcs(`${vehicleName}: ${it.title}`)}`, `DESCRIPTION:${escIcs(it.description || '')}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escIcs(it.title)}`, 'TRIGGER:-P7D', 'END:VALARM',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escIcs(it.title)}`, 'TRIGGER:-P1D', 'END:VALARM',
      'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
