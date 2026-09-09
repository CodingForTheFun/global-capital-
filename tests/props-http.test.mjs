import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Boots server.mjs (what railway.json actually starts) and drives the real
// ALL PROPS / Auto Prop Finder / prop detail / provider routes over HTTP,
// with NO provider key configured — the deployment state before enrichment.

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PASSWORD = 'props-http-test-password';
const PORT = 12000 + Math.floor(Math.random() * 3000);
const BASE = `http://127.0.0.1:${PORT}`;

let child; let dataDir; let cookie;
const stderr = [];

const SCAN = {
  mode: 'live',
  scannedAt: new Date().toISOString(),
  source: 'PickFinder authenticated full-detail browser scan v2',
  totalReviewed: 3,
  qualifiedCount: 1,
  rejectedCount: 2,
  logs: ['internal selector detail that must never be served'],
  picks: [
    { player: 'Alpha Scorer', prop: 'Points', line: 25.5, sport: 'NBA', pick: 'OVER', opponent: 'PHX', matchId: 'NBA-1', sourceUrl: 'https://www.pickfinder.app/players/alpha', l5: 90, l10: 88, l15: 86, h2h: 80, expectedOutcome: 'WIN', expectedOutcomeRate: 84, avg: 29.1, diff: 3.6, regularLine: true, prizePicksConfirmed: true, isToday: true, detailPageVerified: true, qualified: true, failures: [], confidence: 88, filterAudit: [{ label: 'Opponent', value: 'PHX', hitRate: 82, floor: 75, required: true, verified: true }] },
    { player: 'Bravo Boards', prop: 'Rebounds', line: 8.5, sport: 'NBA', pick: 'UNDER', opponent: 'PHX', matchId: 'NBA-1', sourceUrl: 'https://www.pickfinder.app/players/bravo', l5: 60, l10: 58, l15: 55, regularLine: true, prizePicksConfirmed: true, isToday: true, detailPageVerified: true, qualified: false, failures: ['L5 60% < 80%'], confidence: 62, filterAudit: [] },
    { player: 'Charlie Rush', prop: 'Rushing Yards', line: 64.5, sport: 'NFL', pick: 'OVER', opponent: 'SEA', matchId: 'NFL-9', sourceUrl: 'https://www.pickfinder.app/players/charlie', l5: 75, l10: 72, l15: 70, regularLine: true, prizePicksConfirmed: true, isToday: true, detailPageVerified: true, qualified: false, failures: ['L5 short'], confidence: 71, filterAudit: [] },
  ],
};

async function api(pathname, { raw = false } = {}) {
  const response = await fetch(`${BASE}${pathname}`, { headers: cookie ? { cookie } : {} });
  const body = raw ? await response.text() : await response.json().catch(() => null);
  return { status: response.status, body };
}

