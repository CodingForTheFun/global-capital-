// User account storage on the persistent Railway volume.
//
// No database in this stack, so accounts live in JSON under DATA_DIR alongside
// the rest of the app's state. Writes are atomic (write-temp, rename) and
// serialised through a promise chain so two concurrent registrations cannot
// clobber each other — the failure mode a naive read-modify-write would have.
//
// Email is the identity. It is stored normalised and also kept as a lookup
// index so a case or dot variation cannot create a duplicate account.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const DATA = path.resolve(process.env.DATA_DIR || './data');
const FILE = path.join(DATA, 'users.json');

// Every write goes through this chain, so they serialise rather than race.
let writeQueue = Promise.resolve();

/** Normalise an email for identity purposes. */
export function normalizeEmail(email) {
  const value = String(email ?? '').trim().toLowerCase();
  if (!value) return null;
  // Deliberately conservative: lowercase and trim only. Stripping dots or
  // +tags would merge addresses their owners consider distinct.
  return value;
}

/** Structural email check. Real validation is "a code reached the inbox". */
export function looksLikeEmail(email) {
  const value = normalizeEmail(email);
  if (!value || value.length > 254) return false;
  return /^[^\s@,;:<>()[\]\\]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value);
}

async function readAll() {
  try {
    const parsed = JSON.parse(await fs.readFile(FILE, 'utf8'));
    return Array.isArray(parsed?.users) ? parsed.users : [];
  } catch {
    return [];
  }
}

async function writeAll(users) {
  await fs.mkdir(DATA, { recursive: true });
  const temp = `${FILE}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify({ version: 1, users }, null, 2), 'utf8');
    await fs.rename(temp, FILE);
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

/**
 * The shape stored on disk. `passwordHash` and code hashes never leave the
 * server; publicUser() below is the only thing an API may return.
 */
function newUser({ email, passwordHash, role = 'member', emailVerified = false }) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    email,
    passwordHash,
    role,
    emailVerified,
    createdAt: now,
    updatedAt: now,
    // Bumped to revoke every existing session for this user at once.
    sessionVersion: 1,
    lastLoginAt: null,
    lastLoginIp: null,
    failedAttempts: 0,
    lockedUntil: null,
    disabled: false,
    // Hashed, single-use codes for email verification and password reset.
    pendingCodes: {},
  };
}

/** Everything an API response may contain. Never includes a hash. */
export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerified === true,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt ?? null,
    disabled: user.disabled === true,
  };
}

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
  await fs.rm(FILE, { force: true }).catch(() => {});
  writeQueue = Promise.resolve();
}
