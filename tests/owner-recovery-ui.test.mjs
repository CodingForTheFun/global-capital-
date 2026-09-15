import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function reqFor(pathname, body = null) {
  const req = body == null ? Readable.from([]) : Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = 'POST';
  req.url = pathname;
  req.headers = {
    host: 'owner.test',
    'x-forwarded-for': '203.0.113.21',
    'user-agent': 'Safari on iOS test',
  };
  req.socket = { remoteAddress: '203.0.113.21' };
  return req;
}

test('owner recovery proves the configured inbox, never exposes it, and issues the normal owner session', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oblige-owner-recovery-'));
  const previous = {
    DATA_DIR: process.env.DATA_DIR,
    NODE_ENV: process.env.NODE_ENV,
    ACCOUNT_OWNER_EMAIL: process.env.ACCOUNT_OWNER_EMAIL,
    DASHBOARD_SESSION_SECRET: process.env.DASHBOARD_SESSION_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    MAIL_FROM: process.env.MAIL_FROM,
  };
  const previousFetch = globalThis.fetch;

  process.env.DATA_DIR = dir;
  process.env.NODE_ENV = 'test';
  process.env.ACCOUNT_OWNER_EMAIL = 'private-owner@example.com';
  process.env.DASHBOARD_SESSION_SECRET = 'owner-recovery-test-secret-that-is-long-enough';
  process.env.RESEND_API_KEY = 're_test_key_not_real';
  process.env.MAIL_FROM = 'Oblige Props <owner@example.test>';

  let outbound = null;
  globalThis.fetch = async (_url, options = {}) => {
    outbound = JSON.parse(String(options.body || '{}'));
    return { ok: true, status: 200 };
  };

  try {
    const nonce = Date.now();
    const { handleOwnerRecoveryRoutes } = await import(`../lib/auth/owner-recovery-routes.mjs?owner-test=${nonce}`);
    const { createAccountSessions } = await import('../lib/auth/session.mjs');
    const { findByEmail } = await import('../lib/auth/store.mjs');
    const { isOwner } = await import('../lib/auth/permissions.mjs');
    const sessions = createAccountSessions({ secret: process.env.DASHBOARD_SESSION_SECRET });

    let captured = null;
    const json = (_res, status, body, headers = {}) => { captured = { status, body, headers }; };
    const deps = { sessions, json, secret:process.env.DASHBOARD_SESSION_SECRET, log:{ log(){}, warn(){}, error(){} } };

    const startReq = reqFor('/api/owner-recovery/start');
    assert.equal(await handleOwnerRecoveryRoutes(startReq, {}, new URL('http://owner.test/api/owner-recovery/start'), deps), true);
    assert.equal(captured.status, 200);
    assert.equal(captured.body.ok, true);
    assert.doesNotMatch(JSON.stringify(captured.body), /private-owner@example\.com/i, 'browser response must not reveal the owner address');
    assert.equal(outbound?.to?.[0], 'private-owner@example.com');
    const code = String(outbound?.subject || '').match(/^(\d{6})\b/)?.[1];
    assert.match(String(code), /^\d{6}$/);

    const pending = await findByEmail('private-owner@example.com');
    assert.ok(pending, 'recovery safely bootstraps the configured owner account when needed');
    assert.equal(pending.emailVerified, false, 'requesting recovery alone must not verify the account');
    assert.equal(isOwner(pending), true, 'production owner identity is the configured inbox');

    const verifyReq = reqFor('/api/owner-recovery/verify', { code });
    captured = null;
    assert.equal(await handleOwnerRecoveryRoutes(verifyReq, {}, new URL('http://owner.test/api/owner-recovery/verify'), deps), true);
    assert.equal(captured.status, 200);
    assert.equal(captured.body.authenticated, true);
    assert.equal(captured.body.redirect, '/owner');
    assert.equal(captured.body.capabilities.viewOwnerConsole, true);
    assert.match(String(captured.headers['set-cookie']), /^sp_account=/);

    const verified = await findByEmail('private-owner@example.com');
    assert.equal(verified.emailVerified, true);
    assert.equal(Boolean(verified.pendingCodes?.owner_recovery), false, 'successful code is consumed');

    const rawCookie = String(captured.headers['set-cookie']).split(';')[0].split('=').slice(1).join('=');
    assert.equal(sessions.read(decodeURIComponent(rawCookie)).valid, true, 'recovery uses the regular signed account session');

    const replayReq = reqFor('/api/owner-recovery/verify', { code });
    captured = null;
    await handleOwnerRecoveryRoutes(replayReq, {}, new URL('http://owner.test/api/owner-recovery/verify'), deps);
    assert.equal(captured.status, 400, 'a recovery code cannot be replayed');
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    }
    await fs.rm(dir, { recursive:true, force:true });
  }
});

test('owner control UI stays mobile-first and the recovery surface stays unindexed', async () => {
  const [ownerHtml, ownerCss, recoveryHtml, gateway] = await Promise.all([
    fs.readFile(path.join(root, 'public/owner-v2.html'), 'utf8'),
    fs.readFile(path.join(root, 'public/owner-v2-core.css'), 'utf8'),
    fs.readFile(path.join(root, 'public/owner-access.html'), 'utf8'),
    fs.readFile(path.join(root, 'lib/edge/gateway.mjs'), 'utf8'),
  ]);
  assert.match(ownerHtml, /Owner overview/);
  assert.match(ownerHtml, /Customer control/);
  assert.match(ownerCss, /backdrop-filter:blur/);
  assert.match(recoveryHtml, /noindex,nofollow,noarchive/);
  assert.match(recoveryHtml, /The email address is never shown here/);
  assert.doesNotMatch(recoveryHtml, /ACCOUNT_OWNER_EMAIL|@example\.com/);
  assert.match(gateway, /ownerRecoveryAssets/);
  assert.match(gateway, /owner-v2\.html/);
});
