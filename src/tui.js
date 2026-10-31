import readline from 'node:readline';
import { readFileSync } from 'node:fs';
import { dataPath, ensureEntryIds, load, save } from './storage.js';
import { addLog, amountOf, categoryStatistics, configureJourney, currentDayProgress, editLog, findJourney, goalHistoryOf, goalOn, importCsv, number, PALETTE, quantity, removeJourney, removeLog, shiftDay, statistics, UNITS, unitOf } from './journeys.js';
import { configureDayReset, dayResetTime, resolveLogDate, trackingDay } from './days.js';
import { archiveCategory, categoriesOf, categoryOf, CATEGORY_COLORS, configureCategory, UNCLASSIFIED } from './categories.js';
import { clean, fit, paint, pane } from './terminal.js';
import { categoryPlot, plot } from './plot.js';

export const VIEWS = ['Overview', 'Trends', 'Calendar', 'History', 'Settings'];
export const RANGES = [7, 30, 90, 365, 'all'];
export function initialState(data) {
  return { data, journey: 0, view: 0, range: 30, calendarOffset: 0, cumulative: true, categoryTrends: false, categoryIndex: 0, categoryManagerIndex: null, cursor: null, historyIndex: 0, goalHistoryOffset: null, message: '', form: null, confirm: null };
}
const selected = state => state.data.activities[state.journey];
const logsFor = state => state.data.entries.filter(e => e.activity === selected(state)?.name).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
const field = (label, value = '', options = null) => ({ label, value: String(value ?? ''), options });
const percent = value => `${number(value)}%`;

function overview(stats, width, height, color) {
  const { activity } = stats, unit = unitOf(activity);
  const q = value => quantity(value, unit);
  const col = Math.floor((width - 4) / 2);
  const pair = (a, b) => ` ${fit(a, col)}  ${b}`;
  const lines = [
    pair(paint('TOTAL THIS PERIOD', 'muted', color), paint('DAILY AVERAGE', 'muted', color)),
    pair(paint(quantity(stats.total, unit, true), 'bright', color), paint(q(stats.average), 'bright', color)),
    pair(`${stats.days} calendar days`, 'Includes days with no activity'), '',
    pair(paint('ACTIVE-DAY AVERAGE', 'muted', color), paint('DAYS ACTIVE', 'muted', color)),
    pair(paint(q(stats.activeAverage), 'bright', color), paint(percent(stats.activePercent), 'green', color)),
    pair(`${stats.activeDays} days with activity`, `${stats.activeDays} / ${stats.days} days`), '',
    pair(paint('GOAL ACHIEVED', 'muted', color), paint('LIFETIME TOTAL', 'muted', color)),
    pair(paint(stats.goalPercent == null ? 'No goals in range' : percent(stats.goalPercent), 'yellow', color), paint(quantity(stats.lifetime, unit, true), 'bright', color)),
    pair(stats.goalPercent == null ? 'Press S to set a goal' : `${stats.goalDays} / ${stats.goalEligibleDays} goal days`, 'Through today'), '',
    pair(paint('CURRENT STREAK', 'muted', color), paint('LONGEST STREAK', 'muted', color)),
    pair(paint(`${stats.currentStreak} days`, 'green', color), paint(`${stats.bestStreak} days`, 'bright', color)),
    pair(stats.daily.at(-1).goalMet ? 'Today: goal met' : goalOn(activity, stats.end) > 0 ? 'Today: in progress' : 'Today: no goal', 'All time'),
  ];
  if (height >= 23) lines.push('', ...plot(stats, { width: width - 2, height: height - 19, color, cumulative: true }));
  else if (height > 15) lines.push(' Open Trends [2] for the graph.');
  return lines;
}

