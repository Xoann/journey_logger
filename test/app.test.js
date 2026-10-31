import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { addLog, configureJourney, dayString, goalOn, importCsv, shiftDay, statistics } from '../src/journeys.js';
import { ensureEntryIds, load, save } from '../src/storage.js';
import { handleKey, initialState, openForm, renderApp, runTui } from '../src/tui.js';
import { widthOf } from '../src/terminal.js';
import { bucketsFor, plot } from '../src/plot.js';
import { main } from '../src/cli.js';

function fixture() {
  return { version: 1, activities: [{ name: 'Writing', color: 'cyan', goal: 60 }], entries: [
    { activity: 'Writing', minutes: 20, date: '2026-03-07' },
    { activity: 'Writing', minutes: 40, date: '2026-03-07' },
    { activity: 'Writing', minutes: 30, date: '2026-03-09' },
    { activity: 'Writing', minutes: 0, date: '2026-03-10' },
    { activity: 'Writing', minutes: 500, date: '2026-03-11' }
  ] };
}
function temporary(data = fixture()) {
  process.env.JOURNEY_LOGGER_FILE = join(mkdtempSync(join(tmpdir(), 'journey-app-')), 'data.json');
  save(data);
  return initialState(ensureEntryIds(load()));
}
const key = (state, name, text = '', extra = {}) => handleKey(state, text, { name, ...extra });
const submit = state => key(state, 's', '', { ctrl: true });

test('statistics sum multiple logs per day and include zero days, today, and DST dates', () => {
  const result = statistics(fixture(), 'writing', 4, '2026-03-10');
  assert.deepEqual(result.daily.map(d => d.amount), [60, 0, 30, 0]);
  assert.deepEqual(result.daily.map(d => d.cumulative), [60, 60, 90, 90]);
  assert.equal(result.total, 90);
  assert.equal(result.average, 22.5);
  assert.equal(result.activeAverage, 45);
  assert.equal(result.activePercent, 50);
  assert.equal(result.goalPercent, 25);
  assert.equal(result.lifetime, 90); // future entries are not completed progress
  assert.equal(statistics(fixture(), 'Writing', 'all', '2026-03-10').days, 4);
});

test('empty periods and leap days produce finite, explicit statistics', () => {
  const data = { activities: [{ name: 'Read' }], entries: [] };
  const empty = statistics(data, 'Read', 'all', '2024-02-29');
  assert.equal(empty.days, 1);
  assert.equal(empty.goalPercent, null);
  assert.equal(empty.activeAverage, 0);
  assert.deepEqual(statistics(data, 'Read', 3, '2024-03-01').daily.map(d => d.date), ['2024-02-28', '2024-02-29', '2024-03-01']);
  assert.throws(() => statistics(data, 'Read', 0), /range/);
});

test('rename preserves history; units with logs cannot be relabeled; goals validate', () => {
  const data = fixture();
  configureJourney(data, 'Writing', { name: 'Drafting', goal: 90 });
  assert.ok(data.entries.every(e => e.activity === 'Drafting'));
  const before = JSON.stringify(data);
  assert.throws(() => configureJourney(data, 'Drafting', { unit: 'pages' }), /Units cannot change/);
  assert.throws(() => configureJourney(data, 'Drafting', { name: 'Changed', goal: -1 }), /positive/);
  assert.equal(JSON.stringify(data), before);
  configureJourney(data, 'Drafting', { goal: null });
  assert.equal(data.activities[0].goal, null);
});

test('non-time journeys stay separate and legacy entries retain minutes', () => {
  const data = fixture();
  configureJourney(data, null, { name: 'Reading', unit: 'pages', goal: 10 });
  const entry = addLog(data, 'reading', 12.5, '2026-03-10');
  assert.equal(entry.amount, 12.5);
  assert.equal(entry.minutes, undefined);
  assert.equal(statistics(data, 'Reading', 4, '2026-03-10').total, 12.5);
  assert.equal(statistics(data, 'Writing', 4, '2026-03-10').total, 90);
  assert.throws(() => addLog(data, 'reading', Infinity), /positive/);
});

