// Расчёты: расход топлива по методу «полный бак», стоимость километра, сводки по годам и категориям.

export function sortRefuels(list) {
  return [...list].sort((a, b) => (a.odo - b.odo) || a.date.localeCompare(b.date));
}

// Для каждой заправки до полного бака считаем расход на участке от предыдущей полной заправки:
// все литры, залитые после неё (включая текущую), делим на пройденное расстояние.
// Если между ними отмечен пропуск записи (missed), участок не считаем.
export function withConsumption(refuels) {
  const sorted = sortRefuels(refuels);
  const res = new Map();
  let lastFull = null, litresSince = 0, broken = false;
  for (const r of sorted) {
    if (lastFull === null) {
      if (r.full) { lastFull = r; litresSince = 0; broken = false; }
      continue;
    }
    litresSince += r.litres;
    if (r.missed) broken = true;
    if (r.full) {
      const dist = r.odo - lastFull.odo;
      if (!broken && dist > 0) {
        res.set(r.id, { distance: dist, litres: litresSince, l100: litresSince / dist * 100 });
      }
      lastFull = r; litresSince = 0; broken = false;
    }
  }
  return res;
}

export function summary(refuels, expenses, { from = null, to = null } = {}) {
  const inRange = d => (!from || d >= from) && (!to || d <= to);
  const cons = withConsumption(refuels);
  const fuelRows = refuels.filter(r => inRange(r.date));
  const expRows = expenses.filter(e => inRange(e.date));

  let consLitres = 0, consDist = 0;
  for (const r of fuelRows) {
    const c = cons.get(r.id);
    if (c) { consLitres += c.litres; consDist += c.distance; }
  }
  const fuelCost = fuelRows.reduce((s, r) => s + (r.total || 0), 0);
  const litres = fuelRows.reduce((s, r) => s + (r.litres || 0), 0);
  const expCost = expRows.filter(e => !e.income).reduce((s, e) => s + (e.total || 0), 0);
  const income = expRows.filter(e => e.income).reduce((s, e) => s + (e.total || 0), 0);

  // Пробег за период: по всем записям с одометром (заправки надёжнее, расходы — дополнение).
  const odos = [...fuelRows.map(r => r.odo), ...expRows.filter(e => e.odo && !e.odoEstimated).map(e => e.odo)].filter(Boolean);
  let distance = 0;
  if (odos.length) {
    // берём одометр последней записи до периода, чтобы пробег периода считался от неё
    const before = sortRefuels(refuels).filter(r => from && r.date < from).pop();
    const start = before ? before.odo : Math.min(...odos);
    distance = Math.max(...odos) - start;
  }

  return {
    fuelCost, expCost, income, litres,
    total: fuelCost + expCost,
    refuelCount: fuelRows.length,
    expenseCount: expRows.length,
    avgL100: consDist > 0 ? consLitres / consDist * 100 : null,
    avgPrice: litres > 0 ? fuelCost / litres : null,
    distance,
    costPerKm: distance > 0 ? (fuelCost + expCost) / distance : null,
    fuelPerKm: distance > 0 ? fuelCost / distance : null,
  };
}

export function byYear(refuels, expenses) {
  const years = new Set([...refuels, ...expenses].map(r => r.date.slice(0, 4)));
  return [...years].sort().map(y => ({ year: y, ...summary(refuels, expenses, { from: `${y}-01-01`, to: `${y}-12-31` }) }));
}

export function byCategory(expenses, categories) {
  const map = new Map();
  for (const e of expenses) {
    if (e.income) continue;
    const key = e.categoryId || '_none';
    map.set(key, (map.get(key) || 0) + (e.total || 0));
  }
  return [...map.entries()]
    .map(([id, total]) => ({ id, name: categories[id]?.name || 'Без категории', color: categories[id]?.color || '#8b8d98', total }))
    .sort((a, b) => b.total - a.total);
}

export function lastOdo(refuels, expenses) {
  const vals = [...refuels.map(r => r.odo), ...expenses.map(e => e.odo)].filter(Boolean);
  return vals.length ? Math.max(...vals) : null;
}