function calendar(stats, width, height, color, offset = 0) {
  const unit = unitOf(stats.activity);
  // Show the latest whole weeks that fit. The statistics always use the full range.
  const firstWeekday = (new Date(`${stats.start}T12:00:00`).getDay() + 6) % 7;
  const columns = Math.max(1, Math.min(52, Math.floor((width - 7) / 2), Math.ceil((stats.days + firstWeekday) / 7)));
  const end = shiftDay(stats.end, -7 * offset);
  const weekday = (new Date(`${end}T12:00:00`).getDay() + 6) % 7;
  const lastSunday = shiftDay(end, 6 - weekday);
  const start = shiftDay(lastSunday, -(columns * 7 - 1));
  const daily = new Map(stats.daily.map(day => [day.date, day]));
  const max = Math.max(1, ...stats.daily.map(day => day.amount));
  const monthCells = Array(columns * 2).fill(' ');
  let lastMonth = '';
  for (let w = 0; w < columns; w++) {
    const weekStart = shiftDay(start, w * 7);
    const date = weekStart < stats.start ? stats.start : weekStart, month = date.slice(0, 7);
    const label = new Date(`${date}T12:00:00`).toLocaleString('en', { month: 'short' });
    const shortFirstMonth = w === 0 && columns > 1 && shiftDay(start, 7).slice(0, 7) !== month;
    if (!shortFirstMonth && month !== lastMonth && w * 2 + 3 <= monthCells.length) [...label].forEach((char, i) => { monthCells[w * 2 + i] = char; });
    lastMonth = month;
  }
  const lines = [' ACTIVITY CALENDAR', ` ${start} → ${end} · blank = outside range`, `      ${monthCells.join('')}`];
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  for (let d = 0; d < 7; d++) {
    let row = ` ${labels[d]}  `;
    for (let w = 0; w < columns; w++) {
      const date = shiftDay(start, w * 7 + d);
      const day = daily.get(date), value = day?.amount;
      const hit = day?.goalMet;
      row += value == null ? '  ' : paint(hit ? '◆ ' : value === 0 ? '· ' : value / max < .34 ? '░ ' : value / max < .67 ? '▒ ' : '▓ ', hit ? 'green' : value ? stats.activity.color : 'border', color);
    }
    lines.push(row);
  }
  lines.push(' · Zero    ░ ▒ ▓ Less → more    ◆ Goal met', '', ' MONTHLY TOTALS · within selected range');
  const monthly = new Map();
  for (const day of stats.daily) monthly.set(day.date.slice(0, 7), (monthly.get(day.date.slice(0, 7)) || 0) + day.amount);
  const rows = [...monthly].reverse().filter(([month]) => month <= end.slice(0, 7));
  const peak = Math.max(1, ...rows.map(([, value]) => value));
  const barWidth = Math.max(4, width - 38);
  const shown = Math.max(0, height - lines.length - (rows.length > height - lines.length ? 1 : 0));
  for (const [month, value] of rows.slice(0, shown)) lines.push(` ${month}  ${fit(quantity(value, unit, true), 18)} ${paint('━'.repeat(Math.round(value / peak * barWidth)), stats.activity.color, color)}`);
  if (rows.length > shown) lines.push(' More months: ←/→ scroll weeks · PgUp/PgDn jump · Home/End');
  return lines;
}

function history(state, width, height, color) {
  const logs = logsFor(state), unit = unitOf(selected(state));
  const pageSize = Math.max(1, height - 5);
  const index = Math.min(state.historyIndex, Math.max(0, logs.length - 1));
  const start = Math.floor(index / pageSize) * pageSize;
  const lines = [' ALL LOGS · newest first', ' ↑/↓ Select   Enter Edit   D Delete   L Add', '', paint(`   ${fit('ID', 5)} ${fit('DATE', 10)} ${fit('AMOUNT', 12)} CATEGORY`, 'muted', color)];
  if (!logs.length) lines.push(' No logs yet. Press L to record your first one.');
  logs.slice(start, start + pageSize).forEach((entry, i) => {
    const category = categoryOf(selected(state), entry.categoryId);
    lines.push(paint(` ${start + i === index ? '›' : ' '} ${fit(entry.id, 5)} ${fit(entry.date, 10)} ${fit(quantity(amountOf(entry), unit), 12)} `, start + i === index ? 'bright' : 'muted', color)
      + paint(fit(clean(category.name), Math.max(1, width - 33)), category.color, color));
  });
  if (logs.length) lines.push(` ${start + 1}–${Math.min(start + pageSize, logs.length)} of ${logs.length} logs`);
  return lines;
}

function settings(state, color) {
  const activity = selected(state), unit = unitOf(activity);
  const goal = goalOn(activity, trackingDay(state.data));
  return [' JOURNEY SETTINGS', ` Name         ${clean(activity.name)}`, ` Measurement  ${unit}`, ` Daily goal   ${goal ? quantity(goal, unit) : 'Not set'}`,
    ` Color        ${paint(activity.color, activity.color, color)}`, '', ' E Edit settings   N New journey', ' I Import CSV      D Delete journey', ' C Categories · names and hex colours',
    ' H Goal history', ` T Day reset (all journeys): ${dayResetTime(state.data)}`, ' Goal changes start today.', ' Past days keep their goals.', ' DATA FILE', ` ${clean(dataPath())}`];
}

