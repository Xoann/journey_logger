import { readFileSync } from 'node:fs';
import { color, cumulativeChart, heatmap, historyCumulativeChart } from './charts.js';
import { dataPath, load, save } from './storage.js';

const PALETTE = ['blue', 'cyan', 'green', 'yellow', 'magenta', 'red'];

function today() { return dateString(new Date()); }
function dateString(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function resolveDate(value) {
  if (!value || value.toLowerCase() === 'today') return today();
  if (value.toLowerCase() === 'yesterday') { const date = new Date(); date.setDate(date.getDate() - 1); return dateString(date); }
  const parsed = new Date(`${value}T00:00:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.valueOf()) || dateString(parsed) !== value) throw new Error('Date must be YYYY-MM-DD, today, or yesterday.');
  return value;
}
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
    summary.minutes += entry.minutes;
    summary.entries += 1;
    if (!summary.latest || entry.date > summary.latest) summary.latest = entry.date;
  });
  const totalMinutes = Object.values(summaries).reduce((total, summary) => total + summary.minutes, 0);
  console.log(`Activities · ${(totalMinutes / 60).toFixed(1)}h total`);
  data.activities.forEach(activity => {
    const summary = summaries[activity.name];
    const logs = summary.entries === 1 ? 'log' : 'logs';
    console.log(`  ${color('●', activity.color)} ${activity.name.padEnd(20)} ${(summary.minutes / 60).toFixed(1).padStart(7)}h  ${String(summary.entries).padStart(3)} ${logs}  ${summary.latest || 'no entries'}`);
  });
}
function addActivity(args) {
  const [name, ...options] = args;
  if (!name) throw new Error('Usage: journey activity add <name> [--color color]');
  const index = options.indexOf('--color');
  const colorName = index === -1 ? 'cyan' : options[index + 1];
  if (!PALETTE.includes(colorName)) throw new Error(`Color must be one of: ${PALETTE.join(', ')}.`);
  const data = load();
  if (activityFor(data, name)) throw new Error(`Activity '${name}' already exists.`);
  data.activities.push({ name, color: colorName }); save(data);
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
  const [name, minutesText, inputDate] = args;
  if (!name || !minutesText) throw new Error('Usage: journey log <activity> <minutes> [date]');
  if (!/^\d+(\.\d+)?$/.test(minutesText) || Number(minutesText) <= 0) throw new Error('Minutes must be a positive number.');
  const data = load(); const activity = requireActivity(data, name); const day = resolveDate(inputDate);
  data.entries.push({ activity: activity.name, minutes: Number(minutesText), date: day }); save(data);
  console.log(`Logged ${minutesText}m for ${color(activity.name, activity.color)} on ${day}.`);
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
    if (!inputDate || !/^\d+(\.\d+)?$/.test(minutesText || '') || Number(minutesText) < 0) throw new Error(`Invalid row ${rowIndex + 1} in ${path}.`);
    return { activity: activity.name, minutes: Number(minutesText), date: legacyDate(inputDate) };
  });
  data.entries.push(...entries); save(data);
  const minutes = entries.reduce((total, entry) => total + entry.minutes, 0);
  console.log(`Imported ${entries.length} entries (${(minutes / 60).toFixed(1)}h) for ${color(activity.name, activity.color)}.`);
}
function history(args) {
  const limitIndex = args.indexOf('--limit'); const limit = limitIndex === -1 ? 12 : Number(args[limitIndex + 1]);
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive whole number.');
  const data = load(); const colors = Object.fromEntries(data.activities.map(item => [item.name, item.color]));
  const entries = [...data.entries].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
  if (!entries.length) return console.log('No time logged yet.');
  console.log('Recent history'); entries.forEach(entry => console.log(`  ${entry.date}  ${color('●', colors[entry.activity])} ${entry.activity.padEnd(20)} ${String(entry.minutes).padStart(4)}m`));
}
function option(args, flag, defaultValue) { const index = args.indexOf(flag); return index === -1 ? defaultValue : Number(args[index + 1]); }
function assertPositive(value, flag) { if (!Number.isInteger(value) || value < 1) throw new Error(`${flag} must be a positive whole number.`); return value; }
function usage() {
  console.log(`Journey Logger — log time, see the journey.\n\nUsage:\n  journey activity add <name> [--color color]\n  journey log <activity> <minutes> [date]\n  journey import csv <file> --activity <activity>\n  journey dashboard\n\nCommands: activity, activities, log, import, history, trend, heatmap, dashboard, show, config path`);
}
export function main(args) {
  try {
    const [command, ...rest] = args;
    if (!command || ['help', '--help', '-h'].includes(command)) return usage();
    if (command === 'activity' || command === 'activities') { if (!rest.length) return printActivities(); if (rest[0] === 'add') return addActivity(rest.slice(1)); if (rest[0] === 'remove') return removeActivity(rest.slice(1)); throw new Error('Usage: journey activity [add|remove] ...'); }
    if (command === 'log') return logTime(rest);
    if (command === 'import' && rest[0] === 'csv') return importLegacyCsv(rest.slice(1));
    if (command === 'history') return history(rest);
    if (command === 'trend') { const days = assertPositive(option(rest, '--days', 30), '--days'); return console.log(cumulativeChart(load().entries, days)); }
    if (command === 'heatmap') { const weeks = assertPositive(option(rest, '--weeks', 16), '--weeks'); return console.log(heatmap(load().entries, weeks, !rest.includes('--no-color'))); }
    if (command === 'dashboard' || command === 'show') { const hasDays = rest.includes('--days'); const days = assertPositive(option(rest, '--days', 30), '--days'); const weeks = assertPositive(option(rest, '--weeks', 16), '--weeks'); const data = load(); console.log('JOURNEY LOG'.padStart(35, '─').padEnd(58, '─')); console.log(hasDays ? cumulativeChart(data.entries, days) : historyCumulativeChart(data.entries)); console.log(); console.log(heatmap(data.entries, weeks, !rest.includes('--no-color'))); console.log(); return history(['--limit', '5']); }
    if (command === 'config' && rest[0] === 'path') return console.log(dataPath());
    throw new Error(`Unknown command '${command}'. Run journey --help.`);
  } catch (error) { console.error(`error: ${error.message}`); process.exitCode = 2; }
}
