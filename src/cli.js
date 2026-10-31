import { readFileSync } from 'node:fs';
import { color, cumulativeChart, heatmap, historyCumulativeChart } from './charts.js';
import { dataPath, ensureEntryIds, load, save } from './storage.js';
import { addLog, amountOf, categoryStatistics, configureJourney, currentDayProgress, goalHistoryOf, number, quantity, statistics, unitOf } from './journeys.js';
import { configureDayReset, dayResetTime, dayString as dateString, resolveLogDate as resolveDate, trackingDay } from './days.js';
export { resolveLogDate as resolveDate } from './days.js';
import { archiveCategory, categoryOf, configureCategory, findCategory } from './categories.js';
import { paint } from './terminal.js';
import { runTui } from './tui.js';

const PALETTE = ['blue', 'cyan', 'green', 'yellow', 'magenta', 'red'];

function activityFor(data, name) { return data.activities.find(item => item.name.toLowerCase() === name.toLowerCase()); }
function requireActivity(data, name) {
  const activity = activityFor(data, name);
  if (!activity) throw new Error(`Unknown activity '${name}'. Add it first with: journey activity add ${name}`);
  return activity;
}
function printActivities() {
  const data = load();
  if (!data.activities.length) return console.log('No activities yet. Add one with: journey activity add <name>');
  const summaries = Object.fromEntries(data.activities.map(activity => [activity.name, { minutes: 0, entries: 0, latest: null }]));
  data.entries.forEach(entry => {
    const summary = summaries[entry.activity] ||= { minutes: 0, entries: 0, latest: null };
    summary.minutes += amountOf(entry);
    summary.entries += 1;
    if (!summary.latest || entry.date > summary.latest) summary.latest = entry.date;
  });
  const totalMinutes = data.activities.filter(a => unitOf(a) === 'minutes').reduce((total, a) => total + summaries[a.name].minutes, 0);
  console.log(`Activities · ${(totalMinutes / 60).toFixed(1)}h total`);
  data.activities.forEach(activity => {
    const summary = summaries[activity.name];
    const logs = summary.entries === 1 ? 'log' : 'logs';
    const total = unitOf(activity) === 'minutes' ? `${(summary.minutes / 60).toFixed(1)}h` : quantity(summary.minutes, unitOf(activity));
    console.log(`  ${color('●', activity.color)} ${activity.name.padEnd(20)} ${total.padStart(8)}  ${String(summary.entries).padStart(3)} ${logs}  ${summary.latest || 'no entries'}`);
    const stats = statistics(data, activity.name, 1);
    console.log(`    Goal streak: ${stats.currentStreak} days · longest: ${stats.bestStreak} days`);
  });
}
function printGoals(args) {
  if (args.length !== 1) throw new Error('Usage: journey activity goals <name>');
  const activity = requireActivity(load(), args[0]);
  console.log(`Goal history for ${activity.name} · effective from each date`);
  for (const change of [...goalHistoryOf(activity)].reverse()) {
    console.log(`  ${change.date ?? 'Earlier days'}  ${change.goal == null ? 'No goal' : quantity(change.goal, unitOf(activity))}`);
  }
}
function printToday(args) {
  if (args.length > 1) throw new Error('Usage: journey today [journey]');
  const data = load(), activities = args.length ? [requireActivity(data, args[0])] : data.activities;
  console.log(`Today · ${trackingDay(data)} · resets ${dayResetTime(data)} local time`);
  if (!activities.length) return console.log('No journeys yet.');
  for (const activity of activities) {
    const progress = currentDayProgress(data, activity.name), unit = unitOf(activity);
    const summary = progress.goal > 0
      ? `${number(progress.amount)} / ${quantity(progress.goal, unit)} · ${progress.goalMet ? 'Goal met!' : `${quantity(progress.remaining, unit)} left`}`
      : `${quantity(progress.amount, unit)} · No goal set`;
    console.log(`  ${activity.name}: ${summary}`);
  }
}
function addActivity(args) {
  const [name, ...options] = args;
  if (!name) throw new Error('Usage: journey activity add <name> [--color color]');
  const index = options.indexOf('--color');
  const colorName = index === -1 ? 'cyan' : options[index + 1];
  if (!PALETTE.includes(colorName)) throw new Error(`Color must be one of: ${PALETTE.join(', ')}.`);
  const data = load();
  if (activityFor(data, name)) throw new Error(`Activity '${name}' already exists.`);
  const unitIndex = options.indexOf('--unit'), goalIndex = options.indexOf('--goal');
  if (unitIndex !== -1 && !options[unitIndex + 1]) throw new Error('--unit needs a measurement.');
  if (goalIndex !== -1 && !options[goalIndex + 1]) throw new Error('--goal needs a positive number.');
  configureJourney(data, null, { name, color: colorName, unit: unitIndex === -1 ? 'minutes' : options[unitIndex + 1], goal: goalIndex === -1 ? null : options[goalIndex + 1] }); save(data);
  console.log(`Added activity: ${color(name, colorName)}`);
}
function removeActivity(args) {
  const [name, ...options] = args;
  if (!name) throw new Error('Usage: journey activity remove <name> [--force]');
  const data = load(); const activity = requireActivity(data, name);
  const logged = data.entries.filter(entry => entry.activity.toLowerCase() === activity.name.toLowerCase());
  if (logged.length && !options.includes('--force')) throw new Error(`'${activity.name}' has ${logged.length} log entries. Re-run with --force to remove it and those entries.`);
  data.activities = data.activities.filter(item => item !== activity);
  if (options.includes('--force')) data.entries = data.entries.filter(entry => !logged.includes(entry));
  save(data); console.log(`Removed ${activity.name}.${logged.length ? ` Deleted ${logged.length} entries.` : ''}`);
}
function logTime(args) {
  if (args[0] === 'undo') return undoLog(args.slice(1));
  const [name, amountText, ...dateArgs] = args;
  let yesterday = false, categoryName = null;
  const positionalDates = [];
  for (let i = 0; i < dateArgs.length; i++) {
    const value = dateArgs[i];
    if (value === '--category') {
      if (categoryName != null || !dateArgs[i + 1] || dateArgs[i + 1].startsWith('--')) throw new Error('--category needs one category name.');
      categoryName = dateArgs[++i];
    } else if (value === '--yesterday') yesterday = true;
    else if (value.startsWith('--')) throw new Error(`Unknown log option '${value}'.`);
    else positionalDates.push(value);
  }
  if (!name || !amountText || positionalDates.length > 1 || (yesterday && positionalDates.length)) {
    throw new Error('Usage: journey log <activity> <amount> [date|--yesterday] [--category name]. Quote expressions: "3*21+45".');
  }
  const data = load(); const activity = requireActivity(data, name); const day = resolveDate(yesterday ? 'yesterday' : positionalDates[0], data);
  const categoryId = categoryName == null ? null : findCategory(activity, categoryName).id;
  const entry = addLog(data, activity.name, amountText, day, categoryId); save(data);
  const unit = unitOf(activity);
  console.log(`Logged ${unit === 'minutes' ? `${amountOf(entry)}m` : quantity(amountOf(entry), unit)} for ${color(activity.name, activity.color)}${categoryId == null ? '' : ` · ${categoryOf(activity, categoryId).name}`} on ${day} (ID ${entry.id}).`);
}