test.before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoprop-props-'));
  await fs.writeFile(path.join(dataDir, 'latest.json'), JSON.stringify(SCAN));
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, DASHBOARD_PASSWORD: PASSWORD, AUTO_SCAN_MINUTES: '0', SPORTSDATAIO_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (c) => stderr.push(String(c)));
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/auth/status`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }),
  });
  if (!login.ok) throw new Error(`login failed:\n${stderr.join('')}`);
  cookie = (login.headers.getSetCookie?.()[0] || login.headers.get('set-cookie') || '').split(';')[0];
});

test.after(async () => {
  child?.kill('SIGKILL');
  if (dataDir) await fs.rm(dataDir, { recursive: true, force: true });
});

test('the prop routes require authentication', async () => {
  const saved = cookie; cookie = null;
  for (const route of ['/api/props', '/api/props/best', '/api/providers']) {
    assert.equal((await api(route)).status, 401, `${route} must be gated`);
  }
  cookie = saved;
});

test('ALL PROPS returns every scanned prop with counts', async () => {
  const { status, body } = await api('/api/props');
  assert.equal(status, 200);
  assert.equal(body.props.length, 3);
  assert.equal(body.counts.total, 3);
  assert.equal(body.counts.matching, 3);
  assert.equal(body.counts.qualifiers, 1);
  assert.ok(body.props.every((p) => typeof p.score === 'number'), 'every prop is scored');
});

test('filters combine over HTTP and Auto Prop Finder uses the same population', async () => {
  const query = 'sports=NBA&markets=POINTS&side=OVER&timeWindow=TODAY';
  const all = await api(`/api/props?${query}`);
  const best = await api(`/api/props/best?${query}`);

  assert.equal(all.body.props.length, 1);
  assert.equal(all.body.props[0].playerName, 'Alpha Scorer');
  assert.deepEqual(
    best.body.ranked.map((p) => p.id),
    all.body.props.map((p) => p.id),
    'Auto Prop Finder ranks exactly what All Props shows',
  );
  assert.equal(best.body.ranked[0].rank, 1);
});

test('Rules ON narrows the same filtered set without clearing filters', async () => {
  const off = await api('/api/props?sports=NBA');
  const on = await api('/api/props?sports=NBA&rules=1');

  assert.equal(off.body.props.length, 2, 'rules off shows non-qualifiers too');
  assert.equal(on.body.props.length, 1, 'rules on shows only qualifiers');
  assert.deepEqual(on.body.filters.sports, ['NBA'], 'the sport filter survived the toggle');
  assert.equal(on.body.filters.applyScoutRules, true);
  assert.ok(on.body.props.every((p) => p.sport === 'NBA'));
});

test('sorting and paging operate on the filtered results', async () => {
  const desc = await api('/api/props?sort=score-desc');
  const asc = await api('/api/props?sort=score-asc');
  assert.ok(desc.body.props[0].score >= desc.body.props.at(-1).score);
  assert.ok(asc.body.props[0].score <= asc.body.props.at(-1).score);

  const paged = await api('/api/props?limit=2&offset=0');
  assert.equal(paged.body.props.length, 2);
  assert.equal(paged.body.counts.filtered, 3);
});

test('the empty state explains itself instead of returning a bare list', async () => {
  const { body } = await api('/api/props?minHitRate=99&hitRateWindow=l10');
  assert.equal(body.props.length, 0);
  assert.ok(body.emptyReason);
  assert.equal(body.emptyReason.suggestions[0].id, 'minHitRate');
  assert.ok(body.emptyReason.activeChips.length > 0);
});

test('prop detail returns the score breakdown and Find Similar filters', async () => {
  const list = await api('/api/props?sports=NBA&markets=POINTS');
  const id = list.body.props[0].id;
  const { status, body } = await api(`/api/props/detail?id=${encodeURIComponent(id)}`);

  assert.equal(status, 200);
  assert.equal(body.prop.playerName, 'Alpha Scorer');
  assert.ok(Array.isArray(body.scoreBreakdown.factors));
  assert.ok(body.scoreBreakdown.factors.every((f) => f.detail), 'every factor explains itself');
  assert.deepEqual(body.similarFilters.sports, ['NBA']);
  assert.equal(body.similarFilters.side, 'OVER');

  assert.equal((await api('/api/props/detail?id=does-not-exist')).status, 404);
});

test('provider status reports honestly with no key configured', async () => {
  const { status, body } = await api('/api/providers');
  assert.equal(status, 200);
  const sdio = body.providers.find((p) => p.id === 'sportsdataio');
  assert.ok(sdio, 'SportsDataIO is registered');
  assert.equal(sdio.status, 'not-configured');
  assert.match(sdio.message, /Not connected/);
  assert.ok(Array.isArray(sdio.capabilities) && sdio.capabilities.includes('projection'));
});

test('with no provider, enrichment fields stay null and are never faked', async () => {
  const { body } = await api('/api/props');
  for (const prop of body.props) {
    assert.equal(prop.projection, null, 'no projection is invented');
    assert.equal(prop.injuryStatus, null);
    assert.equal(prop.expectedMinutes, null);
    assert.equal(prop.depthChartOrder, null);
  }
  // And the filters those fields back are not offered.
  assert.ok(!body.availableFilters.includes('minProjectionEdge'));
  assert.ok(!body.availableFilters.includes('excludeInjured'));
});

test('no prop response leaks scanner internals, keys or provider detail', async () => {
  const bodies = [];
  for (const route of ['/api/props', '/api/props/best', '/api/providers']) {
    bodies.push((await api(route, { raw: true })).body);
  }
  const combined = bodies.join('\n');
  for (const marker of [
    'internal selector detail', 'Ocp-Apim-Subscription-Key', 'SPORTSDATAIO', 'azure-api',
    'locator.', 'Call log', 'node_modules', '.mjs:', '/app/',
  ]) {
    assert.ok(!combined.includes(marker), `leaked: ${marker}`);
  }
});

test('a malformed filter query is handled rather than erroring', async () => {
  for (const query of ['minScore=abc', 'sports=', 'side=SIDEWAYS', 'limit=-5', 'sort=nonsense', 'offset=99999']) {
    const { status } = await api(`/api/props?${query}`);
    assert.equal(status, 200, `${query} should degrade gracefully`);
  }
});

test('an empty board explains WHY, so it never just sits on Loading', async () => {
  const filtered = await api('/api/props?minHitRate=99&hitRateWindow=l10');
  assert.equal(filtered.body.props.length, 0);
  assert.equal(filtered.body.boardState.status, 'filtered-out');
  assert.match(filtered.body.boardState.message, /excluded by the current filters/);

  const ok = await api('/api/props');
  assert.equal(ok.body.boardState.status, 'ok');
  assert.equal(ok.body.boardState.scanPicks, 3, 'it reports what each source contributed');
  assert.ok(ok.body.boardState.scannedAt);

  const best = await api('/api/props/best');
  assert.ok(best.body.boardState, 'Auto Prop Finder carries the same signal');
});
