import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveCategory, categoriesOf, categoryOf, configureCategory, normalizeHexColor } from '../src/categories.js';
import { addLog, categoryStatistics, configureJourney, dayString, editLog, importCsv, shiftDay, statistics } from '../src/journeys.js';
import { load, save } from '../src/storage.js';
import { handleKey, initialState, openForm, renderApp } from '../src/tui.js';
import { categoryPlot } from '../src/plot.js';
import { paint, strip, widthOf } from '../src/terminal.js';
import { main } from '../src/cli.js';

const fixture = () => ({ version: 1, activities: [{ name: 'Japanese', color: 'cyan', goal: 180 }], entries: [] });
const key = (state, name, text = '', extra = {}) => handleKey(state, text, { name, ...extra });
const submit = state => key(state, 's', '', { ctrl: true });
const clear = state => key(state, 'u', '', { ctrl: true });
function temporary(data = fixture()) {
  process.env.JOURNEY_LOGGER_FILE = join(mkdtempSync(join(tmpdir(), 'journey-categories-')), 'data.json');
  save(data);
  return initialState(load());
}

test('categories validate names and hex colours, preserve IDs, and are scoped to a journey', () => {
  const data = fixture(), activity = data.activities[0];
  const anime = configureCategory(activity, null, { name: ' Anime ', color: '#7faaf5' });
  assert.equal(anime.name, 'Anime');
  assert.equal(anime.color, '#7FAAF5');
  assert.equal(normalizeHexColor('#abc'), '#AABBCC');
  const id = anime.id;
  configureCategory(activity, id, { name: 'Animation', color: '#f00' });
  assert.equal(anime.id, id);
  assert.equal(anime.color, '#FF0000');
  for (const settings of [{ name: 'animation' }, { name: 'Unclassified' }, { name: '' }, { name: 'x'.repeat(41) }, { name: 'bad\x1bname' }, { name: 'YouTube', color: 'red' }, { name: 'YouTube', color: '#12345G' }]) {
    const before = JSON.stringify(data);
    assert.throws(() => configureCategory(activity, null, settings));
    assert.equal(JSON.stringify(data), before);
  }
  const other = configureJourney(data, null, { name: 'French' });
  assert.equal(configureCategory(other, null, { name: 'Animation' }).name, 'Animation');
});

test('category totals and curves sum to overall progress, including unclassified and fractional logs', () => {
  const data = fixture(), activity = data.activities[0];
  const anime = configureCategory(activity, null, { name: 'Anime' });
  const podcasts = configureCategory(activity, null, { name: 'Podcasts' });
  addLog(data, 'Japanese', 30, '2026-10-01', anime.id);
  addLog(data, 'Japanese', '3*21', '2026-10-02', anime.id);
  addLog(data, 'Japanese', 100, '2026-10-02', podcasts.id);
  addLog(data, 'Japanese', 17, '2026-10-02');
  addLog(data, 'Japanese', 180.5, '2026-10-03', podcasts.id);
  addLog(data, 'Japanese', 9999, '2026-10-04', anime.id); // future
  const before = JSON.stringify(data), overall = statistics(data, 'Japanese', 2, '2026-10-03');
  const result = categoryStatistics(data, 'Japanese', 2, '2026-10-03');
  assert.equal(JSON.stringify(data), before);
  assert.equal(result.total, overall.total);
  assert.equal(result.goalDays, 2);
  assert.equal(result.currentStreak, 2);
  assert.deepEqual(result.series.map(item => item.total), [63, 280.5, 17]);
  assert.deepEqual(result.series.map(item => item.lifetime), [93, 280.5, 17]);
  for (let i = 0; i < result.daily.length; i++) {
    assert.equal(result.series.reduce((sum, item) => sum + item.daily[i].amount, 0), result.daily[i].amount);
    assert.equal(result.series.reduce((sum, item) => sum + item.daily[i].cumulative, 0), result.daily[i].cumulative);
  }
});