function categoryManager(state, width, height, color) {
  const categories = categoriesOf(selected(state)), count = Math.max(1, height - 6);
  const index = Math.min(state.categoryManagerIndex, Math.max(0, categories.length - 1));
  const start = Math.floor(index / count) * count;
  const lines = [' CATEGORIES', ' N New   Enter Edit   A Archive / Restore', ' ↑/↓ Select   Esc Back to settings', ' Archived categories keep their past logs.', ''];
  if (!categories.length) lines.push(' No categories yet. Press N to add one.');
  for (const [i, category] of categories.slice(start, start + count).entries()) {
    lines.push(` ${start + i === index ? '›' : ' '} ${paint('●', category.color, color)} ${fit(clean(category.name), width - 27)} ${paint(category.color, category.color, color)}${category.archived ? ' archived' : ''}`);
  }
  if (categories.length) lines.push(` ${start + 1}–${Math.min(start + count, categories.length)} of ${categories.length}`);
  return lines;
}

function categoryTrends(state, stats, width, height, color) {
  const index = Math.min(state.categoryIndex, stats.series.length - 1);
  const cursor = Math.min(state.cursor ?? stats.daily.length - 1, stats.daily.length - 1);
  const count = Math.min(stats.series.length, Math.max(1, Math.min(5, height - 12)));
  const start = Math.floor(index / count) * count, unit = unitOf(stats.activity);
  const total = stats.daily[cursor].cumulative;
  const lines = [' CUMULATIVE BY CATEGORY', ' B Overall   ↑/↓ Category   ←/→ Day',
    ...categoryPlot(stats, { width: width - 2, height: Math.max(4, height - count - 8), color, cursor, selected: index }),
    ` ${stats.daily[cursor].date} · totals since ${stats.start}`];
  for (const [i, item] of stats.series.slice(start, start + count).entries()) {
    const amount = item.daily[cursor].cumulative;
    const label = `${clean(item.name)}${item.archived ? ' (archived)' : ''}`;
    lines.push(` ${start + i === index ? '›' : ' '} ${paint('● ' + fit(label, width - 24), item.color, color)} ${fit(quantity(amount, unit, true), 10)} ${percent(total ? amount / total * 100 : 0)}`);
  }
  lines.push(` ${start + 1}–${Math.min(start + count, stats.series.length)} of ${stats.series.length} · R Range · Settings → C to configure`);
  return lines;
}

function goalHistoryContent(state, height) {
  const activity = selected(state), changes = [...goalHistoryOf(activity)].reverse();
  const count = Math.max(1, height - 6), offset = Math.min(state.goalHistoryOffset, Math.max(0, changes.length - 1));
  return [' GOAL HISTORY · newest first', ' Effective from each date shown.', ' Earlier days use the previously saved goal.', '',
    ...changes.slice(offset, offset + count).map(change => ` ${change.date ?? 'Earlier days'}  ·  ${change.goal == null ? 'No goal' : quantity(change.goal, unitOf(activity))}`),
    ` ${offset + 1}–${Math.min(offset + count, changes.length)} of ${changes.length} · ↑/↓ Scroll`, ' Esc / H Back to settings'];
}

function formContent(form, width, color) {
  const lines = [paint(` ${form.title}`, 'bright', color), '', ...form.help.map(s => ` ${s}`), ''];
  form.fields.forEach((item, i) => {
    lines.push(paint(` ${i === form.index ? '›' : ' '} ${item.label}`, i === form.index ? 'accent' : 'muted', color));
    lines.push(`   ${fit(`${clean(item.value) || '—'}${i === form.index && !item.options ? '▏' : ''}${item.options ? '   ‹ ›' : ''}`, width - 6)}`);
  });
  lines.push(paint(' Enter Next/Save   Ctrl+S Save   Esc Cancel', 'muted', color), ' Tab Move   ←/→ Choices   Ctrl+U Clear');
  if (form.error) lines.push(paint(` ${clean(form.error)}`, 'red', color));
  return lines;
}

