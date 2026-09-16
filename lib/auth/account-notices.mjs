// One-time customer notifications for owner/control-panel account actions.
//
// Notices contain only customer-safe copy. They live on the persistent DATA_DIR
// volume, separate from user credentials and the private staff audit trail.
// A notice is acknowledged only by the affected account, except for a disabled
// account where a correct-password blocked sign-in consumes the ban notice so it
// can be shown once without granting an authenticated session.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { currentAccount } from './routes.mjs';
import { csrfValid } from './session.mjs';
import { findByEmail, normalizeEmail } from './store.mjs';
import { verifyPassword, fakeVerify } from './passwords.mjs';
import { createRateLimiter, clientKey } from '../session.mjs';

const DATA = path.resolve(process.env.DATA_DIR || './data');
const FILE = path.join(DATA, 'account-notices.json');
const MAX_RECORDS = 5_000;
const limiter = createRateLimiter();
let queue = Promise.resolve();

function clean(value, max = 240) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);
}

function publicNotice(record) {
  if (!record) return null;
  return {
    id: record.id,
    type: record.type,
    title: record.title,
    message: record.message,
    createdAt: record.createdAt,
  };
}

async function readAll() {
  try {
    const parsed = JSON.parse(await fs.readFile(FILE, 'utf8'));
    return Array.isArray(parsed?.notices) ? parsed.notices : [];
  } catch {
    return [];
  }
}

