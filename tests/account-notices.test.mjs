import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let dataDir;
let store;
let passwords;
let notices;
let service;

const PASSWORD = 'correct-horse-battery-9';

test.before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oblige-account-notices-'));
  process.env.DATA_DIR = dataDir;
  process.env.DASHBOARD_SESSION_SECRET = 'account-notice-test-secret';
  ({ default: undefined, ...store } = await import('../lib/auth/store.mjs'));
  passwords = await import('../lib/auth/passwords.mjs');
  notices = await import('../lib/auth/account-notices.mjs');
  service = await import('../lib/auth/service.mjs');
});

test.after(async () => {
  await notices?._resetAccountNotices?.();
  await store?._reset?.();
  if (dataDir) await fs.rm(dataDir, { recursive: true, force: true });
});

test('account notices persist until the affected user acknowledges them', async () => {
  const notice = await notices.createAccountNotice({
    userId: 'user-a',
    type: 'pro-access-granted',
    title: 'Pro access granted',
    message: 'You received 30 days of complimentary Pro access.',
  });
  assert.ok(notice.id);

  const pending = await notices.pendingAccountNotices('user-a');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].message, 'You received 30 days of complimentary Pro access.');
  assert.equal(await notices.acknowledgeAccountNotice('someone-else', notice.id), false, 'another account cannot dismiss the notice');
  assert.equal(await notices.acknowledgeAccountNotice('user-a', notice.id), true);
  assert.deepEqual(await notices.pendingAccountNotices('user-a'), []);
});

test('a banned account sees its owner notice once after proving the password but never receives a session', async () => {
  const email = `banned-${Date.now()}@example.com`;
  const passwordHash = await passwords.hashPassword(PASSWORD);
  const created = await store.createUser({ email, passwordHash, role: 'member', emailVerified: true });
  await store.updateUser(created.user.id, () => ({ disabled: true }));
  await notices.createAccountNotice({
    userId: created.user.id,
    type: 'account-disabled',
    title: 'Account banned',
    message: 'Your Oblige Props account was banned by the owner.',
  });

  const wrong = await service.login({ email, password: 'definitely-wrong' });
  assert.equal(wrong.code, 'AUTH_INVALID_CREDENTIALS');
  assert.equal('user' in wrong, false);

  const first = await service.login({ email, password: PASSWORD });
  assert.equal(first.ok, false);
  assert.equal(first.code, 'AUTH_ACCOUNT_DISABLED_NOTICE');
  assert.equal(first.message, 'Your Oblige Props account was banned by the owner.');
  assert.equal('user' in first, false);
  assert.equal('sessionVersion' in first, false);

  const second = await service.login({ email, password: PASSWORD });
  assert.equal(second.ok, false);
  assert.equal(second.code, 'AUTH_ACCOUNT_DISABLED');
  assert.equal(second.message, 'This account is currently disabled.');
  assert.equal('user' in second, false);
});
