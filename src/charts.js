const RESET = '\x1b[0m';
const COLORS = { blue: '\x1b[34m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', magenta: '\x1b[35m', red: '\x1b[31m' };
const BLOCKS = ' ▁▂▃▄▅▆▇█';
const HEAT = ['·', '░', '▒', '▓', '█'];

export function color(text, name, enabled = true) {
  return enabled && COLORS[name] ? `${COLORS[name]}${text}${RESET}` : text;
}

function localDay(input = new Date()) {
  const date = new Date(input);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function shiftDay(day, amount) {
  const shifted = new Date(day);
  shifted.setDate(shifted.getDate() + amount);
  return shifted;
}

function isoDay(day) {
  const local = localDay(day);
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
}

function totalsByDay(entries) {
  return entries.reduce((totals, entry) => ({ ...totals, [entry.date]: (totals[entry.date] || 0) + entry.minutes }), {});
}

function sparkline(values) {
  if (!values.length || !values.some(Boolean)) return '·'.repeat(Math.max(1, values.length));
  const peak = Math.max(...values);
  return values.map(value => BLOCKS[Math.round((value / peak) * (BLOCKS.length - 1))]).join('');
}

function label(day) {
  return `${day.toLocaleString('en', { month: 'short' })} ${day.getDate()}`;
}

export function cumulativeChart(entries, days = 30, endDate = null) {
  const end = localDay(endDate ? `${endDate}T12:00:00` : new Date());
  const start = shiftDay(end, -(days - 1));
  const dates = Array.from({ length: days }, (_, index) => shiftDay(start, index));
  const totals = totalsByDay(entries);
  const values = dates.map(day => totals[isoDay(day)] || 0);
  let current = 0;
  const cumulative = values.map(value => (current += value));
  const hours = values.reduce((sum, value) => sum + value, 0) / 60;
  const space = ' '.repeat(Math.max(1, days - 18));
  return [
    `  Daily time · last ${days} days (${hours.toFixed(1)}h)`,
    `  ${sparkline(values)}`,
    `  ${label(dates[0])}${space}${label(dates.at(-1))}`,
    `  Cumulative: ${sparkline(cumulative)}  ${(cumulative.at(-1) / 60).toFixed(1)}h total`
  ].join('\n');
}

export function historyCumulativeChart(entries, width = 52, endDate = null) {
  if (!entries.length) return cumulativeChart(entries, 30, endDate);
  const dates = entries.map(entry => localDay(`${entry.date}T00:00:00`));
  const start = new Date(Math.min(...dates));
  const end = new Date(Math.max(...dates));
  const span = Math.max(1, Math.round((end - start) / 86_400_000) + 1);
  const bucketDays = Math.ceil(span / width);
  const buckets = Array.from({ length: Math.ceil(span / bucketDays) }, () => 0);
  entries.forEach(entry => {
    const offset = Math.floor((localDay(`${entry.date}T00:00:00`) - start) / 86_400_000);
    buckets[Math.floor(offset / bucketDays)] += entry.minutes;
  });
  let current = 0;
  const cumulative = buckets.map(value => (current += value));
  const hours = cumulative.at(-1) / 60;
  const period = bucketDays === 1 ? 'daily' : `each ${bucketDays} days`;
  return [
    `  Time logged · entire history (${hours.toFixed(1)}h, ${period})`,
    `  ${sparkline(buckets)}`,
    `  ${label(start)}${' '.repeat(Math.max(1, buckets.length - 18))}${label(end)}`,
    `  Cumulative: ${sparkline(cumulative)}  ${hours.toFixed(1)}h total`
  ].join('\n');
}

export function heatmap(entries, weeks = 16, enabled = true, endDate = null) {
  const today = localDay();
  const latestEntry = endDate ? localDay(`${endDate}T12:00:00`) : entries.length ? new Date(Math.max(...entries.map(entry => localDay(`${entry.date}T00:00:00`)))) : today;
  const end = shiftDay(latestEntry, 6 - (latestEntry.getDay() + 6) % 7); // Sunday of the displayed week
  const start = shiftDay(end, -(weeks * 7 - 1));
  const totals = totalsByDay(entries);
  const maxMinutes = Math.max(0, ...Object.values(totals));
  const columns = Array.from({ length: weeks }, (_, week) => Array.from({ length: 7 }, (_, day) => shiftDay(start, week * 7 + day)));
  const cell = day => {
    const minutes = totals[isoDay(day)] || 0;
    const level = !minutes || !maxMinutes ? 0 : Math.min(4, Math.max(1, Math.round((minutes / maxMinutes) * 4)));
    return level ? color(HEAT[level], 'green', enabled) : HEAT[level];
  };
  const labels = ['Mon', '   ', 'Wed', '   ', 'Fri', '   ', 'Sun'];
  const months = columns.map(column => column[0].getDate() <= 7 ? column[0].toLocaleString('en', { month: 'short' })[0] : ' ').join(' ');
  return [
    `  Activity · last ${weeks} weeks`,
    `       ${months}`,
    ...labels.map((label, day) => `  ${label}  ${columns.map(column => cell(column[day])).join(' ')}`),
    `       ${HEAT.join('  ')}  less → more`
  ].join('\n');
}
