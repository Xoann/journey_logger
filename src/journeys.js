import { ensureEntryIds } from './storage.js';
import { parseAmount } from './amount.js';
import { categoriesOf, categoryOf, UNCLASSIFIED, validateCategory } from './categories.js';
import { shiftDay, trackingDay, validDate } from './days.js';
export { dayString, shiftDay, validDate } from './days.js';

export const PALETTE = ['blue', 'cyan', 'green', 'yellow', 'magenta', 'red'];
export const UNITS = ['minutes', 'pages', 'words', 'reps', 'km', 'sessions'];
export const unitOf = activity => activity?.unit || 'minutes';
export const amountOf = entry => entry.amount ?? entry.minutes ?? 0;
export const number = value => new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value);
export const quantity = (value, unit, hours = false) => unit === 'minutes'
  ? `${number(hours ? value / 60 : value)} ${hours ? 'h' : 'min'}` : `${number(value)} ${unit}`;
export function findJourney(data, name) {
  const item = data.activities.find(a => a.name.toLowerCase() === String(name).toLowerCase());
  if (!item) throw new Error(`Unknown journey '${name}'.`);
  return item;
}
function positive(value, label) {
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0) throw new Error(`${label} must be a positive number.`);
  return result;
}
// A null date preserves the goal used for all days before history was recorded.
export function goalHistoryOf(activity) {
  return activity.goalHistory ?? [{ date: null, goal: activity.goal ?? null }];
}
export function goalOn(activity, date) {
  let goal = null;
  for (const change of goalHistoryOf(activity)) {
    if (change.date == null || change.date <= date) goal = change.goal;
    else break;
  }
  return goal;
}
export function configureJourney(data, originalName, settings, effectiveDate = trackingDay(data)) {
  validDate(effectiveDate);
  const existing = originalName == null ? null : findJourney(data, originalName);
  const name = String(settings.name ?? existing?.name ?? '').trim();
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Use a journey name of 1–80 characters, without control characters.');
  if (data.activities.some(a => a !== existing && a.name.toLowerCase() === name.toLowerCase())) throw new Error(`Journey '${name}' already exists.`);
  const unit = settings.unit ?? unitOf(existing);
  if (!UNITS.includes(unit)) throw new Error(`Unit must be one of: ${UNITS.join(', ')}.`);
  const color = settings.color ?? existing?.color ?? 'cyan';
  if (!PALETTE.includes(color)) throw new Error(`Color must be one of: ${PALETTE.join(', ')}.`);
  if (existing && unit !== unitOf(existing) && data.entries.some(e => e.activity === existing.name)) throw new Error('Units cannot change once a journey has logs. Create a new journey for a different measurement.');
  const rawGoal = settings.goal === undefined ? existing && goalOn(existing, effectiveDate) : settings.goal;
  const goal = rawGoal == null || rawGoal === '' ? null : positive(rawGoal, 'Daily goal');
  // With no logs yet, switching measurements starts a fresh goal history.
  let goalHistory = existing && unit === unitOf(existing) ? goalHistoryOf(existing) : [];
  if (!existing || unit !== unitOf(existing) || goal !== goalOn(existing, effectiveDate)) {
    goalHistory = [...goalHistory.filter(change => change.date !== effectiveDate), { date: effectiveDate, goal }]
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  }
  if (existing) {
    for (const entry of data.entries) if (entry.activity === existing.name) entry.activity = name;
    Object.assign(existing, { name, color, unit, goal: goalHistory.at(-1).goal, goalHistory });
    return existing;
  }
  const activity = { name, color, unit, goal, goalHistory };
  data.activities.push(activity);
  return activity;
}
export function addLog(data, name, amount, date = trackingDay(data), categoryId = null) {
  const activity = findJourney(data, name);
  const value = parseAmount(amount);
  validDate(date);
  validateCategory(activity, categoryId);
  ensureEntryIds(data);
  const entry = { id: data.nextEntryId++, activity: activity.name, date };
  if (unitOf(activity) === 'minutes') entry.minutes = value;
  else entry.amount = value;
  if (categoryId != null) entry.categoryId = categoryId;
  data.entries.push(entry);
  return entry;
}
export function editLog(data, id, { amount, date, categoryId }) {
  const entry = data.entries.find(item => item.id === id);
  if (!entry) throw new Error(`No log with ID ${id}.`);
  const activity = findJourney(data, entry.activity);
  const value = parseAmount(amount);
  validDate(date);
  if (categoryId === undefined) categoryId = entry.categoryId ?? null;
  validateCategory(activity, categoryId, categoryId === entry.categoryId);
  entry.date = date;
  entry[unitOf(activity) === 'minutes' ? 'minutes' : 'amount'] = value;
  if (categoryId == null) delete entry.categoryId;
  else entry.categoryId = categoryId;
  return entry;
}
export function removeLog(data, id) {
  ensureEntryIds(data);
  const index = data.entries.findIndex(e => e.id === Number(id));
  if (index < 0) throw new Error(`No log with ID ${id}.`);
  return data.entries.splice(index, 1)[0];
}
export function removeJourney(data, name, force = false) {
  const activity = findJourney(data, name);
  const count = data.entries.filter(e => e.activity === activity.name).length;
  if (count && !force) throw new Error(`This journey has ${count} logs. Confirm deletion to remove them too.`);
  data.entries = data.entries.filter(e => e.activity !== activity.name);
  data.activities = data.activities.filter(a => a !== activity);
}
export function importCsv(data, name, csv) {
  const activity = findJourney(data, name);
  const rows = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter(row => row.trim());
  const pending = rows.map((row, i) => {
    const [rawDate, rawAmount] = row.split(',').map(v => v.trim());
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(rawDate);
    const date = match ? `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}` : rawDate;
    try {
      validDate(date);
      if (!/^\d+(\.\d+)?$/.test(rawAmount || '') || !Number.isFinite(Number(rawAmount))) throw new Error('Invalid amount.');
    } catch { throw new Error(`Invalid CSV row ${i + 1}. Expected M/D/YYYY,amount or YYYY-MM-DD,amount.`); }
    return { activity: activity.name, date, [unitOf(activity) === 'minutes' ? 'minutes' : 'amount']: Number(rawAmount) };
  });
  data.entries.push(...pending);
  ensureEntryIds(data);
  return pending.length;
}

