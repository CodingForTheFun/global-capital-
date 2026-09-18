import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:3000';
const output = 'installable-app-artifacts';
await mkdir(output, { recursive: true });
for (let attempt = 0; ; attempt++) {
  try { const response = await fetch(base + '/app.webmanifest'); if (response.ok) break; } catch {}
  if (attempt >= 60) throw new Error('Next.js did not become ready');
  await new Promise(resolve => setTimeout(resolve, 1000));
}
const manifestResponse = await fetch(base + '/app.webmanifest');
assert.match(manifestResponse.headers.get('content-type'), /application\/manifest\+json/);
const manifest = await manifestResponse.json();
assert.equal(manifest.name, 'Oblige Props');
assert.equal(manifest.start_url, '/board');
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.scope, '/');
for (const size of [180, 192, 512]) {
  const response = await fetch(base + `/app-icons/${size}.png`);
  assert.equal(response.status, 200, `PNG ${size} status`);
  assert.match(response.headers.get('content-type'), /image\/png/);
  const png = Buffer.from(await response.arrayBuffer());
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size);
}
const workerResponse = await fetch(base + '/app-worker.js');
assert.equal(workerResponse.headers.get('service-worker-allowed'), '/');
assert.match(workerResponse.headers.get('cache-control'), /no-store/);
assert.match(workerResponse.headers.get('content-type'), /javascript/);
const worker = await workerResponse.text();
const listeners = new Map();
vm.runInNewContext(worker, { self: { location: { origin: base }, addEventListener: (name, handler) => listeners.set(name, handler) }, URL });
for (const [path, method, mode] of [
  ['/api/account/me', 'GET', 'cors'], ['/api/apex/props', 'GET', 'cors'],
  ['/api/apex/research', 'GET', 'cors'], ['/api/apex/market-stream', 'GET', 'cors'],
  ['/api/account/login', 'POST', 'cors'], ['/account', 'GET', 'navigate'],
  ['/research', 'GET', 'navigate'], ['/checkout', 'GET', 'navigate'],
  ['/owner', 'GET', 'navigate'], ['/app-icons/192.png?private=1', 'GET', 'cors'],
  ['/app-icons/192.png', 'POST', 'cors'],
]) {
  let intercepted = false;
  listeners.get('fetch')({ request: { url: base + path, method, mode }, respondWith() { intercepted = true; } });
  assert.equal(intercepted, false, `Worker must not intercept ${method} ${path}`);
}
const browser = await chromium.launch({ headless: true });
const results = [];
const player = 'QA Research Player';
const market = 'Receiving Yards';
const quotes = ['DraftKings', 'FanDuel'].flatMap((sportsbook, i) => ['OVER', 'UNDER'].map(side => ({
  id: `${sportsbook}-${side}`, playerName: player, market, marketId: 'receiving_yards', line: 94.5,
  side, price: i ? -115 : -110, sportsbook, sportsbookKey: sportsbook.toLowerCase(),
  team: 'PHI', opponent: 'DAL', awayTeam: 'PHI', homeTeam: 'DAL', eventId: 'qa-event',
  gameStartTime: '2026-09-20T20:25:00Z',
})));
const games = Array.from({ length: 20 }, (_, i) => ({
  gameId: `qa-${i}`, date: new Date(Date.UTC(2026, 8, 15 - i)).toISOString(),
  opponent: i % 2 ? 'NYG' : 'DAL', isHome: i % 3 === 0, season: i < 10 ? 2026 : 2025,
  value: 50 + i * 6,
}));
const researchURL = '/research?' + new URLSearchParams({ sport: 'NFL', player, market, line: '94.5' });
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'allow' });
    let researchRequests = 0;
    await context.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/account/me') return route.fulfill({ json: { authenticated: true, user: { id: 'qa-only', email: 'qa@example.invalid' } } });
      if (path === '/api/apex/props') return route.fulfill({ json: { ok: true, props: [...quotes, ...quotes.map(q => ({ ...q, market: '1H Receiving Yards', marketId: '1h_receiving_yards' }))], meta: {}, supportedSports: ['NFL'] } });
      if (path === '/api/apex/research') {
        researchRequests++;
        return route.fulfill({ json: { ok: true, available: true, source: 'CI fixture, not production data', gameLog: [...games, { gameId: 'qa-missing', date: '2026-09-17', value: null, opponent: 'DAL', season: 2026 }] } });
      }
      if (path === '/api/apex/player-artwork') return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ json: { ok: true, history: [], items: [] } });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + researchURL, { waitUntil: 'domcontentloaded' });
    const panel = page.locator('.research-reference');
    await panel.locator('.op-sample-count').filter({ hasText: '20 of 20 verified games' }).waitFor();
    const initialResearchRequests = researchRequests;
    const field = label => panel.locator(`.op-applied-filter[data-filter="${label}"]`);
    const open = async label => { const item = field(label); if (!(await item.evaluate(el => el.open))) await item.locator('summary').click(); return item; };
    let season = await open('Season');
    await season.locator('select').selectOption('2025');
    assert.match(await season.locator('summary').innerText(), /All/);
    let opponent = await open('Opponent');
    await opponent.locator('select').selectOption('DAL');
    await opponent.getByRole('button', { name: 'Apply', exact: true }).click();
    assert.match(await panel.locator('.op-sample-count').innerText(), /^10 of 20/);
    assert.match(await season.locator('summary').innerText(), /All/);
    let book = await open('Book');
    await book.locator('select').selectOption('draftkings');
    await season.getByRole('button', { name: 'Apply', exact: true }).click();
    assert.match(await panel.locator('.op-sample-count').innerText(), /^5 of 20/);
    assert.match(await book.locator('summary').innerText(), /Best prices/);
    await book.getByRole('button', { name: 'Apply', exact: true }).click();
    assert.match(await book.locator('summary').innerText(), /DraftKings/);
    opponent = await open('Opponent');
    await opponent.getByRole('button', { name: 'Clear', exact: true }).click();
    assert.match(await panel.locator('.op-sample-count').innerText(), /^10 of 20/);
    assert.match(await season.locator('summary').innerText(), /2025/);
    await panel.getByRole('button', { name: 'Raise research line' }).click();
    assert.equal(await panel.locator('.op-line-number').innerText(), '95');
    assert.match(await panel.locator('.op-price-note').innerText(), /posted line 94\.5/);
    await panel.locator('.op-side-picker button[data-side="UNDER"]').click();
    assert.equal(await panel.locator('.op-side-picker button[data-side="UNDER"]').getAttribute('aria-pressed'), 'true');
    assert.equal(researchRequests, initialResearchRequests, 'Filters, book, line and side must not fetch research');
    opponent = await open('Opponent');
    await opponent.locator('select').selectOption('NYG');
    await opponent.locator('select').press('Escape');
    opponent = await open('Opponent');
    assert.equal(await opponent.locator('select').inputValue(), 'all', 'Closing discards draft');
    await opponent.locator('summary').click();
    await page.getByRole('button', { name: 'Install Oblige Props', exact: true }).click();
    await page.locator('dialog[open]').waitFor();
    await page.getByRole('button', { name: 'Close installation instructions' }).click();
    assert.equal(await page.locator('link[rel="manifest"]').getAttribute('href'), '/app.webmanifest');
    await page.waitForFunction(async () => {
      const registration = await navigator.serviceWorker.getRegistration('/');
      return registration?.active?.scriptURL.endsWith('/app-worker.js');
    });
    const dimensions = await page.evaluate(() => {
      const panel = document.querySelector('.research-reference').getBoundingClientRect();
      const chart = document.querySelector('.op-chart-section').getBoundingClientRect();
      return { viewport: innerWidth, document: document.documentElement.scrollWidth, panel: panel.width, chart: chart.width };
    });
    assert.ok(dimensions.document <= dimensions.viewport + 1, JSON.stringify(dimensions));
    assert.ok(dimensions.chart >= dimensions.panel * .95, 'Chart must use panel width');
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/research-${viewport.width}-CI-fixture.png`, fullPage: true });
    await page.goto(base + '/research?' + new URLSearchParams({ sport: 'NFL', player, market: '1H Receiving Yards', line: '94.5' }), { waitUntil: 'domcontentloaded' });
    await page.locator('.research-reference .op-no-history').filter({ hasText: 'Verified history unavailable' }).waitFor();
    assert.equal(await page.locator('.research-reference .op-chart-bar').count(), 0, 'No invented half-game history');
    assert.equal(researchRequests, initialResearchRequests, 'Unsupported period does not request whole-game data');
    assert.deepEqual(errors, [], 'No unhandled browser exceptions');
    results.push({ viewport, dimensions, independentFilters: 'PASS', noExtraResearchRequests: 'PASS', unavailablePeriod: 'PASS', workerRegistered: 'PASS' });
    await context.close();
  }
} finally { await browser.close(); }
const summary = { status: 'PASS', release: 'oblige-installable-20260918', pngIcons: 'PASS', workerDataIsolation: 'PASS', basis: 'Automated Chromium desktop/mobile emulation with labeled CI fixtures, not physical device or real-data visual acceptance', results };
await writeFile(`${output}/summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