export function renderApp(state, { width = 110, height = 36, color = true } = {}) {
  width = Math.max(1, width); height = Math.max(1, height);
  if (width < 74 || height < 24) return [paint(' JOURNEY LOGGER', 'bright', color), '', ' Enlarge the terminal to at least 74 columns × 24 rows.', ` Current size: ${width} × ${height}.  Q quits.`].slice(0, height).map(line => fit(line, width - 1)).join('\n');
  const activity = selected(state);
  const sideWidth = width >= 95 ? 24 : 19, mainWidth = width - sideWidth - 3, bodyHeight = height - 7;
  const p = (text, shade) => paint(text, shade, color);
  const range = state.range === 'all' ? 'All time' : `Last ${state.range} days`;
  const today = activity ? currentDayProgress(state.data, activity.name) : null;
  const todayText = !today ? 'Small steps. A visible journey.' : today.goal > 0
    ? `Today: ${number(today.amount)} / ${quantity(today.goal, unitOf(activity))} · ${today.goalMet ? 'Goal met!' : `${quantity(today.remaining, unitOf(activity))} left`}`
    : `Today: ${quantity(today.amount, unitOf(activity))} · No goal set`;
  const header = ` ${p('JOURNEY LOGGER', 'bright')}   ${p(todayText, today?.goalMet ? 'green' : 'yellow')}`;
  const tabs = ' ' + VIEWS.map((view, i) => p(`${i + 1} ${view}`, state.view === i ? 'accent' : 'muted')).join('   ');
  const side = ['', p(' YOUR JOURNEYS', 'muted'), ''];
  const visibleCount = Math.max(1, bodyHeight - 14), offset = Math.max(0, state.journey - visibleCount + 1);
  state.data.activities.slice(offset, offset + visibleCount).forEach((a, i) => side.push(p(` ${offset + i === state.journey ? '›' : '●'} ${clean(a.name)}`, offset + i === state.journey ? 'bright' : a.color)));
  if (!state.data.activities.length) side.push(' No journeys yet');
  side.push('', p(' [ ] Journeys', 'muted'), '', ' L  Log progress', ' N  New journey', ' S  Settings', ' R  Change range', ' Q  Quit');
  let content;
  if (state.confirm) content = [p(` ${state.confirm.title}`, 'yellow'), '', ...state.confirm.lines.map(line => ` ${clean(line)}`), '', ' Enter Confirm   Esc Cancel'];
  else if (state.form) content = formContent(state.form, mainWidth - 2, color);
  else if (activity && state.categoryManagerIndex != null) content = categoryManager(state, mainWidth - 2, bodyHeight - 2, color);
  else if (activity && state.goalHistoryOffset != null) content = goalHistoryContent(state, bodyHeight - 2);
  else if (!activity) content = ['', p(' MAKE ROOM FOR WHAT MATTERS', 'bright'), '', ' Start a journey, then log a little progress.', '', ' N  Create your first journey', '', ' Track minutes, pages, words, reps, km, or sessions.', ' Set a daily goal and watch your progress build.'];
  else {
    const stats = state.view === 1 && state.categoryTrends ? categoryStatistics(state.data, activity.name, state.range) : statistics(state.data, activity.name, state.range);
    if (state.view === 0) content = overview(stats, mainWidth - 2, bodyHeight - 2, color);
    if (state.view === 1) content = [p(state.cumulative ? ' CUMULATIVE PROGRESS' : ' DAILY ACTIVITY', 'bright'),
      ' C Daily / cumulative   B Categories   ←/→ Day', '',
      ...plot(stats, { width: mainWidth - 4, height: Math.max(4, bodyHeight - 13), cumulative: state.cumulative, color, cursor: state.cursor ?? stats.daily.length - 1 }),
      state.cumulative ? ' Cumulative resets at the start of this range.' : " Goals use each day's saved target."];
    if (state.view === 1 && state.categoryTrends) content = categoryTrends(state, stats, mainWidth - 2, bodyHeight - 2, color);
    if (state.view === 2) content = calendar(stats, mainWidth - 2, bodyHeight - 2, color, state.calendarOffset);
    if (state.view === 3) content = history(state, mainWidth - 2, bodyHeight - 2, color);
    if (state.view === 4) content = settings(state, color);
  }
  const left = pane('JOURNEYS', side, sideWidth, bodyHeight, color);
  const title = state.form ? 'EDIT' : state.confirm ? 'CONFIRM' : state.categoryManagerIndex != null ? 'CATEGORIES' : state.goalHistoryOffset != null ? 'GOAL HISTORY' : `${activity ? clean(activity.name) + ' · ' : ''}${VIEWS[state.view]}`;
  const right = pane(title, content, mainWidth, bodyHeight, color);
  return [header, '', tabs, ` ${p(range, 'yellow')}  ${p('· R cycles 7 / 30 / 90 / 365 days / all time', 'muted')}`,
    ...left.map((line, i) => ` ${line} ${right[i]}`),
    ` ${p(clean(state.message) || 'Tab Views   [ / ] Journeys   L Log   ? Help', state.message.startsWith('Error') ? 'red' : 'muted')}`,
    ` ${p(`Day: ${trackingDay(state.data)} · resets ${dayResetTime(state.data)} local · Settings → T`, 'muted')}`].map(line => fit(line, width - 1)).join('\n');
}

