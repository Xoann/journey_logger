import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureDayReset, dayResetTime, normalizeResetTime, resolveLogDate, trackingDay } from '../src/days.js';
import { addLog, categoryStatistics, configureJourney, currentDayProgress, statistics } from '../src/journeys.js';
import { handleKey, initialState, openForm, renderApp } from '../src/tui.js';
import { load, save } from '../src/storage.js';
import { main } from '../src/cli.js';
import { cumulativeChart, heatmap } from '../src/charts.js';
import { widthOf } from '../src/terminal.js';

process.env.TZ = 'America/Toronto';
const RealDate = Date;
function at(time, action) {
  const timestamp = new RealDate(time).valueOf(), previous = globalThis.Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [timestamp])); }
    static now() { return timestamp; }
  };
  try { return action(); } finally { globalThis.Date = previous; }
}
const fixture = () => ({ version: 1, settings: { dayResetTime: '07:00' }, activities: [{ name: 'Japanese', color: 'cyan', goal: 180 }], entries: [] });
function temporary(data = fixture()) {
  process.env.JOURNEY_LOGGER_FILE = join(mkdtempSync(join(tmpdir(), 'journey-days-')), 'data.json');
  save(data);
  return initialState(load());
}
const key = (state, name, text = '', extra = {}) => handleKey(state, text, { name, ...extra });
const submit = state => key(state, 's', '', { ctrl: true });

test('reset settings validate HH:MM and preserve all existing data and unrelated settings', () => {
  const data = fixture(); data.settings.other = true;
  addLog(data, 'Japanese', 180, '2026-10-05');
  const entries = JSON.stringify(data.entries), activities = JSON.stringify(data.activities);
  assert.equal(dayResetTime({}), '00:00');
  assert.equal(normalizeResetTime('7:00'), '07:00');
  assert.equal(normalizeResetTime(' 23:59 '), '23:59');
  assert.equal(configureDayReset(data, '6:30'), '06:30');
  assert.equal(data.settings.other, true);
  assert.equal(JSON.stringify(data.entries), entries);
  assert.equal(JSON.stringify(data.activities), activities);
  for (const value of ['', '24:00', '07:60', '7:7', '-1:00', '7am', '07:00:00']) {
    const before = JSON.stringify(data);
    assert.throws(() => configureDayReset(data, value), /00:00 to 23:59/);
    assert.equal(JSON.stringify(data), before);
  }
});

test('tracking days change exactly at the configured local reset, including date boundaries', () => {
  const data = fixture();
  for (const [time, expected] of [
    ['2026-10-06T00:00:00', '2026-10-05'], ['2026-10-06T06:59:59', '2026-10-05'],
    ['2026-10-06T07:00:00', '2026-10-06'], ['2026-10-06T23:59:59', '2026-10-06'],
    ['2027-01-01T03:00:00', '2026-12-31'], ['2024-03-01T06:59:59', '2024-02-29'],
  ]) assert.equal(trackingDay(data, new RealDate(time)), expected, time);
  assert.equal(trackingDay({}, new RealDate('2026-10-06T00:00:00')), '2026-10-06');
  configureDayReset(data, '07:30');
  assert.equal(trackingDay(data, new RealDate('2026-10-06T07:29:59')), '2026-10-05');
  assert.equal(trackingDay(data, new RealDate('2026-10-06T07:30:00')), '2026-10-06');
});

test('local reset remains at 7am on spring-forward and fall-back days', () => {
  const data = fixture();
  for (const [time, expected] of [
    ['2026-03-08T01:59:59-05:00', '2026-03-07'],
    ['2026-03-08T03:00:00-04:00', '2026-03-07'],
    ['2026-03-08T06:59:59-04:00', '2026-03-07'],
    ['2026-03-08T07:00:00-04:00', '2026-03-08'],
    ['2026-11-01T01:30:00-04:00', '2026-10-31'],
    ['2026-11-01T01:30:00-05:00', '2026-10-31'],
    ['2026-11-01T06:59:59-05:00', '2026-10-31'],
    ['2026-11-01T07:00:00-05:00', '2026-11-01'],
  ]) assert.equal(trackingDay(data, new RealDate(time)), expected, time);
});

