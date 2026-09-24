import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oblige-preferences-'));
process.env.DATA_DIR = dataDir;
process.env.DASHBOARD_SESSION_SECRET = 'saved-filter-test-secret';

const store = await import('../lib/auth/store.mjs');
const service = await import('../lib/auth/service.mjs');
const { handleAccountRoutes } = await import('../lib/auth/routes.mjs');
const { createAccountSessions, csrfTokenFor, ACCOUNT_COOKIE } = await import('../lib/auth/session.mjs');

const SECRET = 'saved-filter-test-secret';
const sessions = createAccountSessions({ secret: SECRET });

function fakeRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    writeHead(status, headers = {}) { this.statusCode = status; this.headers = headers; },
    end(body) { this.body = body ?? null; },
  };
}

function request({ method = 'GET', token = '', csrf = '', body = null } = {}) {
  const req = Readable.from(body === null ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]);
  req.method = method;
  req.headers = {
    ...(token ? { cookie: `${ACCOUNT_COOKIE}=${encodeURIComponent(token)}` } : {}),
    ...(csrf ? { 'x-csrf-token': csrf } : {}),
    ...(body !== null ? { 'content-type': 'application/json' } : {}),
  };
  req.socket = { remoteAddress: '203.0.113.25' };
  return req;
}

const json = (res, status, body, extra = {}) => {
  res.writeHead(status, extra);
  res.end(JSON.stringify(body));
};

async function call(pathname, options) {
  const res = fakeRes();
  const handled = await handleAccountRoutes(
    request(options),
    res,
    new URL(`https://obligeprops.test${pathname}`),
    { sessions, json, secret: SECRET, log: { log() {}, warn() {}, error() {} } },
  );
  return { handled, status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

test('account board filters require a signed session and CSRF to change', async () => {
  await store._reset();
  const { user } = await store.createUser({
    email: 'filters@example.test',
    passwordHash: 'not-used-here',
    emailVerified: true,
  });
  const token = sessions.issue(user.id, user.sessionVersion);
  const csrf = csrfTokenFor(token, SECRET);

  const anonymous = await call('/api/account/preferences', { method: 'GET' });
  assert.equal(anonymous.status, 401);

  const initial = await call('/api/account/preferences', { method: 'GET', token });
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.body.preferences.boardFilters, { activeSport: 'NFL', bySport: {} });

  const noCsrf = await call('/api/account/preferences', {
    method: 'POST',
    token,
    body: { sport: 'NBA', filters: { market: 'Points' } },
  });
  assert.equal(noCsrf.status, 403);

  const saved = await call('/api/account/preferences', {
    method: 'POST',
    token,
    csrf,
    body: {
      sport: 'NBA',
      filters: {
        sort: 'hit',
        hitWindow: 'l10',
        market: 'Points',
        team: 'BOS',
        opponent: 'NYK',
        book: 'DraftKings',
        game: 'BOS @ NYK',
        date: '2026-09-25',
        modifier: 'ALL',
        ignored: 'never persist this',
      },
    },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.preferences.boardFilters.activeSport, 'NBA');
  assert.deepEqual(saved.body.preferences.boardFilters.bySport.NBA, {
    sort: 'hit',
    hitWindow: 'l10',
    market: 'Points',
    team: 'BOS',
    opponent: 'NYK',
    book: 'DraftKings',
    game: 'BOS @ NYK',
    date: '2026-09-25',
    modifier: 'ALL',
  });

  const readBack = await call('/api/account/preferences', { method: 'GET', token });
  assert.deepEqual(readBack.body.preferences, saved.body.preferences);
  assert.equal(JSON.stringify(readBack.body).includes('ignored'), false);
});

test('saved views are isolated by account and preserved per sport', async () => {
  await store._reset();
  const first = (await store.createUser({ email: 'one@example.test', passwordHash: 'x', emailVerified: true })).user;
  const second = (await store.createUser({ email: 'two@example.test', passwordHash: 'x', emailVerified: true })).user;
  const firstToken = sessions.issue(first.id, first.sessionVersion);
  const firstCsrf = csrfTokenFor(firstToken, SECRET);
  const secondToken = sessions.issue(second.id, second.sessionVersion);

  await call('/api/account/preferences', {
    method: 'POST',
    token: firstToken,
    csrf: firstCsrf,
    body: { sport: 'NFL', filters: { sort: 'name', team: 'KC' } },
  });
  await call('/api/account/preferences', {
    method: 'POST',
    token: firstToken,
    csrf: firstCsrf,
    body: { sport: 'TENNIS', filters: { sort: 'hit', opponent: 'Carlos Alcaraz' } },
  });

  const firstRead = await call('/api/account/preferences', { method: 'GET', token: firstToken });
  assert.equal(firstRead.body.preferences.boardFilters.activeSport, 'TENNIS');
  assert.equal(firstRead.body.preferences.boardFilters.bySport.NFL.team, 'KC');
  assert.equal(firstRead.body.preferences.boardFilters.bySport.TENNIS.opponent, 'Carlos Alcaraz');

  const secondRead = await call('/api/account/preferences', { method: 'GET', token: secondToken });
  assert.deepEqual(secondRead.body.preferences.boardFilters, { activeSport: 'NFL', bySport: {} });
});

test('preference sanitizer fails closed on unsupported sports and malformed values', async () => {
  await store._reset();
  const user = (await store.createUser({ email: 'safe@example.test', passwordHash: 'x', emailVerified: true })).user;

  const rejected = await service.saveBoardPreferences({
    userId: user.id,
    sport: 'ROCKET_LEAGUE',
    filters: { team: 'anything' },
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'PREFERENCES_INVALID');

  const saved = await service.saveBoardPreferences({
    userId: user.id,
    sport: 'NFL',
    filters: {
      sort: 'DROP TABLE',
      hitWindow: 'forever',
      team: 'A'.repeat(500),
      market: 'Passing Yards',
    },
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.preferences.boardFilters.bySport.NFL.sort, 'line');
  assert.equal(saved.preferences.boardFilters.bySport.NFL.hitWindow, 'l10');
  assert.equal(saved.preferences.boardFilters.bySport.NFL.team, 'ALL');
  assert.equal(saved.preferences.boardFilters.bySport.NFL.market, 'Passing Yards');
});

test.after(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});