test('CSV validates the complete batch before appending, supports both date formats', () => {
  const data = fixture(), before = JSON.stringify(data);
  assert.throws(() => importCsv(data, 'Writing', '3/1/2026,12\n2/30/2026,5'), /row 2/);
  assert.equal(JSON.stringify(data), before);
  assert.equal(importCsv(data, 'Writing', '\uFEFF3/1/2026,12\n2026-03-02,0'), 2);
  assert.equal(data.entries.at(-1).date, '2026-03-02');
  assert.ok(data.entries.every(e => Number.isInteger(e.id)));
});

test('chart buckets retain exact total and use daily averages for partial buckets', () => {
  const stats = statistics(fixture(), 'Writing', 4, '2026-03-10');
  const { buckets } = bucketsFor(stats.daily, 3);
  assert.equal(buckets.reduce((sum, b) => sum + b.amount, 0), 90);
  assert.equal(buckets.at(-1).cumulative, 90);
  const rendered = plot(stats, { width: 60, height: 8, color: false, cursor: 0 }).join('\n');
  assert.match(rendered, /Daily goal: 60 min/);
  assert.match(rendered, /2026-03-07.*60 min/);
  assert.match(rendered, /03\/07.*03\/10/);
});

test('all screens and forms fit standard terminals, Unicode names, and NO_COLOR', () => {
  const state = initialState(ensureEntryIds(fixture()));
  state.data.activities[0].name = '日本語 immersion';
  for (const [width, height] of [[74, 24], [80, 24], [110, 36], [160, 48]]) {
    for (state.view = 0; state.view < 5; state.view++) {
      const screen = renderApp(state, { width, height, color: false });
      assert.ok(screen.split('\n').length <= height);
      assert.ok(screen.split('\n').every(line => widthOf(line) < width));
      assert.ok(!screen.includes('\x1b'));
      assert.ok(!screen.includes('NaN'));
    }
    openForm(state, 'settings');
    state.form.error = 'Test validation message';
    assert.match(renderApp(state, { width, height, color: false }), /Test validation message/);
    assert.match(renderApp(state, { width, height, color: false }), /Esc Cancel/);
    state.form = null;
  }
  assert.match(renderApp(state, { width: 50, height: 10 }), /Enlarge/);
});

test('all-time calendar scrolls to older weeks and returns to today', () => {
  const state = initialState(ensureEntryIds(fixture()));
  state.view = 2; state.range = 'all';
  const recent = renderApp(state, { width: 80, height: 24, color: false });
  key(state, 'pageup');
  assert.equal(state.calendarOffset, 4);
  assert.notEqual(renderApp(state, { width: 80, height: 24, color: false }), recent);
  key(state, 'end');
  assert.equal(state.calendarOffset, 0);
  assert.equal(renderApp(state, { width: 80, height: 24, color: false }), recent);
});

test('keyboard flow creates, logs, edits with stable IDs, and confirms deletion', () => {
  const state = temporary({ version: 1, activities: [], entries: [] });
  key(state, 'n', 'n');
  handleKey(state, 'Reading', {});
  key(state, 'return'); handleKey(state, '10', {});
  key(state, 'return'); key(state, 'right'); // pages
  submit(state);
  assert.equal(load().activities[0].unit, 'pages');
  key(state, 'l', 'l'); handleKey(state, '12', {}); submit(state);
  assert.equal(load().entries[0].amount, 12);
  const originalId = load().entries[0].id;
  key(state, '4', '4'); key(state, 'return');
  key(state, 'u', '', { ctrl: true }); handleKey(state, '15', {}); submit(state);
  assert.equal(load().entries[0].id, originalId);
  assert.equal(load().entries[0].amount, 15);
  key(state, 'd', 'd'); key(state, 'escape');
  assert.equal(load().entries.length, 1);
  key(state, 'd', 'd'); key(state, 'return');
  assert.equal(load().entries.length, 0);
  key(state, 'l', 'l'); handleKey(state, '1', {}); submit(state);
  assert.ok(load().entries[0].id > originalId);
  key(state, 's', 's'); key(state, 'd', 'd'); key(state, 'return');
  assert.equal(load().activities.length, 0);
});