test('today and yesterday use the tracking day while explicit dates stay literal', () => {
  const data = fixture(), now = new RealDate('2026-10-06T02:00:00');
  for (const value of [undefined, '', 'today', 'TODAY']) assert.equal(resolveLogDate(value, data, now), '2026-10-05');
  assert.equal(resolveLogDate('yesterday', data, now), '2026-10-04');
  assert.equal(resolveLogDate('2026-10-06', data, now), '2026-10-06');
  assert.throws(() => resolveLogDate('2026-02-30', data, now), /valid/);
});

test('automatic logs, goal changes, statistics, category charts, and streaks share the same day', () => {
  const data = fixture();
  addLog(data, 'Japanese', 180, '2026-10-04');
  at('2026-10-06T02:00:00', () => {
    assert.equal(addLog(data, 'Japanese', '2*60').date, '2026-10-05');
    configureJourney(data, 'Japanese', { goal: 120 });
    assert.deepEqual(data.activities[0].goalHistory.at(-1), { date: '2026-10-05', goal: 120 });
    assert.equal(statistics(data, 'Japanese').end, '2026-10-05');
    assert.equal(categoryStatistics(data, 'Japanese').end, '2026-10-05');
    assert.equal(statistics(data, 'Japanese').currentStreak, 2);
    assert.equal(currentDayProgress(data, 'Japanese').goalMet, true);
  });
  at('2026-10-06T07:00:00', () => {
    const progress = currentDayProgress(data, 'Japanese');
    assert.equal(progress.date, '2026-10-06');
    assert.equal(progress.amount, 0);
    assert.equal(progress.remaining, 120);
    assert.equal(statistics(data, 'Japanese').currentStreak, 2);
  });
  at('2026-10-07T06:59:59', () => assert.equal(statistics(data, 'Japanese').currentStreak, 2));
  at('2026-10-07T07:00:00', () => assert.equal(statistics(data, 'Japanese').currentStreak, 0));
});

test('current-day goals follow saved history, sum all entries, and handle no goal and excess progress', () => {
  const data = fixture();
  data.activities[0].goalHistory = [{ date: null, goal: 180 }, { date: '2026-10-06', goal: 120 }];
  data.activities[0].goal = 120;
  addLog(data, 'Japanese', 60, '2026-10-05'); addLog(data, 'Japanese', 75, '2026-10-05');
  addLog(data, 'Japanese', 180, '2026-10-06');
  const early = currentDayProgress(data, 'Japanese', new RealDate('2026-10-06T02:00:00'));
  assert.equal(early.amount, 135); assert.equal(early.goal, 180); assert.equal(early.remaining, 45);
  const later = currentDayProgress(data, 'Japanese', new RealDate('2026-10-06T07:00:00'));
  assert.equal(later.goal, 120); assert.equal(later.remaining, 0); assert.equal(later.goalMet, true);
  const before = JSON.stringify(data.activities[0].goalHistory);
  at('2026-10-06T02:00:00', () => configureJourney(data, 'Japanese', { color: 'blue' }));
  assert.equal(JSON.stringify(data.activities[0].goalHistory), before);
  configureJourney(data, 'Japanese', { goal: null }, '2026-10-06');
  assert.equal(currentDayProgress(data, 'Japanese', new RealDate('2026-10-06T08:00:00')).remaining, null);
});

test('today goal and remaining time stay visible on every screen at standard terminal sizes', () => {
  at('2026-10-06T02:00:00', () => {
    const data = fixture(); addLog(data, 'Japanese', 135, '2026-10-05');
    const state = initialState(data);
    for (const [width, height] of [[74, 24], [80, 24], [110, 36]]) for (state.view = 0; state.view < 5; state.view++) {
      const screen = renderApp(state, { width, height, color: false });
      assert.match(screen.split('\n')[0], /Today: 135 \/ 180 min · 45 min left/);
      assert.match(screen, /Day: 2026-10-05 · resets 07:00 local/);
      assert.ok(screen.split('\n').length <= height);
      assert.ok(screen.split('\n').every(line => widthOf(line) < width));
    }
    addLog(data, 'Japanese', 45, '2026-10-05'); state.view = 0;
    assert.match(renderApp(state, { color: false }).split('\n')[0], /180 \/ 180 min · Goal met!/);
    data.activities[0].goal = null;
    assert.match(renderApp(state, { color: false }).split('\n')[0], /180 min · No goal set/);
  });
});

