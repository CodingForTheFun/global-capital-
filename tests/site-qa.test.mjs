import test from 'node:test';
import assert from 'node:assert/strict';
import { checkHealth, checkNews, checkPage, checkProps, dedupe, summarize, STALE_PROP_MINUTES } from '../scripts/site-qa/checks.mjs';
import { outOfScope } from '../scripts/site-employee/check-scope.mjs';

const NOW = Date.parse('2026-09-23T12:00:00Z');
const fresh = new Date(NOW - 5 * 60_000).toISOString();
const quote = (overrides = {}) => ({
  eventId: 'e1', playerName: 'A Player', market: 'Receiving Yards', period: 'game', line: 54.5,
  side: 'OVER', price: -110, sportsbook: 'DraftKings', sportsbookKey: 'draftkings', providerUpdatedAt: fresh, ...overrides,
});
const ids = (findings) => findings.map((item) => item.id);

test('health: down, unconfigured and a stuck deploy are each reported', () => {
  assert.deepEqual(ids(checkHealth(null)), ['health:down']);
  assert.deepEqual(ids(checkHealth({ ok: true, provider: { configured: false } })), ['health:provider']);
  const stuck = checkHealth({ ok: true, provider: { configured: true }, revision: 'aaaa' }, { expectedRevision: 'bbbb' });
  assert.deepEqual(ids(stuck), ['health:revision']);
  assert.deepEqual(checkHealth({ ok: true, provider: { configured: true }, revision: 'bbbb' }, { expectedRevision: 'bbbb' }), []);
});

test('news: an empty feed and off-site photos are reported', () => {
  assert.deepEqual(ids(checkNews({ articles: [] })), ['news:empty']);
  assert.deepEqual(ids(checkNews({ articles: [{ imageUrl: 'https://a.espncdn.com/x.jpg' }] })), ['news:external-images']);
  assert.deepEqual(checkNews({ articles: [{ imageUrl: '/api/news/image?u=x' }, { imageUrl: null }] }), []);
});

test('props: a 0 price on a sportsbook is caught, but a pick\'em line is not', () => {
  assert.deepEqual(ids(checkProps('NFL', [quote({ price: 0 })], { now: NOW })), ['props:NFL:zero-price']);
  assert.deepEqual(checkProps('NFL', [quote({ price: 0, sportsbook: 'PrizePicks', sportsbookKey: 'prizepicks' })], { now: NOW }), []);
});

test('props: stale feeds, bad lines, wild odds and duplicate cards are each caught', () => {
  const stale = new Date(NOW - (STALE_PROP_MINUTES + 5) * 60_000).toISOString();
  assert.deepEqual(ids(checkProps('MLB', [quote({ providerUpdatedAt: stale })], { now: NOW })), ['props:MLB:stale']);
  assert.deepEqual(ids(checkProps('NFL', [quote({ line: 'n/a' })], { now: NOW })), ['props:NFL:line']);
  assert.deepEqual(ids(checkProps('NFL', [quote({ price: 25000 })], { now: NOW })), ['props:NFL:wild-price']);
  assert.deepEqual(ids(checkProps('NFL', [quote(), quote()], { now: NOW })), ['props:NFL:duplicates']);
  assert.deepEqual(ids(checkProps('NBA', [], { now: NOW })), ['props:NBA:empty']);
  assert.deepEqual(checkProps('NFL', [quote(), quote({ side: 'UNDER' })], { now: NOW }), []);
});

test('pages: every layout and content problem is reported, and a clean page is not', () => {
  const clean = { path: '/news', width: 390, status: 200, errors: [], cspViolations: [], overflowX: 0, headerVisible: true, navRows: 1, fontsLoaded: true, brokenImages: 0 };
  assert.deepEqual(checkPage(clean), []);
  const broken = { ...clean, status: 500, errors: ['boom'], overflowX: 40, headerVisible: false, navRows: 2, fontsLoaded: false, brokenImages: 3, cspViolations: ['blocked'] };
  assert.deepEqual(
    ids(checkPage(broken)).map((id) => id.split(':').pop()),
    ['status', 'errors', 'overflow', 'header', 'dock', 'fonts', 'images', 'csp'],
  );
  // The phone dock rule doesn't apply on desktop, where the dock is hidden.
  assert.deepEqual(checkPage({ ...clean, width: 1280, navRows: 0 }), []);
});

test('dedupe: one alert per break per window, and a recurrence alerts again', () => {
  const finding = { id: 'news:empty', severity: 'high', area: 'news', message: 'x' };
  const first = dedupe([finding], {}, { now: NOW });
  assert.equal(first.fresh.length, 1);
  const again = dedupe([finding], first.state, { now: NOW + 3_600_000 });
  assert.equal(again.fresh.length, 0, 'an hour later it stays quiet');
  const later = dedupe([finding], again.state, { now: NOW + 7 * 3_600_000 });
  assert.equal(later.fresh.length, 1, 'after the window it reminds');
  const recovered = dedupe([], later.state, { now: NOW + 8 * 3_600_000 });
  assert.deepEqual(recovered.state, {}, 'a fixed problem leaves the state');
});

test('summary lists problems by severity and says what was skipped', () => {
  const text = summarize(
    [{ id: 'a', severity: 'medium', message: 'layout' }, { id: 'b', severity: 'critical', message: 'down' }],
    { skipped: ['signed-in checks'] },
  );
  assert.ok(text.indexOf('down') < text.indexOf('layout'));
  assert.match(text, /signed-in checks/);
  assert.match(summarize([]), /All checks passed/);
});

test('the site employee may only touch website presentation code', () => {
  assert.deepEqual(outOfScope([
    'apps/oblige-web/components/news-screen.tsx',
    'apps/oblige-web/app/globals.css',
    'apps/oblige-web/tests/design-system.test.mjs',
    'docs/site-employee/ideas.md',
  ]), []);
  for (const path of [
    'apps/oblige-web/app/api/news/route.ts',
    'apps/oblige-web/lib/api.ts',
    'apps/oblige-web/components/sign-in.tsx',
    'apps/oblige-web/next.config.ts',
    'apps/oblige-web/package.json',
    'lib/web/public-surface.mjs',
    'lib/autoscout/providers/propline.mjs',
    'lib/ingestion/customer-prop-freshness.mjs',
    '.github/workflows/release-candidate-check.yml',
    'frontdoor-prod.mjs',
  ]) {
    assert.deepEqual(outOfScope([path]), [path], path);
  }
});
