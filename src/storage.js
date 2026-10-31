import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';

export function dataPath() {
  return process.env.JOURNEY_LOGGER_FILE
    ? resolve(process.env.JOURNEY_LOGGER_FILE)
    : resolve(homedir(), '.journey-logger.json');
}

export function load(path = dataPath()) {
  if (!existsSync(path)) return { version: 1, activities: [], entries: [] };
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`Could not read data file ${path}: invalid JSON.`);
  }
  if (!data || !Array.isArray(data.activities) || !Array.isArray(data.entries)) {
    throw new Error(`Could not read data file ${path}: unexpected format.`);
  }
  return data;
}

export function ensureEntryIds(data) {
  const used = new Set();
  for (const entry of data.entries) {
    if (entry.id === undefined) continue;
    if (!Number.isSafeInteger(entry.id) || entry.id < 1 || used.has(entry.id)) {
      throw new Error('Could not read data file: entry IDs must be unique positive integers.');
    }
    used.add(entry.id);
  }
  if (data.nextEntryId !== undefined && (!Number.isSafeInteger(data.nextEntryId) || data.nextEntryId < 1)) {
    throw new Error('Could not read data file: nextEntryId must be a positive integer.');
  }
  const highestId = [...used].reduce((highest, id) => Math.max(highest, id), 0);
  let nextId = Math.max(data.nextEntryId ?? 1, highestId + 1);
  for (const entry of data.entries) {
    if (entry.id === undefined) {
      while (used.has(nextId)) nextId++;
      entry.id = nextId++;
      used.add(entry.id);
    }
  }
  data.nextEntryId = nextId;
  return data;
}

export function save(data, path = dataPath()) {
  ensureEntryIds(data);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  renameSync(temp, path);
  return path;
}
