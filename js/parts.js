// Запчасти с ресурсом: шины, аккумулятор, колодки и т.п.
// Ресурс задаётся пробегом и/или сроком службы. Пробег копится только пока деталь установлена,
// поэтому сезонные комплекты (летние/зимние шины) считаются честно.
import { daysBetween } from './events.js';

const MONTH_DAYS = 30.44;

export function partStatus(p) {
  if (p.retiredDate) return 'retired';
  const last = (p.installs || [])[p.installs?.length - 1];
  if (last && !last.offDate) return 'installed';
  return (p.installs || []).length ? 'stored' : 'new';
}

export const STATUS_LABEL = { installed: 'установлена', stored: 'на хранении', new: 'не установлена', retired: 'списана' };

export function partUsage(p, cur, todayIso) {
  const installs = p.installs || [];
  let km = 0;
  for (const it of installs) {
    const end = it.offOdo ?? (cur?.odo ?? it.onOdo);
    if (it.onOdo != null && end != null) km += Math.max(0, end - it.onOdo);
  }
  const start = p.buyDate || installs[0]?.onDate || null;
  const end = p.retiredDate || todayIso;
  const months = start ? Math.max(0, daysBetween(start, end) / MONTH_DAYS) : null;
  const wearKm = p.resourceKm ? km / p.resourceKm : null;
  const wearTime = p.resourceMonths && months != null ? months / p.resourceMonths : null;
  const wear = [wearKm, wearTime].filter(v => v != null);
  return {
    status: partStatus(p),
    km, months,
    wearKm, wearTime,
    wear: wear.length ? Math.max(...wear) : null,
    leftKm: p.resourceKm ? p.resourceKm - km : null,
    leftMonths: p.resourceMonths && months != null ? p.resourceMonths - months : null,
  };
}