function goalStreaks(activity, totals, end) {
  const hitDates = [...totals].filter(([date, amount]) => {
    const goal = goalOn(activity, date);
    return goal > 0 && amount >= goal;
  }).map(([date]) => date).sort();
  let run = 0, bestStreak = 0, previous = null;
  for (const date of hitDates) {
    run = previous && shiftDay(previous, 1) === date ? run + 1 : 1;
    bestStreak = Math.max(bestStreak, run);
    previous = date;
  }
  // An unfinished today keeps yesterday's run alive; a day without a goal cannot.
  const currentStreak = goalOn(activity, end) > 0 && (previous === end || previous === shiftDay(end, -1)) ? run : 0;
  return { currentStreak, bestStreak };
}

// Calendar days count for averages; goal percentages include only days with a goal.
export function statistics(data, name, days = 30, end = trackingDay(data)) {
  const activity = findJourney(data, name);
  validDate(end);
  const entries = data.entries.filter(e => e.activity === activity.name && e.date <= end);
  const first = entries.reduce((date, entry) => entry.date < date ? entry.date : date, end);
  if (days !== 'all' && (!Number.isInteger(days) || days < 1 || days > 36500)) throw new Error('Choose a range of 1–36500 days, or all.');
  const start = days === 'all' ? first : shiftDay(end, 1 - days);
  const totals = new Map();
  for (const entry of entries) totals.set(entry.date, (totals.get(entry.date) || 0) + amountOf(entry));
  const daily = [];
  let total = 0, activeDays = 0, goalDays = 0, goalEligibleDays = 0;
  for (let date = start; date <= end; date = shiftDay(date, 1)) {
    const amount = totals.get(date) || 0;
    const goal = goalOn(activity, date), goalMet = goal > 0 && amount >= goal;
    total += amount;
    if (amount > 0) activeDays++;
    if (goal > 0) goalEligibleDays++;
    if (goalMet) goalDays++;
    daily.push({ date, amount, cumulative: total, goal, goalMet });
  }
  return { activity, start, end, daily, total, days: daily.length, activeDays, goalDays, goalEligibleDays,
    average: total / daily.length, activeAverage: activeDays ? total / activeDays : 0,
    activePercent: activeDays / daily.length * 100,
    goalPercent: goalEligibleDays ? goalDays / goalEligibleDays * 100 : null,
    ...goalStreaks(activity, totals, end),
    lifetime: entries.reduce((sum, entry) => sum + amountOf(entry), 0) };
}

export function categoryStatistics(data, name, days = 30, end = trackingDay(data)) {
  const stats = statistics(data, name, days, end), activity = stats.activity;
  const entries = data.entries.filter(entry => entry.activity === activity.name && entry.date <= end);
  const definitions = [...categoriesOf(activity)];
  if (!definitions.length || entries.some(entry => categoryOf(activity, entry.categoryId).id == null)) definitions.push(UNCLASSIFIED);
  const series = definitions.map(category => ({ ...category, total: 0, lifetime: 0, daily: [], totals: new Map() }));
  const byId = new Map(series.map(item => [item.id, item]));
  for (const entry of entries) {
    const item = byId.get(categoryOf(activity, entry.categoryId).id), amount = amountOf(entry);
    item.lifetime += amount;
    if (entry.date >= stats.start) item.totals.set(entry.date, (item.totals.get(entry.date) || 0) + amount);
  }
  for (const item of series) {
    item.daily = stats.daily.map(day => {
      const amount = item.totals.get(day.date) || 0;
      item.total += amount;
      return { date: day.date, amount, cumulative: item.total };
    });
    delete item.totals;
  }
  return { ...stats, series };
}

export function currentDayProgress(data, name, now = new Date()) {
  const activity = findJourney(data, name), date = trackingDay(data, now);
  const amount = data.entries.filter(entry => entry.activity === activity.name && entry.date === date)
    .reduce((total, entry) => total + amountOf(entry), 0);
  const goal = goalOn(activity, date);
  return { activity, date, amount, goal, goalMet: goal > 0 && amount >= goal,
    remaining: goal > 0 ? Math.max(0, goal - amount) : null };
}