function manageCategory(args) {
  const [action, journeyName, name, ...options] = args;
  if (!journeyName || !['list', 'add', 'set', 'archive', 'restore'].includes(action)) throw new Error('Usage: journey category <list|add|set|archive|restore> <journey> [category] [--name name] [--color "#RRGGBB"]');
  const data = load(), activity = requireActivity(data, journeyName);
  if (action === 'list') {
    if (name !== undefined) throw new Error('Usage: journey categories <journey>');
    const stats = categoryStatistics(data, activity.name, 'all');
    console.log(`Categories for ${activity.name} · all-time totals through today`);
    for (const item of stats.series) console.log(`  ${paint('●', item.color, !process.env.NO_COLOR)} ${item.name}  ${item.color}  ${quantity(item.total, unitOf(activity), true)}${item.archived ? ' (archived)' : ''}`);
    return;
  }
  if (!name) throw new Error('Supply a category name.');
  if (action === 'archive' || action === 'restore') {
    if (options.length) throw new Error('Archive and restore take only a journey and category name.');
    const category = archiveCategory(activity, findCategory(activity, name).id, action === 'archive');
    save(data); console.log(`${category.archived ? 'Archived' : 'Restored'} ${category.name}. Past logs are kept.`); return;
  }
  const settings = action === 'add' ? { name } : {};
  for (let i = 0; i < options.length; i += 2) {
    const key = options[i], value = options[i + 1];
    if (!['--name', '--color'].includes(key) || !value || (action === 'add' && key === '--name')) throw new Error('Use --color "#RRGGBB", or --name for renaming a category.');
    settings[key.slice(2)] = value;
  }
  const category = configureCategory(activity, action === 'add' ? null : findCategory(activity, name).id, settings);
  save(data); console.log(`Saved ${category.name} (${category.color}) in ${activity.name}.`);
}
function undoLog(args) {
  const [idText] = args;
  if (args.length !== 1 || !/^[1-9]\d*$/.test(idText || '') || !Number.isSafeInteger(Number(idText))) {
    throw new Error('Usage: journey log undo <id>');
  }
  const id = Number(idText);
  const data = ensureEntryIds(load());
  const index = data.entries.findIndex(entry => entry.id === id);
  if (index === -1) throw new Error(`No log with ID ${id}. Run journey history to see recent IDs.`);
  const [entry] = data.entries.splice(index, 1);
  save(data);
  console.log(`Undid log ${id}: ${quantity(amountOf(entry), unitOf(activityFor(data, entry.activity)))} for ${entry.activity} on ${entry.date}.`);
}
function legacyDate(value) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!match) throw new Error(`Invalid CSV date '${value}'. Expected M/D/YYYY.`);
  const [, month, day, year] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  if (parsed.getMonth() !== Number(month) - 1 || parsed.getDate() !== Number(day)) throw new Error(`Invalid CSV date '${value}'.`);
  return dateString(parsed);
}
function importLegacyCsv(args) {
  const [path, ...options] = args;
  const activityIndex = options.indexOf('--activity');
  const activityName = activityIndex === -1 ? undefined : options[activityIndex + 1];
  if (!path || !activityName) throw new Error('Usage: journey import csv <file> --activity <activity>');
  const rows = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const data = load(); const activity = requireActivity(data, activityName);
  const entries = rows.map((row, rowIndex) => {
    const [inputDate, minutesText] = row.split(',');
    if (!inputDate || !/^\d+(\.\d+)?$/.test(minutesText || '') || !Number.isFinite(Number(minutesText)) || Number(minutesText) < 0) throw new Error(`Invalid row ${rowIndex + 1} in ${path}.`);
    return { activity: activity.name, [unitOf(activity) === 'minutes' ? 'minutes' : 'amount']: Number(minutesText), date: legacyDate(inputDate) };
  });
  data.entries.push(...entries); save(data);
  const amount = entries.reduce((total, entry) => total + amountOf(entry), 0);
  console.log(`Imported ${entries.length} entries (${quantity(amount, unitOf(activity), true)}) for ${color(activity.name, activity.color)}.`);
}
function history(args) {
  const limitIndex = args.indexOf('--limit'); const limit = limitIndex === -1 ? 12 : Number(args[limitIndex + 1]);
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive whole number.');
  const data = ensureEntryIds(load()); const colors = Object.fromEntries(data.activities.map(item => [item.name, item.color]));
  const entries = [...data.entries].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
  if (!entries.length) return console.log('No time logged yet.');
  console.log('Recent history'); entries.forEach(entry => console.log(`  ${String(entry.id).padStart(4)}  ${entry.date}  ${color('●', colors[entry.activity])} ${entry.activity.padEnd(20)} ${quantity(amountOf(entry), unitOf(activityFor(data, entry.activity)))}  · ${categoryOf(activityFor(data, entry.activity), entry.categoryId).name}`));
}
function option(args, flag, defaultValue) { const index = args.indexOf(flag); return index === -1 ? defaultValue : Number(args[index + 1]); }
function assertPositive(value, flag) { if (!Number.isInteger(value) || value < 1) throw new Error(`${flag} must be a positive whole number.`); return value; }
function timeEntries(data = load()) {
  const entries = data.entries.filter(entry => unitOf(activityFor(data, entry.activity)) === 'minutes');
  if (entries.length < data.entries.length) console.log('Time journeys only. Use journey app to view other measurements.');
  return entries.filter(entry => entry.date <= trackingDay(data));
}
function editActivity(args) {
  const [name, ...options] = args;
  if (!name) throw new Error('Usage: journey activity set <name> [--goal amount|none] [--unit unit] [--color color] [--name name]');
  const settings = {};
  for (let i = 0; i < options.length; i += 2) {
    const key = options[i].slice(2), value = options[i + 1];
    if (!['goal', 'unit', 'color', 'name'].includes(key) || !value) throw new Error('Use --goal, --unit, --color, or --name followed by a value.');
    settings[key] = key === 'goal' && value === 'none' ? null : value;
  }
  const data = load();
  const activity = configureJourney(data, name, settings); save(data);
  console.log(`Updated ${activity.name}: ${unitOf(activity)}, daily goal ${activity.goal ?? 'not set'}.${settings.goal !== undefined ? ' Goal changes apply from today.' : ''}`);
}
function usage() {
  console.log(`Journey Logger — log progress, see the journey.\n\nUsage:\n  journey                         Open the terminal app\n  journey app                     Open the terminal app\n  journey activity add <name> [--color color] [--unit unit] [--goal amount]\n  journey activity set <name> [--goal amount|none] [--unit unit] [--color color] [--name name]\n  journey log <activity> <amount> [date|--yesterday]\n  journey log undo <id>\n  journey import csv <file> --activity <activity>\n  journey dashboard\n\nUnits: minutes (default), pages, words, reps, km, sessions\nCommands: app, activity, activities, log, import, history, trend, heatmap, dashboard, show, config path`);
  console.log('\nAmounts accept + - * / and parentheses. Example: journey log Japanese "3*21+45" (108 minutes).');
  console.log('Goal changes start today. View history: journey activity goals <name>. View streaks: journey activities.');
  console.log('Categories: journey category add Japanese Anime --color "#7FAAF5"\n  journey log Japanese "3*21" --category Anime\n  journey categories Japanese\nIn the app: Settings → C to configure; Trends → B for category curves.');
  console.log('Today’s goal: journey today [journey]\nDay reset: journey config day-reset [HH:MM] (local time, all journeys; also Settings → T).');
}
export function main(args) {
  try {
    const [command, ...rest] = args;
    if (command === 'app' || command === 'ui' || (!command && process.stdin.isTTY && process.stdout.isTTY)) return runTui().catch(error => { console.error(`error: ${error.message}`); process.exitCode = 2; });
    if (!command || ['help', '--help', '-h'].includes(command)) return usage();
    if (command === 'activity' || command === 'activities') { if (!rest.length) return printActivities(); if (rest[0] === 'add') return addActivity(rest.slice(1)); if (rest[0] === 'set') return editActivity(rest.slice(1)); if (rest[0] === 'goals') return printGoals(rest.slice(1)); if (rest[0] === 'remove') return removeActivity(rest.slice(1)); throw new Error('Usage: journey activity [add|set|goals|remove] ...'); }
    if (command === 'log') return logTime(rest);
    if (command === 'today') return printToday(rest);
    if (command === 'category') return manageCategory(rest);
    if (command === 'categories') return manageCategory(['list', ...rest]);
    if (command === 'import' && rest[0] === 'csv') return importLegacyCsv(rest.slice(1));
    if (command === 'history') return history(rest);
    if (command === 'trend') { const data = load(); const days = assertPositive(option(rest, '--days', 30), '--days'); return console.log(cumulativeChart(timeEntries(data), days, trackingDay(data))); }
    if (command === 'heatmap') { const data = load(); const weeks = assertPositive(option(rest, '--weeks', 16), '--weeks'); return console.log(heatmap(timeEntries(data), weeks, !rest.includes('--no-color'), trackingDay(data))); }
    if (command === 'dashboard' || command === 'show') { const data = load(), end = trackingDay(data); const hasDays = rest.includes('--days'); const days = assertPositive(option(rest, '--days', 30), '--days'); const weeks = assertPositive(option(rest, '--weeks', 16), '--weeks'); const entries = timeEntries(data); console.log('JOURNEY LOG'.padStart(35, '─').padEnd(58, '─')); console.log(hasDays ? cumulativeChart(entries, days, end) : historyCumulativeChart(entries, 52, end)); console.log(); console.log(heatmap(entries, weeks, !rest.includes('--no-color'), end)); console.log(); return history(['--limit', '5']); }
    if (command === 'config' && rest[0] === 'path') return console.log(dataPath());
    if (command === 'config' && rest[0] === 'day-reset') {
      if (rest.length > 2) throw new Error('Usage: journey config day-reset [HH:MM]');
      const data = load();
      if (rest.length === 2) { configureDayReset(data, rest[1]); save(data); }
      return console.log(`Day resets at ${dayResetTime(data)} local time for all journeys. Current day: ${trackingDay(data)}.`);
    }
    throw new Error(`Unknown command '${command}'. Run journey --help.`);
  } catch (error) { console.error(`error: ${error.message}`); process.exitCode = 2; }
}
