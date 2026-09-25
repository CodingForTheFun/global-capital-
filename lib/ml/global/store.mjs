// Files for the global model, all under DATA_DIR/ml/global on the service volume.
//   obs-<sport>.jsonl   compact resolved observations (one per player market per game)
//   model-<sport>.json  the promoted champion for that sport, if any
//   state.json          export cursors and the last evaluation per sport
// Writes go to a temporary file and are renamed into place, so a crash never
// leaves a half-written model or observation file behind.
import { mkdir, readFile, rename, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { observationKey } from './observations.mjs';

export const RETENTION_DAYS = 400;
export const MAX_OBSERVATIONS = 400_000;
const MAX_FILE_BYTES = 256 * 1024 * 1024;

export function globalModelDir(env = process.env) {
  return path.resolve(env.DATA_DIR || './data', 'ml', 'global');
}

const safeSport = sport => String(sport || '').toUpperCase().replace(/[^A-Z0-9_]/g, '');

async function atomicWrite(file, body) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, body);
  await rename(tmp, file);
}

async function readSmall(file) {
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) return null;
    return await readFile(file, 'utf8');
  } catch { return null; }
}

export async function readObservations(sport, dir = globalModelDir()) {
  const raw = await readSmall(path.join(dir, `obs-${safeSport(sport)}.jsonl`));
  if (!raw) return [];
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      const o = JSON.parse(line);
      if (o && typeof o.e === 'string' && Number.isFinite(o.t) && Number.isFinite(o.a) && typeof o.p === 'string' && typeof o.m === 'string') out.push(o);
    } catch { /* one bad line never discards the file */ }
  }
  return out;
}

/** Newer observations replace older ones with the same identity; then retention and size caps apply. */
export function mergeObservations(existing, incoming, { now = Date.now(), retentionDays = RETENTION_DAYS, max = MAX_OBSERVATIONS } = {}) {
  const byKey = new Map();
  for (const o of existing) byKey.set(observationKey(o), o);
  for (const o of incoming) byKey.set(observationKey(o), o);
  const floor = now - retentionDays * 86_400_000;
  const merged = [...byKey.values()].filter(o => o.t >= floor && o.t <= now + 86_400_000).sort((a, b) => a.t - b.t);
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}

export async function writeObservations(sport, list, dir = globalModelDir()) {
  await atomicWrite(path.join(dir, `obs-${safeSport(sport)}.jsonl`), list.map(o => JSON.stringify(o)).join('\n') + (list.length ? '\n' : ''));
}

export async function readArtifact(sport, dir = globalModelDir()) {
  const raw = await readSmall(path.join(dir, `model-${safeSport(sport)}.json`));
  if (!raw) return null;
  try {
    const a = JSON.parse(raw);
    return a && Array.isArray(a.weights) && a.weights.every(Number.isFinite) && a.sport === safeSport(sport) ? a : null;
  } catch { return null; }
}

export async function writeArtifact(sport, artifact, dir = globalModelDir()) {
  await atomicWrite(path.join(dir, `model-${safeSport(sport)}.json`), JSON.stringify(artifact));
}

export async function readState(dir = globalModelDir()) {
  const raw = await readSmall(path.join(dir, 'state.json'));
  try { const s = raw ? JSON.parse(raw) : null; return s && typeof s === 'object' ? s : { sports: {} }; } catch { return { sports: {} }; }
}

export async function writeState(state, dir = globalModelDir()) {
  await atomicWrite(path.join(dir, 'state.json'), JSON.stringify(state, null, 1));
}
