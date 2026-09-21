import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:3000';
const output = 'installable-app-artifacts';
await mkdir(output, { recursive: true });

for (let attempt = 0; ; attempt++) {
  try {
    const response = await fetch(base + '/app.webmanifest');
    if (response.ok) break;
  } catch {}
  if (attempt >= 60) throw new Error('Next.js did not become ready');
  await new Promise(resolve => setTimeout(resolve, 1000));
}

const manifestResponse = await fetch(base + '/app.webmanifest');
assert.match(manifestResponse.headers.get('content-type') || '', /application\/manifest\+json/);
const manifest = await manifestResponse.json();
assert.equal(manifest.name, 'Oblige Props');
assert.equal(manifest.start_url, '/board');
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.scope, '/');

for (const size of [180, 192, 512]) {
  const response = await fetch(base + `/app-icons/${size}.png`);
  assert.equal(response.status, 200, `PNG ${size} status`);
  assert.match(response.headers.get('content-type') || '', /image\/png/);
  const png = Buffer.from(await response.arrayBuffer());
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), size);
  assert.equal(png.readUInt32BE(20), size);
}

const workerResponse = await fetch(base + '/app-worker.js');
assert.equal(workerResponse.headers.get('service-worker-allowed'), '/');
assert.match(workerResponse.headers.get('cache-control') || '', /no-store/);
assert.match(workerResponse.headers.get('content-type') || '', /javascript/);
const worker = await workerResponse.text();
const listeners = new Map();
vm.runInNewContext(worker, {
  self: {
    location: { origin: base },
    addEventListener: (name, handler) => listeners.set(name, handler),
  },
  URL,
});
for (const [path, method, mode] of [
  ['/api/account/me', 'GET', 'cors'],
  ['/api/oblige-workspace?action=catalog', 'GET', 'cors'],
  ['/api/apex/props', 'GET', 'cors'],
  ['/api/account/login', 'POST', 'cors'],
  ['/account', 'GET', 'navigate'],
  ['/research', 'GET', 'navigate'],
  ['/checkout', 'GET', 'navigate'],
  ['/owner', 'GET', 'navigate'],
  ['/app-icons/192.png?private=1', 'GET', 'cors'],
  ['/app-icons/192.png', 'POST', 'cors'],
]) {
  let intercepted = false;
  listeners.get('fetch')({ request: { url: base + path, method, mode }, respondWith() { intercepted = true; } });
  assert.equal(intercepted, false, `Worker must not intercept ${method} ${path}`);
}

const sport = 'football_nfl';
const event = {
  id: 'installable-event',
  sport,
  startsAt: '2050-09-20T18:00:00Z',
  homeTeam: 'Dallas Cowboys',
  awayTeam: 'Philadelphia Eagles',
  status: 'scheduled',
  aliases: [],
};
const offers = ['draftkings', 'fanduel'].flatMap(book =>
  ['OVER', 'UNDER'].map(side => ({
    key: `${book}:94.5:${side}`,
    outcomeId: `installable:${book}:${side}`,
    book,
    bookName: book === 'draftkings' ? 'DraftKings' : 'FanDuel',
    line: 94.5,
    choice: side,
    side,
    price: book === 'draftkings' ? -110 : -115,
    multiplier: null,
    updatedAt: new Date().toISOString(),
    dfs: false,
    conflict: false,
    dfsOddsType: 'standard',
    lineGap: null,
  })),
);
const payload = {
  ok: true,
  event,
  fetchedAt: new Date().toISOString(),
  players: [{
    key: 'installable-player',
    playerId: 'test:installable',
    name: 'QA Research Player',
    aliases: ['QA Research Player'],
    sport,
    eventId: event.id,
    startsAt: event.startsAt,
    homeTeam: event.homeTeam,
    awayTeam: event.awayTeam,
    position: 'WR',
    markets: [{
      key: 'receiving',
      marketKey: 'player_reception_yds',
      label: 'Receiving yards',
      period: null,
      variant: 'standard',
      offers,
    }],
  }],
};
const games = Array.from({ length: 20 }, (_, i) => ({
  gameId: `installable-${i}`,
  date: `${i < 10 ? 2049 : 2048}-09-${String(28 - i).padStart(2, '0')}T00:00:00Z`,
  opponent: i % 2 ? 'Dallas Cowboys' : 'New York Giants',
  value: i % 2 ? 110 : 80,
  isHome: i % 4 < 2,
  season: i < 10 ? 2049 : 2048,
}));

