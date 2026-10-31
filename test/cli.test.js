import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { main, resolveDate } from '../src/cli.js';
import { dayString, shiftDay } from '../src/journeys.js';

function useTempData() { process.env.JOURNEY_LOGGER_FILE = join(mkdtempSync(join(tmpdir(), 'journey-')), 'logs.json'); }

test('adding an activity then logging writes the canonical activity', () => {
  useTempData(); main(['activity', 'add', 'Writing', '--color', 'blue']); main(['log', 'writing', '45', '2026-02-01']);
  const data = JSON.parse(readFileSync(process.env.JOURNEY_LOGGER_FILE));
  assert.deepEqual(data.entries, [{ id: 1, activity: 'Writing', minutes: 45, date: '2026-02-01' }]);
  assert.equal(data.nextEntryId, 2);
});

test('history shows IDs and undo removes only the chosen log', () => {
  useTempData(); main(['activity', 'add', 'Writing']);
  main(['log', 'Writing', '45', '2026-02-01']);
  main(['log', 'Writing', '45', '2026-02-01']);
  const messages = []; const original = console.log;
  try { console.log = message => messages.push(message); main(['history']); }
  finally { console.log = original; }
  assert.match(messages.join('\n'), /1\s+2026-02-01/);
  assert.match(messages.join('\n'), /2\s+2026-02-01/);
  main(['log', 'undo', '1']);
  main(['log', 'Writing', '30', '2026-02-02']);
  const data = JSON.parse(readFileSync(process.env.JOURNEY_LOGGER_FILE));
  assert.deepEqual(data.entries.map(entry => entry.id), [2, 3]);
  assert.equal(data.nextEntryId, 4);
});

test('legacy logs get stable IDs when an entry is undone', () => {
  useTempData();
  writeFileSync(process.env.JOURNEY_LOGGER_FILE, JSON.stringify({ version: 1, activities: [{ name: 'Writing', color: 'cyan' }], entries: [
    { activity: 'Writing', minutes: 10, date: '2026-02-01' },
    { activity: 'Writing', minutes: 20, date: '2026-02-02' }
  ] }));
  main(['history']); main(['log', 'undo', '1']);
  const data = JSON.parse(readFileSync(process.env.JOURNEY_LOGGER_FILE));
  assert.deepEqual(data.entries, [{ id: 2, activity: 'Writing', minutes: 20, date: '2026-02-02' }]);
  assert.equal(data.nextEntryId, 3);
});

test('undo rejects an unknown ID without changing the file', () => {
  useTempData(); main(['activity', 'add', 'Writing']); main(['log', 'Writing', '30']);
  const before = readFileSync(process.env.JOURNEY_LOGGER_FILE, 'utf8');
  const original = console.error; console.error = () => {};
  try { process.exitCode = undefined; main(['log', 'undo', '2']); assert.equal(process.exitCode, 2); }
  finally { process.exitCode = undefined; console.error = original; }
  assert.equal(readFileSync(process.env.JOURNEY_LOGGER_FILE, 'utf8'), before);
});

test('recognizes date shorthands', () => {
  assert.match(resolveDate('today'), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(resolveDate('yesterday'), /^\d{4}-\d{2}-\d{2}$/);
});

test('logs to yesterday with the --yesterday flag', () => {
  useTempData(); main(['activity', 'add', 'Reading']); main(['log', 'Reading', '30', '--yesterday']);
  const data = JSON.parse(readFileSync(process.env.JOURNEY_LOGGER_FILE));
  assert.equal(data.entries[0].date, resolveDate('yesterday'));
});

test('accepts fractional minutes', () => {
  useTempData(); main(['activity', 'add', 'Reading']); main(['log', 'Reading', '57.5', '2026-02-01']);
  const data = JSON.parse(readFileSync(process.env.JOURNEY_LOGGER_FILE));
  assert.equal(data.entries[0].minutes, 57.5);
});

test('CLI logs the calculated total and preserves date options for expressions', () => {
  useTempData(); main(['activity', 'add', 'Japanese']);
  const messages = [], original = console.log;
  console.log = message => messages.push(message);
  try {
    main(['log', 'japanese', '3*21+45', '--yesterday']);
    main(['log', 'Japanese', '(21 + 4) * 3', '2026-02-01']);
  } finally { console.log = original; }
  const data = JSON.parse(readFileSync(process.env.JOURNEY_LOGGER_FILE));
  assert.deepEqual(data.entries, [
    { id: 1, activity: 'Japanese', date: resolveDate('yesterday'), minutes: 108 },
    { id: 2, activity: 'Japanese', date: '2026-02-01', minutes: 75 },
  ]);
  assert.match(messages.join('\n'), /Logged 108m/);
  assert.match(messages.join('\n'), /Logged 75m/);
});

test('CLI rejects invalid expressions without changing saved data or consuming IDs', () => {
  useTempData(); main(['activity', 'add', 'Japanese']);
  const before = readFileSync(process.env.JOURNEY_LOGGER_FILE, 'utf8');
  const errors = [], original = console.error, originalExitCode = process.exitCode;
  console.error = message => errors.push(message);
  try {
    for (const input of ['3*', '1/0', '3-5', 'process.exit()']) {
      process.exitCode = undefined;
      main(['log', 'Japanese', input]);
      assert.equal(process.exitCode, 2);
      assert.equal(readFileSync(process.env.JOURNEY_LOGGER_FILE, 'utf8'), before);
    }
    assert.equal(errors.length, 4);
  } finally { console.error = original; process.exitCode = originalExitCode; }
});

test('activities summary includes time, count, and latest date', () => {
  useTempData(); main(['activity', 'add', 'Writing']); main(['log', 'Writing', '30', '2026-02-01']); main(['log', 'Writing', '45', '2026-02-03']);
  const messages = []; const original = console.log; console.log = message => messages.push(message);
  main(['activities']); console.log = original;
  assert.match(messages.join('\n'), /1\.3h total/);
  assert.match(messages.join('\n'), /2 logs/);
  assert.match(messages.join('\n'), /2026-02-03/);
});

test('CLI goal updates save history and expose it alongside goal streaks', () => {
  useTempData();
  const today = dayString(), yesterday = shiftDay(today, -1);
  writeFileSync(process.env.JOURNEY_LOGGER_FILE, JSON.stringify({ version: 1,
    activities: [{ name: 'Japanese', color: 'cyan', goal: 180 }], entries: [{ activity: 'Japanese', date: yesterday, minutes: 180 }] }));
  const messages = [], original = console.log;
  console.log = message => messages.push(message);
  try {
    main(['activity', 'set', 'Japanese', '--goal', '120']);
    main(['log', 'Japanese', '120']);
    main(['activity', 'goals', 'japanese']);
    main(['activities']);
  } finally { console.log = original; }
  const data = JSON.parse(readFileSync(process.env.JOURNEY_LOGGER_FILE));
  assert.deepEqual(data.activities[0].goalHistory, [{ date: null, goal: 180 }, { date: today, goal: 120 }]);
  assert.match(messages.join('\n'), /Goal changes apply from today/);
  assert.match(messages.join('\n'), /Earlier days.*180 min/);
  assert.match(messages.join('\n'), new RegExp(`${today}.*120 min`));
  assert.match(messages.join('\n'), /Goal streak: 2 days · longest: 2 days/);
});

test('unknown activities set an error exit code', () => {
  useTempData(); process.exitCode = undefined; main(['log', 'Unknown', '30']); assert.equal(process.exitCode, 2); process.exitCode = undefined;
});