export function openForm(state, kind) {
  const activity = selected(state);
  if (!activity && !['new', 'day-reset'].includes(kind)) return;
  let form = { kind, index: 0, error: '', help: [], fields: [], originalName: activity?.name };
  if (kind === 'new' || kind === 'settings') {
    const a = kind === 'new' ? {} : activity;
    form.title = kind === 'new' ? 'NEW JOURNEY' : 'EDIT JOURNEY';
    form.help = ['Goal starts today; blank means no goal.'];
    form.fields = [field('Name', a.name), field('Daily goal', kind === 'new' ? null : goalOn(a, trackingDay(state.data))), field('Unit', unitOf(a), UNITS), field('Color', a.color || 'cyan', PALETTE)];
  } else if (kind === 'day-reset') {
    form.title = 'DAY RESET · ALL JOURNEYS';
    form.help = ['Applies to every journey, in local time.', 'Logs before this time count as yesterday.', 'Existing log dates stay as recorded.'];
    form.fields = [field('Reset time (24-hour HH:MM)', dayResetTime(state.data))];
  } else if (kind === 'log' || kind === 'edit') {
    const entry = kind === 'edit' ? logsFor(state)[state.historyIndex] : null;
    if (kind === 'edit' && !entry) return;
    form.entryId = entry?.id;
    form.title = `${kind === 'edit' ? 'EDIT LOG' : 'LOG PROGRESS'} · ${activity.name}`;
    form.help = ['Amount: 3*21+45 = 108; + - * / ( ) work.', 'Use YYYY-MM-DD, today, or yesterday.'];
    const choices = [UNCLASSIFIED, ...categoriesOf(activity).filter(category => !category.archived || category.id === entry?.categoryId)];
    form.categoryIds = new Map(choices.map(category => [category.name, category.id]));
    form.fields = [field(`Amount (${unitOf(activity)})`, entry ? amountOf(entry) : ''), field('Date', entry?.date || 'today'),
      field('Category', categoryOf(activity, entry?.categoryId).name, choices.map(category => category.name))];
  } else if (kind === 'new-category' || kind === 'edit-category') {
    const category = kind === 'edit-category' ? categoriesOf(activity)[state.categoryManagerIndex] : null;
    if (kind === 'edit-category' && !category) return;
    form.categoryId = category?.id ?? null;
    form.title = kind === 'new-category' ? 'NEW CATEGORY' : 'EDIT CATEGORY';
    form.help = ['e.g. Anime, Live action, YouTube, Podcasts', 'Colour: #RRGGBB or #RGB, e.g. #7FAAF5.'];
    form.fields = [field('Name', category?.name), field('Hex colour', category?.color ?? CATEGORY_COLORS[categoriesOf(activity).length % CATEGORY_COLORS.length])];
  } else if (kind === 'import') {
    form.title = `IMPORT CSV · ${activity.name}`;
    form.help = [`Headerless rows: M/D/YYYY,${unitOf(activity)} or YYYY-MM-DD,${unitOf(activity)}`, 'You will see a count before importing. Imports append logs.'];
    form.fields = [field('CSV file path')];
  }
  state.form = form;
}