test('legacy logs and CSV imports remain unclassified and can be assigned without changing totals or IDs', () => {
  const data = fixture();
  data.entries.push({ id: 1, activity: 'Japanese', date: '2026-10-01', minutes: 180 });
  const anime = configureCategory(data.activities[0], null, { name: 'Anime' });
  importCsv(data, 'Japanese', '2026-10-02,180');
  assert.equal(categoryStatistics(data, 'Japanese', 'all', '2026-10-02').series.at(-1).total, 360);
  const nextId = data.nextEntryId, before = statistics(data, 'Japanese', 2, '2026-10-02');
  editLog(data, 1, { amount: 180, date: '2026-10-01', categoryId: anime.id });
  assert.equal(data.entries[0].id, 1);
  assert.equal(data.nextEntryId, nextId);
  assert.deepEqual(statistics(data, 'Japanese', 2, '2026-10-02'), before);
  const result = categoryStatistics(data, 'Japanese', 'all', '2026-10-02');
  assert.deepEqual(result.series.map(item => item.total), [180, 180]);
  editLog(data, 1, { amount: 180, date: '2026-10-01', categoryId: null });
  assert.equal(data.entries[0].categoryId, undefined);
});

test('renaming journeys or categories and archiving preserves classifications across save and load', () => {
  const state = temporary(), data = state.data, activity = data.activities[0];
  const category = configureCategory(activity, null, { name: 'Anime' });
  addLog(data, 'Japanese', 180, '2026-10-01', category.id);
  configureCategory(activity, category.id, { name: 'Animation', color: '#123456' });
  archiveCategory(activity, category.id);
  configureJourney(data, 'Japanese', { name: 'Immersion' });
  save(data);
  const restored = load(), result = categoryStatistics(restored, 'Immersion', 'all', '2026-10-01');
  assert.equal(result.series[0].name, 'Animation');
  assert.equal(result.series[0].color, '#123456');
  assert.equal(result.series[0].archived, true);
  assert.equal(result.series[0].total, 180);
  assert.equal(result.currentStreak, 1);
  assert.equal(restored.entries[0].categoryId, category.id);
});

test('archived categories reject new logs but existing entries remain editable; invalid edits are atomic', () => {
  const data = fixture(), activity = data.activities[0];
  const category = configureCategory(activity, null, { name: 'Podcasts' });
  const old = addLog(data, 'Japanese', 120, '2026-10-01', category.id);
  const unclassified = addLog(data, 'Japanese', 60, '2026-10-01');
  archiveCategory(activity, category.id);
  let before = JSON.stringify(data);
  assert.throws(() => addLog(data, 'Japanese', 10, '2026-10-02', category.id), /archived/);
  assert.throws(() => editLog(data, unclassified.id, { amount: 10, date: '2026-10-02', categoryId: category.id }), /archived/);
  assert.throws(() => addLog(data, 'Japanese', 10, '2026-10-02', 999), /category/);
  assert.equal(JSON.stringify(data), before);
  editLog(data, old.id, { amount: '120+60', date: '2026-10-01', categoryId: category.id });
  assert.equal(old.minutes, 180);
  before = JSON.stringify(data);
  assert.throws(() => editLog(data, old.id, { amount: '1/0', date: '2026-10-02', categoryId: null }), /zero/);
  assert.equal(JSON.stringify(data), before);
  archiveCategory(activity, category.id, false);
  assert.equal(addLog(data, 'Japanese', 10, '2026-10-02', category.id).categoryId, category.id);
});

test('categories work for other measurements without mixing journeys', () => {
  const data = fixture();
  const books = configureJourney(data, null, { name: 'Books', unit: 'pages' }, '2026-10-01');
  const fiction = configureCategory(books, null, { name: 'Fiction' });
  addLog(data, 'Books', 20, '2026-10-01', fiction.id);
  addLog(data, 'Japanese', 180, '2026-10-01');
  assert.equal(categoryStatistics(data, 'Books', 'all', '2026-10-01').series[0].total, 20);
  assert.equal(categoryStatistics(data, 'Japanese', 'all', '2026-10-01').total, 180);
  assert.equal(categoryOf(data.activities[0], 999).name, 'Unclassified');
});

