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

export function save(data, path = dataPath()) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  renameSync(temp, path);
  return path;
}