function freshMutation(state, mutate) {
  const data = ensureEntryIds(load());
  const result = mutate(data);
  save(data);
  state.data = data;
  state.journey = Math.min(state.journey, Math.max(0, data.activities.length - 1));
  return result;
}
function submitForm(state) {
  const form = state.form, values = form.fields.map(f => f.value.trim());
  try {
    if (form.kind === 'new' || form.kind === 'settings') {
      const [name, goal, unit, color] = values;
      freshMutation(state, data => configureJourney(data, form.kind === 'new' ? null : form.originalName, { name, goal, unit, color }));
      state.journey = state.data.activities.findIndex(a => a.name === name);
      state.message = `Saved ${name}.`; state.view = 0;
    } else if (form.kind === 'day-reset') {
      const time = freshMutation(state, data => configureDayReset(data, values[0]));
      state.cursor = null;
      state.message = `Day resets at ${time} local time for all journeys.`;
    } else if (form.kind === 'new-category' || form.kind === 'edit-category') {
      const [name, color] = values;
      const category = freshMutation(state, data => configureCategory(findJourney(data, form.originalName), form.categoryId, { name, color }));
      state.categoryManagerIndex = categoriesOf(selected(state)).findIndex(item => item.id === category.id);
      state.message = `Saved category ${category.name}.`;
    } else if (form.kind === 'log' || form.kind === 'edit') {
      const [amount, rawDate, categoryName] = values;
      const categoryId = form.categoryIds.get(categoryName);
      const entry = freshMutation(state, data => {
        const date = resolveLogDate(rawDate, data);
        if (form.kind === 'edit') return editLog(data, form.entryId, { amount, date, categoryId });
        return addLog(data, form.originalName, amount, date, categoryId);
      });
      state.message = `Saved log #${entry.id} · ${quantity(amountOf(entry), unitOf(selected(state)))} · ${entry.date}.`; state.historyIndex = 0;
    } else if (form.kind === 'import') {
      const file = values[0].replace(/^"(.*)"$/, '$1');
      const csv = readFileSync(file, 'utf8');
      const preview = load();
      const count = importCsv(preview, form.originalName, csv);
      if (!count) throw new Error('The CSV has no rows to import.');
      state.confirm = { title: `IMPORT ${count} LOGS?`, lines: [file, `Journey: ${form.originalName}`, 'These entries will be appended. Reimporting creates duplicates.'],
        action: () => { freshMutation(state, data => importCsv(data, form.originalName, csv)); state.message = `Imported ${count} logs.`; } };
    }
    state.form = null;
  } catch (error) { form.error = error.message; }
}