test('category graph uses true colours, labelled units, bounded rows, and selected curves without colour', () => {
  const data = fixture();
  const red = configureCategory(data.activities[0], null, { name: 'Anime', color: '#FF0000' });
  const blue = configureCategory(data.activities[0], null, { name: 'Podcasts', color: '#0000FF' });
  for (let i = 0; i < 5; i++) {
    addLog(data, 'Japanese', 60, shiftDay('2026-10-01', i), red.id);
    addLog(data, 'Japanese', 20, shiftDay('2026-10-01', i), blue.id);
  }
  const stats = categoryStatistics(data, 'Japanese', 'all', '2026-10-05');
  const lines = categoryPlot(stats, { width: 48, height: 4, cursor: 4 });
  assert.equal(lines.length, 8);
  assert.ok(lines.every(line => widthOf(line) <= 48));
  assert.match(lines.join('\n'), /\x1b\[38;2;255;0;0m/);
  assert.match(lines.join('\n'), /\x1b\[38;2;0;0;255m/);
  assert.match(strip(lines.join('\n')), /hours.*cumulative by category/);
  const plain = categoryPlot(stats, { color: false, selected: 1 }).join('\n');
  assert.match(plain, /selected: Podcasts/);
  assert.ok(!plain.includes('\x1b'));
  assert.equal(paint('x', '#123456'), '\x1b[38;2;18;52;86mx\x1b[0m');
});

test('terminal category workflow creates colours, logs expressions, edits tags, and archives without losing history', () => {
  const state = temporary();
  key(state, 's', 's'); key(state, 'c', 'c');
  assert.match(renderApp(state, { color: false }), /No categories yet/);
  key(state, 'n', 'n'); handleKey(state, 'Anime', {}); key(state, 'return');
  clear(state); handleKey(state, '#abc', {}); submit(state);
  const category = load().activities[0].categories[0];
  assert.equal(category.color, '#AABBCC');
  key(state, 'escape'); key(state, 'l', 'l');
  handleKey(state, '3*21+45', {}); key(state, 'tab'); key(state, 'tab'); key(state, 'right'); submit(state);
  assert.equal(load().entries[0].minutes, 108);
  assert.equal(load().entries[0].categoryId, category.id);
  const originalId = load().entries[0].id, nextId = load().nextEntryId;
  key(state, '4', '4'); key(state, 'return');
  state.form.fields[2].value = 'Unclassified'; submit(state);
  assert.equal(load().entries[0].categoryId, undefined);
  assert.equal(load().entries[0].id, originalId);
  assert.equal(load().nextEntryId, nextId);
  key(state, 'return'); state.form.fields[2].value = 'Anime'; submit(state);
  key(state, 's', 's'); key(state, 'c', 'c'); key(state, 'a', 'a');
  assert.equal(load().activities[0].categories[0].archived, true);
  assert.equal(load().entries[0].categoryId, category.id);
  key(state, 'escape'); key(state, 'l', 'l');
  assert.deepEqual(state.form.fields[2].options, ['Unclassified']); key(state, 'escape');
  key(state, '4', '4'); key(state, 'return');
  assert.equal(state.form.fields[2].value, 'Anime');
  state.form.fields[0].value = '120'; submit(state);
  assert.equal(load().entries[0].categoryId, category.id);
  key(state, 's', 's'); key(state, 'c', 'c'); key(state, 'a', 'a');
  assert.equal(load().activities[0].categories[0].archived, false);
});

test('invalid category forms stay open, and stale forms preserve concurrent category changes', () => {
  const state = temporary(); state.view = 4; key(state, 'c', 'c'); key(state, 'n', 'n');
  state.form.fields[0].value = 'YouTube'; state.form.fields[1].value = 'bad';
  const before = readFileSync(process.env.JOURNEY_LOGGER_FILE, 'utf8'); submit(state);
  assert.match(state.form.error, /hex colour/);
  assert.equal(readFileSync(process.env.JOURNEY_LOGGER_FILE, 'utf8'), before);
  state.form.fields[1].value = '#F00'; submit(state); key(state, 'escape');
  openForm(state, 'log'); state.form.fields[0].value = '45'; state.form.fields[2].value = 'YouTube';
  let data = load(); const id = data.activities[0].categories[0].id;
  configureCategory(data.activities[0], id, { name: 'Videos' }); save(data);
  submit(state);
  assert.equal(load().entries[0].categoryId, id);
  assert.equal(load().activities[0].categories[0].name, 'Videos');
  openForm(state, 'log'); state.form.fields[0].value = '60'; state.form.fields[2].value = 'Videos';
  data = load(); archiveCategory(data.activities[0], id); save(data);
  const archived = readFileSync(process.env.JOURNEY_LOGGER_FILE, 'utf8'); submit(state);
  assert.match(state.form.error, /archived/);
  assert.equal(readFileSync(process.env.JOURNEY_LOGGER_FILE, 'utf8'), archived);
});

test('category screens and forms fit small terminals with many categories, Unicode names, and no colour', () => {
  const data = fixture(), today = dayString();
  for (let i = 0; i < 12; i++) {
    const category = configureCategory(data.activities[0], null, { name: i === 0 ? '日本語 Podcasts' : `Category ${i}` });
    addLog(data, 'Japanese', 15 + i, today, category.id);
  }
  addLog(data, 'Japanese', 45, shiftDay(today, -1));
  const state = temporary(data); state.view = 1; key(state, 'b', 'b');
  for (const [width, height] of [[74, 24], [80, 24], [110, 36], [160, 48]]) {
    for (const color of [true, false]) {
      state.view = 1;
      const screen = renderApp(state, { width, height, color });
      assert.match(screen, /CUMULATIVE BY CATEGORY/);
      assert.match(screen, /totals since/);
      assert.match(screen, /R Range/);
      assert.ok(screen.split('\n').length <= height);
      assert.ok(screen.split('\n').every(line => widthOf(line) < width));
      assert.ok(!screen.includes('NaN'));
      if (!color) assert.ok(!screen.includes('\x1b'));
      state.view = 4; key(state, 'c', 'c'); key(state, 'end');
      assert.equal(state.categoryManagerIndex, 11);
      assert.match(renderApp(state, { width, height, color }), /Category 11/);
      key(state, 'return'); state.form.error = 'Test validation';
      assert.match(renderApp(state, { width, height, color }), /Test validation/);
      key(state, 'escape'); key(state, 'escape');
      openForm(state, 'log'); state.form.error = 'Test validation';
      assert.match(renderApp(state, { width, height, color }), /Test validation/);
      assert.match(renderApp(state, { width, height, color }), /Category/);
      key(state, 'escape');
    }
  }
  state.view = 1; state.categoryIndex = 0;
  key(state, 'down'); assert.equal(state.categoryIndex, 1); assert.equal(state.journey, 0);
  key(state, 'left'); assert.equal(state.cursor, 28);
  key(state, 'b', 'b'); assert.equal(state.categoryTrends, false);
});

test('CLI configures categories, logs by name with dates and expressions, and rejects invalid inputs without saving', () => {
  temporary();
  const messages = [], errors = [], originalLog = console.log, originalError = console.error, originalExit = process.exitCode;
  console.log = message => messages.push(message); console.error = message => errors.push(message);
  try {
    main(['category', 'add', 'Japanese', 'Anime', '--color', '#123456']);
    main(['category', 'add', 'Japanese', 'Live action', '--color', '#abc']);
    main(['log', 'Japanese', '3*21', '--category', 'anime', '--yesterday']);
    main(['log', 'Japanese', '45', '2026-10-01', '--category', 'Live action']);
    main(['category', 'set', 'Japanese', 'Anime', '--name', 'Animation', '--color', '#f00']);
    main(['categories', 'Japanese']); main(['history']);
    assert.match(messages.join('\n'), /Animation.*#FF0000/);
    assert.match(messages.join('\n'), /63 min.*Animation/);
    const data = load();
    assert.equal(data.entries[0].date, shiftDay(dayString(), -1));
    assert.equal(data.entries[0].categoryId, data.activities[0].categories[0].id);
    main(['category', 'archive', 'Japanese', 'Animation']);
    const before = readFileSync(process.env.JOURNEY_LOGGER_FILE, 'utf8');
    for (const args of [
      ['log', 'Japanese', '10', '--category', 'Animation'],
      ['log', 'Japanese', '10', '--category', 'Unknown'],
      ['log', 'Japanese', '10', '--category'],
      ['log', 'Japanese', '10', '--category', 'Live action', '--category', 'Live action'],
      ['category', 'add', 'Japanese', 'YouTube', '--color', 'blue'],
    ]) {
      process.exitCode = undefined; main(args); assert.equal(process.exitCode, 2);
      assert.equal(readFileSync(process.env.JOURNEY_LOGGER_FILE, 'utf8'), before);
    }
    process.exitCode = undefined;
    main(['category', 'restore', 'Japanese', 'Animation']);
    main(['log', 'Japanese', '60', '--category', 'Animation']);
    assert.equal(load().entries.length, 3);
    assert.equal(process.exitCode, undefined);
  } finally { console.log = originalLog; console.error = originalError; process.exitCode = originalExit; }
});
