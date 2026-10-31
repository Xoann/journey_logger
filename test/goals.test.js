import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addLog, configureJourney, goalHistoryOf, goalOn, importCsv, removeLog, statistics } from '../src/journeys.js';
import { load, save } from '../src/storage.js';
import { bucketsFor, plot } from '../src/plot.js';

const fixture = () => ({ version: 1, activities: [{ name: 'Japanese', color: 'cyan', goal: 180 }], entries: [] });
const log = (data, date, amount) => addLog(data, 'Japanese', amount, date);
const stats = (data, end, days = 'all') => statistics(data, 'Japanese', days, end);

test('180 → 120 → 180 preserves each historical target and consecutive achievements', () => {
  const data = fixture();
  log(data, '2026-09-01', 180);
  configureJourney(data, 'Japanese', { goal: 120 }, '2026-09-02');
  log(data, '2026-09-02', 80); log(data, '2026-09-02', 40);
  log(data, '2026-09-03', 120);
  const before = stats(data, '2026-09-03');
  configureJourney(data, 'Japanese', { goal: 180 }, '2026-09-04');
  log(data, '2026-09-04', 180);
  assert.deepEqual(stats(data, '2026-09-03').daily, before.daily);
  const result = stats(data, '2026-09-04');
  assert.deepEqual(result.daily.map(day => day.goal), [180, 120, 120, 180]);
  assert.ok(result.daily.every(day => day.goalMet));
  assert.equal(result.goalPercent, 100);
  assert.equal(result.currentStreak, 4);
  assert.equal(result.bestStreak, 4);
  assert.equal(data.activities[0].goal, 180);

  const path = join(mkdtempSync(join(tmpdir(), 'journey-goals-')), 'data.json');
  save(data, path);
  assert.deepEqual(stats(load(path), '2026-09-04'), result);
});

test('legacy goals remain unchanged before the first recorded change, without read-time writes', () => {
  const data = fixture();
  log(data, '2026-09-01', 180);
  const before = JSON.stringify(data);
  assert.equal(stats(data, '2026-09-01').currentStreak, 1);
  assert.equal(JSON.stringify(data), before);
  configureJourney(data, 'Japanese', { goal: 120 }, '2026-09-03');
  assert.deepEqual(goalHistoryOf(data.activities[0]), [{ date: null, goal: 180 }, { date: '2026-09-03', goal: 120 }]);
  assert.equal(goalOn(data.activities[0], '2020-01-01'), 180);
  assert.equal(goalOn(data.activities[0], '2026-09-02'), 180);
  assert.equal(goalOn(data.activities[0], '2026-09-03'), 120);
});

test('same-day edits replace only that day, unchanged settings and renames preserve history', () => {
  const data = fixture();
  configureJourney(data, 'Japanese', { goal: 120 }, '2026-09-03');
  configureJourney(data, 'Japanese', { goal: 150 }, '2026-09-03');
  configureJourney(data, 'Japanese', { goal: 150, color: 'blue' }, '2026-09-04');
  const before = JSON.stringify(data.activities[0].goalHistory);
  configureJourney(data, 'Japanese', { name: 'Immersion' }, '2026-09-05');
  assert.equal(JSON.stringify(data.activities[0].goalHistory), before);
  assert.deepEqual(data.activities[0].goalHistory, [{ date: null, goal: 180 }, { date: '2026-09-03', goal: 150 }]);
  const snapshot = JSON.stringify(data);
  assert.throws(() => configureJourney(data, 'Immersion', { goal: -1 }, '2026-09-05'), /positive/);
  assert.throws(() => configureJourney(data, 'Immersion', { goal: 10 }, 'invalid'), /Date/);
  assert.equal(JSON.stringify(data), snapshot);
});

test('new goals start on the date set and exclude earlier days from goal percentages', () => {
  const data = { activities: [], entries: [] };
  configureJourney(data, null, { name: 'Japanese', goal: 180 }, '2026-09-02');
  log(data, '2026-09-01', 200); log(data, '2026-09-02', 180);
  const result = stats(data, '2026-09-02');
  assert.deepEqual(result.daily.map(day => day.goal), [null, 180]);
  assert.equal(result.goalEligibleDays, 1);
  assert.equal(result.goalDays, 1);
  assert.equal(result.goalPercent, 100);
  assert.equal(result.currentStreak, 1);

  const legacy = fixture(); legacy.activities[0].goal = null;
  configureJourney(legacy, 'Japanese', { goal: 180 }, '2026-09-02');
  assert.equal(goalOn(legacy.activities[0], '2026-09-01'), null);
});