export function handleKey(state, text, key = {}) {
  if (key.ctrl && key.name === 'c') return 'quit';
  if (state.confirm) {
    if (key.name === 'escape') state.confirm = null;
    else if (key.name === 'return') {
      try { state.confirm.action(); } catch (error) { state.message = `Error: ${error.message}`; }
      state.confirm = null;
    }
    return;
  }
  if (state.form) {
    const form = state.form, item = form.fields[form.index];
    if (key.name === 'escape') { state.form = null; return; }
    if (key.ctrl && key.name === 's') { submitForm(state); return; }
    if (key.name === 'tab' || key.name === 'up' || key.name === 'down') {
      const delta = key.shift || key.name === 'up' ? -1 : 1;
      form.index = (form.index + delta + form.fields.length) % form.fields.length; return;
    }
    if (key.name === 'return') {
      if (form.index === form.fields.length - 1) submitForm(state);
      else form.index++;
      return;
    }
    if (item.options && ['left', 'right', 'space'].includes(key.name)) {
      const i = item.options.indexOf(item.value), delta = key.name === 'left' ? -1 : 1;
      item.value = item.options[(i + delta + item.options.length) % item.options.length]; return;
    }
    if (!item.options) {
      if (key.name === 'backspace') item.value = [...item.value].slice(0, -1).join('');
      else if (key.ctrl && key.name === 'u') item.value = '';
      else if (!key.ctrl && !key.meta && text && !/[\u0000-\u001f\u007f]/.test(text) && item.value.length < 4096) item.value += text;
    }
    return;
  }
  const char = text?.toLowerCase();
  if (state.categoryManagerIndex != null) {
    const activity = selected(state), categories = categoriesOf(activity);
    if (key.name === 'escape' || !activity) { state.categoryManagerIndex = null; return; }
    if (char === 'q') return 'quit';
    if (char === 'n') { openForm(state, 'new-category'); return; }
    const last = Math.max(0, categories.length - 1);
    state.categoryManagerIndex = Math.min(state.categoryManagerIndex, last);
    if (char === 'e' || key.name === 'return') { openForm(state, 'edit-category'); return; }
    if (char === 'a' && categories.length) {
      const category = categories[state.categoryManagerIndex];
      try {
        const updated = freshMutation(state, data => archiveCategory(findJourney(data, activity.name), category.id, !category.archived));
        state.message = `${updated.archived ? 'Archived' : 'Restored'} ${updated.name}. Past logs are kept.`;
      } catch (error) { state.message = `Error: ${error.message}`; }
      return;
    }
    if (key.name === 'home') state.categoryManagerIndex = 0;
    if (key.name === 'end') state.categoryManagerIndex = last;
    if (['up', 'down', 'pageup', 'pagedown'].includes(key.name)) {
      const delta = ['up', 'pageup'].includes(key.name) ? -1 : 1;
      state.categoryManagerIndex = Math.max(0, Math.min(last, state.categoryManagerIndex + delta * (key.name.startsWith('page') ? 10 : 1)));
    }
    return;
  }
  if (state.goalHistoryOffset != null) {
    if (key.name === 'escape' || char === 'h' || !selected(state)) state.goalHistoryOffset = null;
    else if (char === 'q') return 'quit';
    else {
      const last = Math.max(0, goalHistoryOf(selected(state)).length - 1);
      if (key.name === 'home') state.goalHistoryOffset = 0;
      if (key.name === 'end') state.goalHistoryOffset = last;
      if (['up', 'down', 'pageup', 'pagedown'].includes(key.name)) {
        const delta = ['up', 'pageup'].includes(key.name) ? -1 : 1;
        state.goalHistoryOffset = Math.max(0, Math.min(last, state.goalHistoryOffset + delta * (key.name.startsWith('page') ? 10 : 1)));
      }
    }
    return;
  }
  if (char === 'q' || key.name === 'escape') return 'quit';
  if (char === '?') { state.message = 'Trends: B Categories · Settings: C Configure categories · L Log'; return; }
  if (/^[1-5]$/.test(char || '')) { state.view = Number(char) - 1; return; }
  if (key.name === 'tab') { state.view = (state.view + (key.shift ? 4 : 1)) % 5; return; }
  if (char === 'r') { state.range = RANGES[(RANGES.indexOf(state.range) + 1) % RANGES.length]; state.cursor = null; state.calendarOffset = 0; return; }
  if (char === 'n') { openForm(state, 'new'); return; }
  if (char === 't' && state.view === 4) { openForm(state, 'day-reset'); return; }
  const activity = selected(state);
  if (!activity) return;
  if (char === 's') { state.view = 4; return; }
  if (char === 'l') { openForm(state, 'log'); return; }
  if (char === 'i') { openForm(state, 'import'); return; }
  if (char === 'e' && state.view === 4) { openForm(state, 'settings'); return; }
  if (char === 'h' && state.view === 4) { state.goalHistoryOffset = 0; return; }
  if (char === 'c' && state.view === 4) { state.categoryManagerIndex = 0; return; }
  if (state.view === 3 && key.name === 'return') { openForm(state, 'edit'); return; }
  if (char === 'd' && (state.view === 3 || state.view === 4)) {
    if (state.view === 4) {
      const count = state.data.entries.filter(e => e.activity === activity.name).length;
      state.confirm = { title: 'DELETE JOURNEY?', lines: [activity.name, `This will permanently remove the journey and its ${count} logs.`],
        action: () => { freshMutation(state, data => removeJourney(data, activity.name, true)); state.message = 'Journey deleted.'; } };
    } else {
      const entry = logsFor(state)[state.historyIndex];
      if (entry) state.confirm = { title: `DELETE LOG #${entry.id}?`, lines: [`${activity.name} · ${entry.date} · ${quantity(amountOf(entry), unitOf(activity))}`],
        action: () => { freshMutation(state, data => removeLog(data, entry.id)); state.historyIndex = Math.max(0, state.historyIndex - 1); state.message = `Deleted log #${entry.id}.`; } };
    }
    return;
  }
  if (state.view === 1) {
    if (char === 'b') { state.categoryTrends = !state.categoryTrends; return; }
    if (char === 'c') { state.categoryTrends = false; state.cumulative = !state.cumulative; return; }
    if (state.categoryTrends && ['up', 'down'].includes(key.name)) {
      const last = categoryStatistics(state.data, activity.name, state.range).series.length - 1;
      state.categoryIndex = Math.max(0, Math.min(last, state.categoryIndex + (key.name === 'up' ? -1 : 1))); return;
    }
    if (['left', 'right', 'home', 'end'].includes(key.name)) {
      const stats = statistics(state.data, activity.name, state.range), last = stats.daily.length - 1;
      const delta = key.name === 'left' ? -1 : 1;
      state.cursor = key.name === 'home' ? 0 : key.name === 'end' ? last : Math.max(0, Math.min(last, (state.cursor ?? last) + delta * (key.shift ? 7 : 1))); return;
    }
  }
  if (state.view === 2 && ['left', 'right', 'pageup', 'pagedown', 'home', 'end'].includes(key.name)) {
    const stats = statistics(state.data, activity.name, state.range);
    const maxOffset = Math.max(0, Math.ceil(stats.days / 7) - 1);
    const step = key.name.startsWith('page') ? 4 : 1;
    state.calendarOffset = key.name === 'home' ? maxOffset : key.name === 'end' ? 0
      : Math.max(0, Math.min(maxOffset, state.calendarOffset + (['left', 'pageup'].includes(key.name) ? step : -step)));
    return;
  }
  if (state.view === 3 && ['up', 'down', 'pageup', 'pagedown', 'home', 'end'].includes(key.name)) {
    const last = Math.max(0, logsFor(state).length - 1);
    const delta = ['up', 'pageup'].includes(key.name) ? -1 : 1;
    state.historyIndex = key.name === 'home' ? 0 : key.name === 'end' ? last : Math.max(0, Math.min(last, state.historyIndex + delta * (key.name.startsWith('page') ? 10 : 1))); return;
  }
  if (char === '[' || char === ']' || ['up', 'down'].includes(key.name)) {
    const delta = char === '[' || key.name === 'up' ? -1 : 1;
    state.journey = (state.journey + delta + state.data.activities.length) % state.data.activities.length;
    state.historyIndex = 0; state.cursor = null; state.categoryIndex = 0;
  }
}

