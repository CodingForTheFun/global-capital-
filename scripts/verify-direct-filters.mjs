// Synthetic, isolated interaction fixtures only. No production account, paid
// provider request, or fabricated customer history is used by this regression.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.WORKSPACE_TEST_ORIGIN || 'http://127.0.0.1:3100';
const output = 'artifacts/canonical-workspace';
await mkdir(output, { recursive: true });
const event = { id: 'filter-test-event', sport: 'football_nfl', startsAt: '2050-09-20T18:00:00Z', homeTeam: 'Test Home', awayTeam: 'Test Away', status: 'scheduled', aliases: [] };
const offers = ['draftkings', 'fanduel'].flatMap(book => ['OVER', 'UNDER'].map(side => ({ key: `${book}:50.5:${side}`, outcomeId: `test:${book}:${side}`, book, bookName: book === 'draftkings' ? 'DraftKings' : 'FanDuel', line: 50.5, choice: side, side, price: 100, multiplier: null, updatedAt: new Date().toISOString(), dfs: false, conflict: false })));
const payload = { ok: true, event, fetchedAt: new Date().toISOString(), players: [{ key: 'filter-test-player', playerId: 'test:filters', name: 'Filter Test Player', aliases: [], sport: event.sport, eventId: event.id, startsAt: event.startsAt, homeTeam: event.homeTeam, awayTeam: event.awayTeam, markets: [{ key: 'rush', marketKey: 'player_rush_yds', label: 'Rushing yards', period: null, variant: 'standard', offers }] }] };
const gameLog = Array.from({ length: 20 }, (_, i) => ({ gameId: `filter-test-${i}`, date: `${i < 10 ? 2049 : 2048}-09-${String(28 - i).padStart(2, '0')}T00:00:00Z`, opponent: i % 2 ? 'Test Opponent' : 'Other Opponent', value: i % 2 ? 60 : 40, isHome: i % 4 < 2, season: i < 10 ? 2049 : 2048 }));
const results = [];
const browser = await chromium.launch();
try {
  for (const [name, viewport] of [['mobile390', { width: 390, height: 844 }], ['desktop1440', { width: 1440, height: 1000 }]]) {
    const context = await browser.newContext({ viewport, hasTouch: name.startsWith('mobile'), reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      let body;
      if (url.pathname === '/api/account/me') body = { authenticated: true, user: { id: 'synthetic-filter-test' } };
      if (url.pathname === '/api/oblige-workspace') {
        const action = url.searchParams.get('action');
        requests.push(action);
        if (action === 'event') body = payload;
        if (action === 'history') body = { ok: true, available: true, source: 'Synthetic filter regression fixture', gameLog };
        if (action === 'model') body = { ok: true, prediction: { available: false, code: 'UNAVAILABLE', message: 'No model in synthetic filter test.' } };
        if (action === 'catalog') body = { ok: true, sports: [{ key: event.sport, title: 'NFL', active: true }] };
        if (action === 'events') body = { ok: true, events: [event] };
      }
      await route.fulfill({ status: body ? 200 : 404, contentType: 'application/json', body: JSON.stringify(body || {}) });
    });
    await page.goto(base + '/research?' + new URLSearchParams({ sportKey: event.sport, event: event.id, playerKey: 'filter-test-player', category: 'rush' }));
    const count = async expected => page.waitForFunction(text => document.querySelector('.op-sample-count')?.textContent === text, `${expected} of 20 verified games`);
    await count(20);
    const captionBefore = await page.locator('.op-sample-caption').boundingBox();
    const historyRequests = requests.filter(action => action === 'history').length;
    assert.equal(await page.locator('.op-filter-editor, .op-applied-filter form, .op-applied-filter summary').count(), 0, 'no intermediate panel or Apply form');
    assert.equal(await page.locator('.op-direct-filter').count(), 3, 'every history filter uses the shared direct dropdown');
    const opponent = page.getByRole('combobox', { name: 'Opponent', exact: true });
    const season = page.getByRole('combobox', { name: 'Season', exact: true });
    const venue = page.getByRole('combobox', { name: 'Home / Away', exact: true });
    const box = await opponent.boundingBox();
    const chip = await opponent.locator('..').boundingBox();
    assert.ok(Math.abs(box.width - chip.width) <= 2 && Math.abs(box.height - chip.height) <= 2, 'the whole chip opens its native dropdown');
    await opponent.click();
    await page.keyboard.press('Escape');
    assert.equal(await opponent.inputValue(), 'all', 'dismissing the native dropdown does not change the filter');
    await opponent.selectOption('Test Opponent'); await count(10);
    await season.selectOption('2049'); await count(5);
    await venue.selectOption('home'); await count(3);
    assert.equal(await opponent.inputValue(), 'Test Opponent');
    assert.equal(await season.inputValue(), '2049');
    await opponent.selectOption('all'); await count(6);
    assert.equal(await season.inputValue(), '2049', 'opponent reset leaves season unchanged');
    assert.equal(await venue.inputValue(), 'home', 'opponent reset leaves venue unchanged');
    await season.selectOption('all'); await count(10);
    await venue.selectOption('all'); await count(20);
    const captionAfter = await page.locator('.op-sample-caption').boundingBox();
    assert.ok(Math.abs(captionBefore.y - captionAfter.y) < 1, 'dropdowns never push the chart down');
    assert.equal(requests.filter(action => action === 'history').length, historyRequests, 'local filters do not refetch history');
    await season.focus();
    assert.ok(await season.evaluate(node => parseFloat(getComputedStyle(node.parentElement).outlineWidth) >= 2), 'keyboard focus is visible on the chip');
    assert.ok(await page.locator('.op-direct-filter').evaluateAll(nodes => nodes.every(node => { const r = node.getBoundingClientRect(); return r.height >= 44 && r.height <= 70 && r.right <= innerWidth + 1; })), 'compact accessible touch targets stay within viewport');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal page overflow');
    assert.deepEqual(errors, [], 'no client runtime errors');
    await page.screenshot({ path: `${output}/${name}-direct-filters.png`, fullPage: true });
    results.push({ viewport: name, passed: true, syntheticFixtures: true, checks: ['whole-chip-native-dropdown', 'no-apply-panel', 'immediate-selection', 'isolated-reset', 'escape-dismiss', 'no-layout-expansion', 'visible-keyboard-focus', 'no-extra-history-fetch', 'no-page-overflow'] });
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(`${output}/direct-filters-report.json`, JSON.stringify(results, null, 2));
}
console.log(JSON.stringify({ ok: true, results }));
