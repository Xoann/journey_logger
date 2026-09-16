import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { main, resolveDate } from '../src/cli.js';

function useTempData() { process.env.JOURNEY_LOGGER_FILE = join(mkdtempSync(join(tmpdir(), 'journey-')), 'logs.json'); }

test('adding an activity then logging writes the canonical activity', () => {
  useTempData(); main(['activity', 'add', 'Writing', '--color', 'blue']); main(['log', 'writing', '45', '2026-02-01']);
  const data = JSON.parse(readFileSync(process.env.JOURNEY_LOGGER_FILE));
  assert.deepEqual(data.entries, [{ activity: 'Writing', minutes: 45, date: '2026-02-01' }]);
});

test('recognizes date shorthands', () => {
  assert.match(resolveDate('today'), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(resolveDate('yesterday'), /^\d{4}-\d{2}-\d{2}$/);
});

test('accepts fractional minutes', () => {
  useTempData(); main(['activity', 'add', 'Reading']); main(['log', 'Reading', '57.5', '2026-02-01']);
  const data = JSON.parse(readFileSync(process.env.JOURNEY_LOGGER_FILE));
  assert.equal(data.entries[0].minutes, 57.5);
});

test('activities summary includes time, count, and latest date', () => {
  useTempData(); main(['activity', 'add', 'Writing']); main(['log', 'Writing', '30', '2026-02-01']); main(['log', 'Writing', '45', '2026-02-03']);
  const messages = []; const original = console.log; console.log = message => messages.push(message);
  main(['activities']); console.log = original;
  assert.match(messages.join('\n'), /1\.3h total/);
  assert.match(messages.join('\n'), /2 logs/);
  assert.match(messages.join('\n'), /2026-02-03/);
});

test('unknown activities set an error exit code', () => {
  useTempData(); process.exitCode = undefined; main(['log', 'Unknown', '30']); assert.equal(process.exitCode, 2); process.exitCode = undefined;
});