test('invalid edit is not saved and app saves preserve a CLI log added while form is open', () => {
  const state = temporary();
  state.view = 3; openForm(state, 'edit');
  const before = readFileSync(process.env.JOURNEY_LOGGER_FILE, 'utf8');
  state.form.fields[0].value = '-1'; submit(state);
  assert.match(state.form.error, /positive/);
  assert.equal(readFileSync(process.env.JOURNEY_LOGGER_FILE, 'utf8'), before);
  key(state, 'escape'); openForm(state, 'log');
  const data = load(); addLog(data, 'Writing', 8, '2026-03-10'); save(data);
  state.form.fields[0].value = '9'; submit(state);
  assert.equal(load().entries.length, 7);
});

test('time log forms accept expressions, show totals, and keep invalid edits unsaved', () => {
  const state = temporary({ version: 1, activities: [{ name: 'Japanese', color: 'cyan' }], entries: [] });
  key(state, 'l', 'l');
  const screen = renderApp(state, { width: 74, height: 24, color: false });
  assert.match(screen, /3\*21\+45 = 108/);
  assert.match(screen, /Ctrl\+S Save/);
  handleKey(state, '3*21+45', {}); submit(state);
  assert.equal(state.form, null);
  assert.equal(load().entries[0].minutes, 108);
  assert.match(state.message, /108 min/);
  const originalId = load().entries[0].id, nextId = load().nextEntryId;

  key(state, '4', '4'); key(state, 'return');
  assert.equal(state.form.fields[0].value, '108');
  key(state, 'u', '', { ctrl: true }); handleKey(state, '(21+4)*3', {}); submit(state);
  assert.equal(load().entries[0].minutes, 75);
  assert.equal(load().entries[0].id, originalId);
  assert.equal(load().nextEntryId, nextId);

  key(state, 'return');
  const before = readFileSync(process.env.JOURNEY_LOGGER_FILE, 'utf8');
  key(state, 'u', '', { ctrl: true }); handleKey(state, '3/0', {}); submit(state);
  assert.match(state.form.error, /divide by zero/);
  assert.match(renderApp(state, { width: 74, height: 24, color: false }), /Cannot divide by zero/);
  assert.equal(state.form.fields[0].value, '3/0');
  assert.equal(readFileSync(process.env.JOURNEY_LOGGER_FILE, 'utf8'), before);
});

test('CSV import requires confirmation and cancelling leaves the file unchanged', () => {
  const state = temporary();
  const file = join(mkdtempSync(join(tmpdir(), 'journey-csv-')), 'logs.csv');
  writeFileSync(file, '3/10/2026,15');
  openForm(state, 'import'); state.form.fields[0].value = file; submit(state);
  assert.match(state.confirm.title, /1 LOGS/);
  assert.equal(load().entries.length, 5);
  key(state, 'escape'); assert.equal(load().entries.length, 5);
  openForm(state, 'import'); state.form.fields[0].value = file; submit(state); key(state, 'return');
  assert.equal(load().entries.length, 6);
});

