import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'autoprop-platform-'));
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_ANON_KEY;

const { TIERS, resolveTier, entitlements, can, requireFeature, consumeScan, scanUsage, UpgradeRequired } = await import('../billing/entitlements.mjs');
const { lineHistory, playerStats, injuries, liveScores, headshots } = await import('../db/repositories.mjs');
const { providerStatus, dataProviders } = await import('../providers/catalog.mjs');

test('an anonymous or free user gets the free tier', () => {
  assert.equal(resolveTier(null).key, 'free');
  assert.equal(resolveTier({ role: 'USER', subscription: { tier: 'free', status: 'inactive' } }).key, 'free');
});

test('an active subscription unlocks pro', () => {
  const user = { role: 'USER', subscription: { tier: 'pro', status: 'active', currentPeriodEnd: null } };
  assert.equal(resolveTier(user).key, 'pro');
  assert.equal(can(user, 'lineHistory'), true);
});

test('an expired period falls back to free even when the status says active', () => {
  const user = {
    role: 'USER',
    subscription: { tier: 'pro', status: 'active', currentPeriodEnd: new Date(Date.now() - 86_400_000).toISOString() },
  };
  assert.equal(resolveTier(user).key, 'free');
  assert.equal(can(user, 'lineHistory'), false);
});

test('a cancelled subscription does not grant pro', () => {
  const user = { role: 'USER', subscription: { tier: 'pro', status: 'canceled' } };
  assert.equal(resolveTier(user).key, 'free');
});

test('admins are never gated out of the product', () => {
  const admin = { role: 'ADMIN', isAdmin: true, subscription: { tier: 'free', status: 'inactive' } };
  assert.equal(resolveTier(admin).key, 'pro');
  assert.equal(entitlements(admin).isAdmin, true);
});

test('requireFeature throws an upgrade error for a gated feature', () => {
  const free = { role: 'USER', subscription: { tier: 'free', status: 'inactive' } };
  assert.throws(() => requireFeature(free, 'lineHistory'), (error) => {
    assert.ok(error instanceof UpgradeRequired);
    assert.equal(error.status, 402);
    assert.equal(error.code, 'UPGRADE_REQUIRED');
    return true;
  });
  assert.doesNotThrow(() => requireFeature(free, 'fullScan'));
});

test('daily scan budget counts down and then refuses', () => {
  const user = { id: `quota-${Math.random()}`, role: 'USER', subscription: { tier: 'free', status: 'inactive' } };
  const limit = TIERS.free.features.scansPerDay;
  for (let i = 0; i < limit; i += 1) {
    const result = consumeScan(user);
    assert.equal(result.allowed, true, `scan ${i + 1} should be allowed`);
  }
  const blocked = consumeScan(user);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.limit, limit);
  assert.equal(scanUsage(user).used, limit);
});

test('separate users have separate scan budgets', () => {
  const a = { id: `a-${Math.random()}`, role: 'USER', subscription: { tier: 'free', status: 'inactive' } };
  const b = { id: `b-${Math.random()}`, role: 'USER', subscription: { tier: 'free', status: 'inactive' } };
  consumeScan(a);
  assert.equal(scanUsage(b).used, 0);
});

test('repositories fail closed when no database is configured', async () => {
  const results = await Promise.all([
    lineHistory.forProp({ propId: 'p1' }),
    lineHistory.movement({ propId: 'p1' }),
    lineHistory.spread({ propId: 'p1' }),
    playerStats.samples({ playerId: 'x1' }),
    playerStats.hitRate({ playerId: 'x1', statKey: 'points', line: 20 }),
    injuries.forPlayer({ playerId: 'x1' }),
    liveScores.forEvent({ eventId: 'e1' }),
    headshots.forPlayers({ playerIds: ['x1'] }),
  ]);
  for (const result of results) {
    assert.equal(result.available, false, JSON.stringify(result));
    assert.ok(result.reason, 'an unavailable result must explain itself');
  }
});

test('writing line history without a database reports skipped, never silently succeeds', async () => {
  const result = await lineHistory.record({ propId: 'p1', bookmakerKey: 'pp', side: 'OVER', line: 24.5 });
  assert.equal(result.written, 0);
  assert.equal(result.skipped, true);
});

test('line history ignores malformed snapshots rather than storing junk', async () => {
  const result = await lineHistory.record([
    { propId: '', bookmakerKey: 'pp', side: 'OVER', line: 1 },
    { propId: 'p1', bookmakerKey: 'pp', side: 'OVER', line: Number.NaN },
  ]);
  assert.equal(result.written, 0);
});

test('providers report missing credentials instead of claiming connection', () => {
  const rows = providerStatus();
  assert.equal(rows.length, dataProviders.length);
  for (const row of rows) {
    assert.equal(row.configured, false);
    assert.equal(row.status, 'missing-credentials');
    assert.ok(row.missingEnv.length > 0);
  }
});

test('every declared provider names the tables it fills', () => {
  for (const provider of dataProviders) {
    assert.ok(Array.isArray(provider.tables) && provider.tables.length, `${provider.id} must declare tables`);
    assert.ok(Array.isArray(provider.envKeys) && provider.envKeys.length, `${provider.id} must declare env keys`);
  }
});

test.after(async () => {
  await fs.rm(process.env.DATA_DIR, { recursive: true, force: true });
});

const { ingestConfig, emptyBoard, ingestBoard, readLineHistory } = await import('../db/ingest.mjs');

test('ingest reports unconfigured instead of silently dropping writes', async () => {
  assert.equal(ingestConfig().configured, false);
  const result = await ingestBoard({ snapshots: [{ prop_id: 'p1', bookmaker_key: 'pp', side: 'OVER', line: 24.5 }] });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.ok(result.reason);
});

test('an empty board is a no-op, not an error', async () => {
  const board = emptyBoard();
  assert.deepEqual(Object.keys(board).sort(), ['bookmakers', 'events', 'lines', 'markets', 'players', 'props', 'snapshots']);
  for (const rows of Object.values(board)) assert.deepEqual(rows, []);
});

test('backend line-history read fails closed without a token', async () => {
  const result = await readLineHistory({ propId: 'p1' });
  assert.equal(result.available, false);
  assert.deepEqual(result.rows, []);
});