async function writeAll(notices) {
  await fs.mkdir(DATA, { recursive: true, mode: 0o700 });
  const temp = `${FILE}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify({ version: 1, notices }, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temp, FILE);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {});
  }
}

function transaction(mutate) {
  const run = queue.then(async () => {
    const notices = await readAll();
    const result = await mutate(notices);
    if (result?.write !== false) {
      if (notices.length > MAX_RECORDS) notices.splice(0, notices.length - MAX_RECORDS);
      await writeAll(notices);
    }
    return result?.value;
  });
  queue = run.then(() => {}, () => {});
  return run;
}

export function createAccountNotice({ userId, type = 'account-update', title = 'Account updated', message } = {}) {
  const safeUserId = clean(userId, 80);
  const safeMessage = clean(message, 600);
  if (!safeUserId || !safeMessage) return Promise.resolve(null);
  const record = {
    id: crypto.randomUUID(),
    userId: safeUserId,
    type: clean(type, 64) || 'account-update',
    title: clean(title, 120) || 'Account updated',
    message: safeMessage,
    createdAt: new Date().toISOString(),
    acknowledgedAt: null,
  };
  return transaction(async (notices) => {
    notices.push(record);
    return { value: publicNotice(record) };
  });
}

export async function pendingAccountNotices(userId, { limit = 20 } = {}) {
  await queue;
  const safeUserId = clean(userId, 80);
  const capped = Math.max(1, Math.min(50, Number(limit) || 20));
  return (await readAll())
    .filter((row) => row?.userId === safeUserId && !row.acknowledgedAt)
    .sort((a, b) => Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0))
    .slice(0, capped)
    .map(publicNotice);
}

export function acknowledgeAccountNotice(userId, noticeId) {
  const safeUserId = clean(userId, 80);
  const safeNoticeId = clean(noticeId, 80);
  return transaction(async (notices) => {
    const row = notices.find((item) => item?.id === safeNoticeId && item?.userId === safeUserId);
    if (!row) return { write: false, value: false };
    if (!row.acknowledgedAt) row.acknowledgedAt = new Date().toISOString();
    return { value: true };
  });
}

export function consumePendingAccountNotice(userId, { types = [] } = {}) {
  const safeUserId = clean(userId, 80);
  const allowed = new Set((Array.isArray(types) ? types : []).map((value) => clean(value, 64)).filter(Boolean));
  return transaction(async (notices) => {
    const row = notices.find((item) => item?.userId === safeUserId && !item.acknowledgedAt && (!allowed.size || allowed.has(item.type)));
    if (!row) return { write: false, value: null };
    row.acknowledgedAt = new Date().toISOString();
    return { value: publicNotice(row) };
  });
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function readBody(req, limit = 8_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request body is too large.'), { code: 'REQUEST_INVALID' });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON request.'), { code: 'REQUEST_INVALID' }); }
}

function allowBlockedCheck(req, email) {
  const key = normalizeEmail(email) || 'unknown';
  return limiter.allow(clientKey(req, 'blocked-notice'), 10, 15 * 60_000)
    && limiter.allow(`blocked-notice:acct:${key}`, 8, 15 * 60_000);
}

/**
 * Routes intentionally live outside /api/account/* so the existing account
 * router never consumes their POST bodies before this handler sees them.
 *
 * GET  /api/notices/account
 * POST /api/notices/account/ack        { noticeId }
 * POST /api/notices/blocked-account    { email, password }
 */
export async function handleAccountNoticeRoutes(req, res, url, { sessions, json, secret, log = console } = {}) {
  const pathname = url.pathname;
  const relevant = pathname === '/api/notices/account'
    || pathname === '/api/notices/account/ack'
    || pathname === '/api/notices/blocked-account';
  if (!relevant) return false;

  try {
    if (pathname === '/api/notices/account' && req.method === 'GET') {
      const { user } = await currentAccount(req, sessions);
      if (!user) {
        json(res, 401, { ok: false, code: 'AUTH_REQUIRED', message: 'Sign in to continue.' });
        return true;
      }
      json(res, 200, { ok: true, notices: await pendingAccountNotices(user.id) });
      return true;
    }

    if (pathname === '/api/notices/account/ack' && req.method === 'POST') {
      if (!sameOrigin(req)) {
        json(res, 403, { ok: false, code: 'ORIGIN_INVALID', message: 'Cross-origin request rejected.' });
        return true;
      }
      const { user, token } = await currentAccount(req, sessions);
      if (!user) {
        json(res, 401, { ok: false, code: 'AUTH_REQUIRED', message: 'Sign in to continue.' });
        return true;
      }
      if (!csrfValid(token, req.headers['x-csrf-token'], secret)) {
        json(res, 403, { ok: false, code: 'CSRF_INVALID', message: 'Your session expired. Reload and try again.' });
        return true;
      }
      const body = await readBody(req);
      const acknowledged = await acknowledgeAccountNotice(user.id, body.noticeId);
      json(res, acknowledged ? 200 : 404, acknowledged
        ? { ok: true }
        : { ok: false, code: 'NOTICE_NOT_FOUND', message: 'That notification is no longer pending.' });
      return true;
    }

    if (pathname === '/api/notices/blocked-account' && req.method === 'POST') {
      if (!sameOrigin(req)) {
        json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
        return true;
      }
      const body = await readBody(req);
      const email = normalizeEmail(body.email);
      if (!allowBlockedCheck(req, email)) {
        json(res, 429, { ok: false, code: 'RATE_LIMITED', message: 'Too many attempts. Please wait and try again.' });
        return true;
      }
      const user = email ? await findByEmail(email) : null;
      if (!user) {
        await fakeVerify();
        json(res, 200, { ok: true, blocked: false, notice: null });
        return true;
      }
      const verified = await verifyPassword(String(body.password || ''), user.passwordHash);
      if (!verified.ok || !user.disabled) {
        json(res, 200, { ok: true, blocked: false, notice: null });
        return true;
      }
      const notice = await consumePendingAccountNotice(user.id, { types: ['account-disabled'] });
      json(res, 200, { ok: true, blocked: true, notice });
      return true;
    }

    json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' });
    return true;
  } catch (error) {
    log?.error?.('[Oblige Props notices] request failed', String(error?.code || error?.message || 'NOTICE_ERROR').slice(0, 120));
    json(res, error?.code === 'REQUEST_INVALID' ? 400 : 500, {
      ok: false,
      message: error?.code === 'REQUEST_INVALID' ? 'That request could not be processed.' : 'That request could not be completed.',
    });
    return true;
  }
}

/** Test seam only. */
export async function _resetAccountNotices() {
  await fs.rm(FILE, { force: true }).catch(() => {});
  queue = Promise.resolve();
}