const researchURL = '/research?' + new URLSearchParams({
  sportKey: sport,
  event: event.id,
  playerKey: 'installable-player',
  category: 'receiving',
});

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'allow', reducedMotion: 'reduce' });
    let historyRequests = 0;
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      let body;
      let status = 200;

      if (url.pathname === '/api/account/me') {
        body = { authenticated: true, user: { id: 'qa-installable', email: 'qa@example.invalid' } };
      } else if (url.pathname === '/api/oblige-workspace') {
        const action = url.searchParams.get('action');
        if (action === 'catalog') body = { ok: true, sports: [{ key: sport, title: 'NFL', active: true }] };
        else if (action === 'events') body = { ok: true, events: [event] };
        else if (action === 'event') body = payload;
        else if (action === 'history') {
          historyRequests++;
          body = { ok: true, available: true, source: 'Synthetic installable-app fixture', gameLog: games };
        } else if (action === 'model') {
          body = { ok: true, prediction: { available: false, code: 'UNAVAILABLE', message: 'No model in synthetic installable-app fixture.' } };
        }
      } else if (url.pathname === '/api/apex/player-artwork') {
        status = 404;
        body = {};
      }

      if (!body) {
        status = 404;
        body = { ok: false };
      }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await page.goto(base + researchURL, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Player stat category', { exact: true }).waitFor();
    await page.getByRole('combobox', { name: 'Opponent', exact: true }).waitFor();
    await page.locator('.op-sample-count').filter({ hasText: '20 of 20 verified games' }).waitFor();

    const initialHistoryRequests = historyRequests;
    assert.equal(await page.locator('.op-direct-filter').count(), 3, 'current research filters use direct dropdowns');
    assert.equal(await page.getByText('Apply', { exact: true }).count(), 0, 'no obsolete Apply panel');
    assert.equal(await page.getByText('Clear', { exact: true }).count(), 0, 'no obsolete Clear panel');

    const opponent = page.getByRole('combobox', { name: 'Opponent', exact: true });
    await opponent.selectOption('Dallas Cowboys');
    await page.waitForFunction(() => document.querySelector('.op-sample-count')?.textContent?.startsWith('10 of 20'));
    assert.equal(historyRequests, initialHistoryRequests, 'local filters do not refetch history');

    await opponent.selectOption('all');
    await page.waitForFunction(() => document.querySelector('.op-sample-count')?.textContent === '20 of 20 verified games');

    const installButton = page.getByRole('button', { name: 'Install Oblige Props', exact: true });
    await installButton.waitFor();
    await installButton.click();
    await page.locator('dialog[open]').waitFor();
    await page.getByRole('button', { name: 'Close installation instructions' }).click();

    assert.equal(await page.locator('link[rel="manifest"]').getAttribute('href'), '/app.webmanifest');
    await page.waitForFunction(async () => {
      const registration = await navigator.serviceWorker.getRegistration('/');
      return registration?.active?.scriptURL.endsWith('/app-worker.js');
    });

    const dimensions = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      card: document.querySelector('[data-design="premium-player-research-v1"]')?.getBoundingClientRect().width || null,
    }));
    assert.ok(dimensions.document <= dimensions.viewport + 1, 'research page has no horizontal document overflow');
    assert.deepEqual(errors, [], 'no client runtime errors');

    await page.screenshot({ path: `${output}/research-${viewport.width}.png`, fullPage: true });
    results.push({
      viewport: viewport.width,
      passed: true,
      syntheticFixtures: true,
      historyRequests,
      dimensions,
      checks: [
        'manifest-icons',
        'service-worker-isolation',
        'current-direct-filters',
        'no-obsolete-apply-clear',
        'install-dialog',
        'service-worker-registration',
        'no-horizontal-overflow',
      ],
    });
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(`${output}/report.json`, JSON.stringify(results, null, 2));
}
console.log(JSON.stringify({ ok: true, results }));
