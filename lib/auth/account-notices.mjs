// One-time customer notifications for owner/control-panel account actions.
//
// Notices contain only customer-safe copy. They live on the persistent DATA_DIR
// volume, separate from user credentials and the private staff audit trail.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const DATA = path.resolve(process.env.DATA_DIR || './data');
const FILE = path.join(DATA, 'account-notices.json');
const MAX_RECORDS = 5_000;
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

/** Test seam only. */
export async function _resetAccountNotices() {
  await fs.rm(FILE, { force: true }).catch(() => {});
  queue = Promise.resolve();
}