export function runTui({ input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || !output.isTTY) throw new Error('The app needs an interactive terminal. Run journey app in Windows Terminal, or use journey --help for commands.');
  const state = initialState(ensureEntryIds(load()));
  return new Promise((resolve, reject) => {
    const wasRaw = Boolean(input.isRaw);
    let interval, stopped = false, lastFrame = '';
    const draw = () => {
      const frame = renderApp(state, { width: output.columns || 100, height: output.rows || 32, color: !process.env.NO_COLOR }).replaceAll('\n', '\r\n');
      if (frame !== lastFrame) output.write('\x1b[H' + frame + '\x1b[J');
      lastFrame = frame;
    };
    const stop = error => {
      if (stopped) return;
      stopped = true;
      clearInterval(interval);
      input.off('keypress', onKey); output.off('resize', onResize);
      process.off('SIGTERM', onTerminate); process.off('SIGINT', onTerminate);
      input.setRawMode(wasRaw); input.pause();
      output.write('\x1b[?25h\x1b[?1049l');
      if (error) reject(error); else resolve();
    };
    const onKey = (text, key) => { try { if (handleKey(state, text, key) === 'quit') stop(); else draw(); } catch (error) { state.message = `Error: ${error.message}`; draw(); } };
    const onResize = () => { try { lastFrame = ''; output.write('\x1b[2J'); draw(); } catch (error) { stop(error); } };
    const onTerminate = () => stop();
    readline.emitKeypressEvents(input);
    input.setRawMode(true); input.resume();
    input.on('keypress', onKey); output.on('resize', onResize);
    process.on('SIGTERM', onTerminate); process.on('SIGINT', onTerminate);
    output.write('\x1b]0;🧭 Journey\x07\x1b[?1049h\x1b[?25l\x1b[2J');
    interval = setInterval(() => {
      if (state.form || state.confirm) return;
      try {
        const name = selected(state)?.name;
        state.data = ensureEntryIds(load());
        const index = state.data.activities.findIndex(a => a.name === name);
        if (index < 0) { state.goalHistoryOffset = null; state.categoryManagerIndex = null; state.categoryIndex = 0; }
        state.journey = index < 0 ? 0 : index;
        state.historyIndex = Math.min(state.historyIndex, Math.max(0, logsFor(state).length - 1));
        draw();
      } catch (error) { state.message = `Error: ${error.message}`; draw(); }
    }, 2000);
    draw();
  });
}