test('reset settings form validates and persists without changing existing logs or goals', () => {
  const data = fixture(); addLog(data, 'Japanese', 180, '2026-10-06');
  const state = temporary(data), entries = JSON.stringify(load().entries), activities = JSON.stringify(load().activities);
  state.view = 4; key(state, 't', 't');
  assert.equal(state.form.kind, 'day-reset');
  assert.match(renderApp(state, { width: 74, height: 24, color: false }), /ALL JOURNEYS/);
  const before = readFileSync(process.env.JOURNEY_LOGGER_FILE, 'utf8');
  state.form.fields[0].value = '24:00'; submit(state);
  assert.match(state.form.error, /23:59/);
  assert.equal(readFileSync(process.env.JOURNEY_LOGGER_FILE, 'utf8'), before);
  state.form.fields[0].value = '7:30'; submit(state);
  assert.equal(state.form, null);
  assert.equal(load().settings.dayResetTime, '07:30');
  assert.equal(JSON.stringify(load().entries), entries);
  assert.equal(JSON.stringify(load().activities), activities);
  assert.match(state.message, /07:30 local/);
});

test('a log form resolves today when saved, including across reset and concurrent setting changes', () => {
  const state = temporary();
  at('2026-10-06T06:59:00', () => { openForm(state, 'log'); state.form.fields[0].value = '30'; });
  assert.equal(state.form.fields[1].value, 'today');
  at('2026-10-06T07:01:00', () => submit(state));
  assert.equal(load().entries[0].date, '2026-10-06');
  at('2026-10-07T02:00:00', () => {
    const data = load(); configureDayReset(data, '00:00'); save(data); state.data = load();
    openForm(state, 'log'); state.form.fields[0].value = '45';
    const fresh = load(); configureDayReset(fresh, '07:00'); save(fresh);
    submit(state);
    assert.equal(load().entries[1].date, '2026-10-06');
    state.view = 3; openForm(state, 'edit'); state.form.fields[1].value = '2026-10-07'; submit(state);
    assert.equal(load().entries[1].date, '2026-10-07');
  });
});

test('CLI config, default dates, yesterday, goal display, and trend ranges respect the reset', () => {
  temporary();
  const messages = [], errors = [], originalLog = console.log, originalError = console.error, originalExit = process.exitCode;
  console.log = message => messages.push(message); console.error = message => errors.push(message);
  try {
    at('2026-10-06T02:00:00', () => {
      main(['config', 'day-reset', '7:00']);
      main(['log', 'Japanese', '120']); main(['log', 'Japanese', '60', '--yesterday']);
      main(['log', 'Japanese', '999', '2026-10-06']);
      main(['today', 'japanese']); main(['trend', '--days', '1']);
      assert.deepEqual(load().entries.map(entry => entry.date), ['2026-10-05', '2026-10-04', '2026-10-06']);
      assert.equal(load().settings.dayResetTime, '07:00');
      assert.match(messages.join('\n'), /Today · 2026-10-05 · resets 07:00/);
      assert.match(messages.join('\n'), /Japanese: 120 \/ 180 min · 60 min left/);
      assert.match(messages.join('\n'), /last 1 days \(2\.0h\)/);
      const before = readFileSync(process.env.JOURNEY_LOGGER_FILE, 'utf8');
      main(['config', 'day-reset', 'oops']); assert.equal(process.exitCode, 2);
      assert.equal(readFileSync(process.env.JOURNEY_LOGGER_FILE, 'utf8'), before);
      assert.match(errors.join('\n'), /00:00 to 23:59/);
    });
  } finally { console.log = originalLog; console.error = originalError; process.exitCode = originalExit; }
});

test('legacy CLI chart endpoints accept the tracking date, with heatmap days aligned to Monday', () => {
  const entries = [{ date: '2026-10-05', minutes: 180 }, { date: '2026-10-06', minutes: 60 }];
  assert.match(cumulativeChart(entries, 1, '2026-10-05'), /last 1 days \(3\.0h\)/);
  const chart = heatmap(entries.slice(0, 1), 1, false, '2026-10-05');
  assert.match(chart, /Mon  █/);
  assert.match(chart, /Sun  ·/);
});
