// Active session tracking — the data behind the owner's "who is online" panel.
//
// The account token is stateless and signed, which is great for verification
// but tells you nothing about who is currently using the site. This adds a
// server-side record per sign-in so the owner can see live sessions, and so an
// individual device can be signed out without evicting the user everywhere.
//
// Records live on the DATA_DIR volume beside the accounts. They are pruned on
// read, so an abandoned session disappears on its own rather than accumulating.
//
// Privacy note: these records include IP and user agent. They are visible ONLY
// to an owner, never to the account holder's peers, and never to a member.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const DATA = path.resolve(process.env.DATA_DIR || './data');
const FILE = path.join(DATA, 'sessions.json');

// A session with no activity for this long is treated as ended.
export const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
// Presence windows, mirroring how a chat app reports status.
export const ONLINE_MS = 2 * 60 * 1000;
export const IDLE_MS = 15 * 60 * 1000;
// Do not rewrite the file on every request; a heartbeat this often is enough.
const HEARTBEAT_THROTTLE_MS = 30 * 1000;

let writeQueue = Promise.resolve();
const lastWrite = new Map(); // sessionId -> ms, to throttle heartbeat writes

async function readAll() {
  try {
    const parsed = JSON.parse(await fs.readFile(FILE, 'utf8'));
    return Array.isArray(parsed?.sessions) ? parsed.sessions : [];
  } catch {
    return [];
  }
}

async function writeAll(sessions) {
  await fs.mkdir(DATA, { recursive: true });
  const temp = `${FILE}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify({ version: 1, sessions }, null, 2), 'utf8');
    await fs.rename(temp, FILE);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {});
  }
}

function transaction(mutate) {
  const run = writeQueue.then(async () => {
    const sessions = await readAll();
    const result = await mutate(sessions);
    if (result?.write !== false) await writeAll(sessions);
    return result?.value;
  });
  writeQueue = run.then(() => {}, () => {});
  return run;
}

const alive = (session, now) => now - Date.parse(session.lastSeenAt || 0) < SESSION_IDLE_MS && !session.revokedAt;

/** ONLINE / IDLE / OFFLINE, from how recently the session was seen. */
export function presenceOf(lastSeenAt, now = Date.now()) {
  const seen = Date.parse(lastSeenAt || '');
  if (!Number.isFinite(seen)) return 'OFFLINE';
  const age = now - seen;
  if (age <= ONLINE_MS) return 'ONLINE';
  if (age <= IDLE_MS) return 'IDLE';
  return 'OFFLINE';
}

/** Coarse device label. Deliberately not a fingerprint. */
export function describeDevice(userAgent = '') {
  const ua = String(userAgent);
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : null;
  const platform = /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Linux/.test(ua) ? 'Linux'
    : null;
  if (!browser && !platform) return 'Unknown device';
  return [browser, platform].filter(Boolean).join(' on ');
}

/** Only the last octet is dropped; enough to spot a new location, not to track. */
export function maskIp(ip) {
  const value = String(ip || '').trim();
  if (!value) return null;
  if (value.includes(':')) {
    const parts = value.split(':').filter(Boolean);
    return parts.length > 2 ? `${parts.slice(0, 2).join(':')}:…` : value;
  }
  const octets = value.split('.');
  return octets.length === 4 ? `${octets.slice(0, 3).join('.')}.x` : value;
}

/** Record a new sign-in. Returns the session id to embed in the token. */
export async function startSession({ userId, ip = null, userAgent = null }) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await transaction(async (sessions) => {
    // Prune dead rows while we are already holding the write lock.
    const live = sessions.filter((session) => alive(session, Date.now()));
    sessions.length = 0;
    sessions.push(...live, {
      id,
      userId: String(userId),
      createdAt: now,
      lastSeenAt: now,
      ip: ip ? String(ip).slice(0, 64) : null,
      userAgent: userAgent ? String(userAgent).slice(0, 300) : null,
      revokedAt: null,
    });
    return { value: id };
  });
  return id;
}

/**
 * Mark a session as still active. Throttled, so a busy dashboard does not
 * rewrite the file on every poll.
 */
export async function touchSession(sessionId, { ip = null } = {}) {
  if (!sessionId) return;
  const now = Date.now();
  const previous = lastWrite.get(sessionId) || 0;
  if (now - previous < HEARTBEAT_THROTTLE_MS) return;
  lastWrite.set(sessionId, now);

  await transaction(async (sessions) => {
    const session = sessions.find((row) => row.id === sessionId);
    if (!session || session.revokedAt) return { write: false };
    session.lastSeenAt = new Date(now).toISOString();
    if (ip) session.ip = String(ip).slice(0, 64);
    return { value: true };
  });
}

/** True while this specific session is still valid. */
export async function isSessionActive(sessionId) {
  if (!sessionId) return false;
  const session = (await readAll()).find((row) => row.id === sessionId);
  return Boolean(session && !session.revokedAt && alive(session, Date.now()));
}

/** End one device's session without touching the user's others. */
export async function revokeSession(sessionId) {
  return transaction(async (sessions) => {
    const session = sessions.find((row) => row.id === sessionId);
    if (!session || session.revokedAt) return { write: false, value: false };
    session.revokedAt = new Date().toISOString();
    return { value: true };
  });
}

/** End every session belonging to one user. */
export async function revokeAllForUser(userId) {
  return transaction(async (sessions) => {
    let count = 0;
    const stamp = new Date().toISOString();
    for (const session of sessions) {
      if (session.userId === String(userId) && !session.revokedAt) { session.revokedAt = stamp; count++; }
    }
    return { value: count };
  });
}

/** Live sessions for one user, newest first. */
export async function sessionsForUser(userId, { now = Date.now() } = {}) {
  return (await readAll())
    .filter((session) => session.userId === String(userId) && !session.revokedAt && alive(session, now))
    .map((session) => publicSession(session, now))
    .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
}

/** Every live session across all users. Owner-only. */
export async function allSessions({ now = Date.now() } = {}) {
  return (await readAll())
    .filter((session) => !session.revokedAt && alive(session, now))
    .map((session) => publicSession(session, now))
    .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
}

/** The shape an API may return. IP is masked; the raw value never leaves. */
export function publicSession(session, now = Date.now()) {
  return {
    id: session.id,
    userId: session.userId,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    presence: presenceOf(session.lastSeenAt, now),
    device: describeDevice(session.userAgent),
    ip: maskIp(session.ip),
  };
}

/** Test seam. */
export async function _reset() {
  await fs.rm(FILE, { force: true }).catch(() => {});
  lastWrite.clear();
  writeQueue = Promise.resolve();
}