test('settings save dated goals and all screens retain earlier achievements and streaks', () => {
  const today = dayString(), yesterday = shiftDay(today, -1), earlier = shiftDay(today, -2);
  const state = temporary({ version: 1, activities: [{ name: 'Japanese', color: 'cyan', goal: 120,
    goalHistory: [{ date: null, goal: 180 }, { date: yesterday, goal: 120 }] }], entries: [
    { activity: 'Japanese', minutes: 180, date: earlier }, { activity: 'Japanese', minutes: 120, date: yesterday },
  ] });
  openForm(state, 'settings'); state.form.fields[1].value = '180'; submit(state);
  assert.equal(goalOn(load().activities[0], yesterday), 120);
  assert.equal(goalOn(load().activities[0], today), 180);
  for (const [width, height] of [[74, 24], [80, 24], [110, 36]]) {
    state.view = 0;
    const overview = renderApp(state, { width, height, color: false });
    assert.match(overview, /CURRENT STREAK.*LONGEST STREAK/);
    assert.match(overview, /2 days.*2 days/);
    state.view = 2;
    assert.equal((renderApp(state, { width, height, color: false }).match(/◆/g) || []).length, 3); // two wins + legend
    state.view = 1; state.cumulative = false; state.cursor = 28;
    assert.match(renderApp(state, { width, height, color: false }), /Goal: 120 min · met/);
    state.view = 4; key(state, 'h', 'h');
    const history = renderApp(state, { width, height, color: false });
    assert.match(history, new RegExp(`${today}.*180 min`));
    assert.match(history, new RegExp(`${yesterday}.*120 min`));
    assert.match(history, /Earlier days.*180 min/);
    assert.match(history, /Esc \/ H Back/);
    key(state, 'escape'); assert.equal(state.goalHistoryOffset, null);
  }
});

test('long goal history scrolls without writing data', () => {
  const state = temporary();
  state.data.activities[0].goalHistory = Array.from({ length: 20 }, (_, i) => ({ date: shiftDay(dayString(), i - 19), goal: 60 + i }));
  const before = readFileSync(process.env.JOURNEY_LOGGER_FILE, 'utf8');
  state.view = 4; key(state, 'h', 'h'); key(state, 'end');
  assert.equal(state.goalHistoryOffset, 19);
  const screen = renderApp(state, { width: 74, height: 24, color: false });
  assert.match(screen, /20–20 of 20/);
  assert.match(screen, /60 min/);
  key(state, 'pageup'); assert.equal(state.goalHistoryOffset, 9);
  key(state, 'home'); assert.equal(state.goalHistoryOffset, 0);
  key(state, 'h', 'h'); assert.equal(state.goalHistoryOffset, null);
  assert.equal(readFileSync(process.env.JOURNEY_LOGGER_FILE, 'utf8'), before);
});

test('CLI settings and non-time logging work without mixing units in time charts', () => {
  temporary({ version: 1, activities: [], entries: [] });
  const messages = [], original = console.log;
  console.log = value => messages.push(value);
  try {
    main(['activity', 'add', 'Reading', '--unit', 'pages', '--goal', '10']);
    main(['log', 'Reading', '12']);
    main(['activity', 'set', 'Reading', '--name', 'Books', '--goal', '15']);
    main(['activities']); main(['history']); main(['trend']); main(['dashboard']);
    assert.equal(load().entries[0].activity, 'Books');
    assert.equal(load().activities[0].goal, 15);
    assert.match(messages.join('\n'), /12 pages/);
    assert.match(messages.join('\n'), /Time journeys only/);
    assert.ok(!messages.join('\n').includes('NaN'));
  } finally { console.log = original; }
});

test('terminal lifecycle restores raw mode and screen after keyboard exit', async () => {
  temporary();
  const input = new PassThrough(), output = new PassThrough();
  input.isTTY = output.isTTY = true;
  input.isRaw = false;
  input.setRawMode = value => { input.isRaw = value; };
  output.columns = 80; output.rows = 24;
  let rendered = ''; output.on('data', chunk => { rendered += chunk; });
  const app = runTui({ input, output });
  assert.equal(input.isRaw, true);
  input.write('2'); input.write('c'); input.write('l');
  input.emit('keypress', '', { name: 'escape' });
  input.write('q');
  await app;
  assert.equal(input.isRaw, false);
  assert.match(rendered, /\x1b\[\?1049h/);
  assert.match(rendered, /\x1b\[\?1049l/);
  assert.equal(input.listenerCount('keypress'), 0);
  assert.equal(output.listenerCount('resize'), 0);
});