test('unfinished today keeps yesterday’s streak until a full calendar day is missed', () => {
  const data = fixture();
  log(data, '2026-03-07', 180); log(data, '2026-03-08', 180); // DST boundary
  assert.equal(stats(data, '2026-03-09').currentStreak, 2);
  log(data, '2026-03-09', 120);
  assert.equal(stats(data, '2026-03-09').currentStreak, 2);
  assert.equal(stats(data, '2026-03-09').goalDays, 2);
  assert.equal(stats(data, '2026-03-10').currentStreak, 0);
  assert.equal(stats(data, '2026-03-10').bestStreak, 2);
  log(data, '2026-03-09', 60);
  assert.equal(stats(data, '2026-03-09').currentStreak, 3);
  assert.equal(stats(data, '2026-03-10').currentStreak, 3);
});

test('streaks span the selected range, ignore future logs, and treat gaps as breaks', () => {
  const data = fixture();
  for (const date of ['2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01']) log(data, date, 180);
  log(data, '2024-03-03', 180);
  let result = stats(data, '2024-03-01', 1);
  assert.equal(result.days, 1);
  assert.equal(result.currentStreak, 4);
  assert.equal(result.bestStreak, 4);
  result = stats(data, '2024-03-03', 1);
  assert.equal(result.currentStreak, 1);
  assert.equal(result.bestStreak, 4);
});

test('disabling a goal preserves wins, excludes goal-free days, and breaks the streak', () => {
  const data = fixture();
  for (const date of ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']) log(data, date, 180);
  configureJourney(data, 'Japanese', { goal: null }, '2026-09-03');
  assert.equal(stats(data, '2026-09-03').currentStreak, 0);
  assert.equal(stats(data, '2026-09-03').bestStreak, 2);
  configureJourney(data, 'Japanese', { goal: 180 }, '2026-09-05');
  const result = stats(data, '2026-09-05');
  assert.deepEqual(result.daily.map(day => day.goalMet), [true, true, false, false, true]);
  assert.equal(result.currentStreak, 1);
  assert.equal(result.bestStreak, 2);
  assert.equal(result.goalEligibleDays, 3);
  assert.equal(result.goalPercent, 100);
  assert.equal(stats(data, '2026-09-04', 1).goalPercent, null);
});

test('backdated imports and log removal recalculate streaks against historical goals', () => {
  const data = fixture();
  configureJourney(data, 'Japanese', { goal: 120 }, '2026-09-02');
  configureJourney(data, 'Japanese', { goal: 180 }, '2026-09-03');
  log(data, '2026-09-01', 180); log(data, '2026-09-03', 180);
  assert.equal(stats(data, '2026-09-03').currentStreak, 1);
  importCsv(data, 'Japanese', '2026-09-02,120');
  assert.equal(stats(data, '2026-09-03').currentStreak, 3);
  const id = data.entries.at(-1).id;
  removeLog(data, id);
  assert.equal(stats(data, '2026-09-03').currentStreak, 1);
  assert.equal(stats(data, '2026-09-03').bestStreak, 1);
});

test('empty journeys and goal-free logs have no streak, and other units work', () => {
  const data = fixture(); data.activities[0].goal = null;
  let result = stats(data, '2026-09-01');
  assert.equal(result.currentStreak, 0);
  assert.equal(result.bestStreak, 0);
  assert.equal(result.goalPercent, null);
  log(data, '2026-09-01', 500);
  assert.equal(stats(data, '2026-09-01').bestStreak, 0);
  configureJourney(data, null, { name: 'Reading', unit: 'pages', goal: 20 }, '2026-09-01');
  addLog(data, 'Reading', 20, '2026-09-01');
  assert.equal(statistics(data, 'Reading', 1, '2026-09-01').currentStreak, 1);
});

test('changing measurements before any logs starts goals in the new unit', () => {
  const data = fixture();
  configureJourney(data, 'Japanese', { unit: 'pages', goal: 20 }, '2026-09-02');
  assert.deepEqual(goalHistoryOf(data.activities[0]), [{ date: '2026-09-02', goal: 20 }]);
  assert.equal(goalOn(data.activities[0], '2026-09-01'), null);
});

test('daily charts use historical targets and cursor shows the exact goal for its day', () => {
  const data = fixture();
  configureJourney(data, 'Japanese', { goal: 120 }, '2026-09-02');
  log(data, '2026-09-01', 180); log(data, '2026-09-02', 120);
  configureJourney(data, 'Japanese', { goal: 180 }, '2026-09-03');
  const result = stats(data, '2026-09-03');
  assert.deepEqual(bucketsFor(result.daily, 3).buckets.map(bucket => bucket.goal), [180, 120, 180]);
  assert.equal(bucketsFor(result.daily, 1).buckets[0].goal, 160);
  const rendered = plot(result, { color: false, cursor: 1 }).join('\n');
  assert.match(rendered, /Goal: 120 min · met/);
  assert.match(rendered, /Daily goals by date/);
  assert.doesNotMatch(rendered, /Daily goal: 180 min/);
  configureJourney(data, 'Japanese', { goal: null }, '2026-09-03');
  assert.equal(bucketsFor(stats(data, '2026-09-03').daily, 1).buckets[0].goal, null);
});
