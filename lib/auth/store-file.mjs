// File-backed account storage on the persistent Railway volume.
//
// Used when no Supabase service credentials are configured — local
// development, tests, and any deployment running without a database.
//
// Writes are atomic (write-temp, rename) and serialised through a promise
// chain so two concurrent registrations cannot clobber each other — the
// failure mode a naive read-modify-write would have.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { newUser, publicUser, normalizeEmail } from './user-shape.mjs';

const DATA = () => path.resolve(process.env.DATA_DIR || './data');
const FILE = () => path.join(DATA(), 'users.json');

// Every write goes through this chain, so they serialise rather than race.
let writeQueue = Promise.resolve();

async function readAll() {
  try {
    const parsed = JSON.parse(await fs.readFile(FILE(), 'utf8'));
    return Array.isArray(parsed?.users) ? parsed.users : [];
  } catch {
    return [];
  }
}

async function writeAll(users) {
  await fs.mkdir(DATA(), { recursive: true });
  const file = FILE();
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify({ version: 1, users }, null, 2), 'utf8');
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {});
  }
}

/** Run a read-modify-write with no other write interleaved. */
function transaction(mutate) {
  const run = writeQueue.then(async () => {
    const users = await readAll();
    const result = await mutate(users);
    if (result?.write !== false) await writeAll(users);
    return result?.value;
  });
  // Keep the chain alive even if this transaction rejects.
  writeQueue = run.then(() => {}, () => {});
  return run;
}

export const name = 'file';

export async function findByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return (await readAll()).find((user) => user.email === normalized) ?? null;
}

export async function findById(id) {
  if (!id) return null;
  return (await readAll()).find((user) => user.id === String(id)) ?? null;
}

export async function countUsers() {
  return (await readAll()).length;
}

export async function listUsers() {
  return (await readAll()).map(publicUser);
}

/**
 * Create an account.
 * Uniqueness is enforced inside the transaction, so two simultaneous
 * registrations for the same address cannot both succeed.
 */
export async function createUser({ email, passwordHash, role = 'member', emailVerified = false }) {
  const normalized = normalizeEmail(email);
  if (!normalized) throw Object.assign(new Error('Email is required.'), { code: 'AUTH_EMAIL_REQUIRED' });

  return transaction(async (users) => {
    if (users.some((user) => user.email === normalized)) {
      return { write: false, value: { created: false, user: users.find((u) => u.email === normalized) } };
    }
    const user = newUser({ email: normalized, passwordHash, role, emailVerified });
    users.push(user);
    return { value: { created: true, user } };
  });
}

/** Apply a mutation to one user inside the write lock. */
export async function updateUser(id, mutate) {
  return transaction(async (users) => {
    const index = users.findIndex((user) => user.id === String(id));
    if (index < 0) return { write: false, value: null };
    const updated = { ...users[index], ...mutate(users[index]), updatedAt: new Date().toISOString() };
    users[index] = updated;
    return { value: updated };
  });
}

/** Invalidate every session for this user by bumping the version. */
export async function revokeSessions(id) {
  return updateUser(id, (user) => ({ sessionVersion: Number(user.sessionVersion || 1) + 1 }));
}

/** Test seam only. */
export async function _reset() {
  await fs.rm(FILE(), { force: true }).catch(() => {});
  writeQueue = Promise.resolve();
}
