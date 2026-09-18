import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

// Isolated UI regression fixtures. No real credentials, customer accounts or
// provider data are used; browser API requests never reach production.
const base = 'http://127.0.0.1:3100';
const server = spawn('npm', ['run', 'start', '--', '--port', '3100'], { stdio: 'inherit', detached: true, env: { ...process.env, OBLIGE_BACKEND_ORIGIN: 'http://127.0.0.1:31999' } });
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { const response = await fetch(base, { signal: AbortSignal.timeout(1000) }); if (response.ok) { ready = true; break; } } catch {}
    await delay(500);
  }
  assert.ok(ready, 'built frontend must start');
  browser = await chromium.launch({ headless: true });
  await mkdir('test-results/direct-prop', { recursive: true });
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    for (const noHistory of [false, true]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const rows = ['Total Games', 'Sets Won'].flatMap((market, index) => ['OVER', 'UNDER'].map((side) => ({
        id: `test-${index}-${side}`, propId: `test-${index}`, eventId: 'test-event', providerPlayerId: 'test-player', playerName: 'Regression Player', market, marketId: index ? 'sets_won' : 'total_games', line: index ? 1.5 : 22.5, side, sportsbook: 'PrizePicks', sportsbookKey: 'prizepicks', gameStartTime: '2026-09-19T12:30:00Z', price: null,
      })));
      let researchCalls = 0;
      await page.route('**/api/**', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/player-artwork')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="28" fill="gray"/></svg>' });
        if (url.pathname.endsWith('/stream')) return route.fulfill({ status: 204, body: '' });
        let body = {};
        if (url.pathname === '/api/account/me') body = { authenticated: true, user: { id: 'fixture-account' } };
        else if (url.pathname === '/api/apex/props') body = { ok: true, props: rows, supportedSports: ['NFL', 'TENNIS'], meta: {} };
        else if (url.pathname === '/api/props/ml') {
          const request = route.request().postDataJSON();
          body = { ok: true, results: Object.fromEntries((request.props || []).map((target) => [target.key, { available: false, code: 'MODEL_UNAVAILABLE' }])) };
        } else if (url.pathname === '/api/apex/research') {
          researchCalls++;
          body = noHistory ? { ok: true, available: false, code: 'NO_GAME_LOG_DATA', message: 'Auto Scout has no verified records for this exact market.', gameLog: [] } : {
            ok: true, available: true, market: url.searchParams.get('market'), line: Number(url.searchParams.get('line')), side: 'OVER', gameLog: [21, 24, 22, 27, 20].map((value, index) => ({ gameId: `test-game-${index}`, date: `2026-09-${String(17 - index).padStart(2, '0')}T12:00:00Z`, value: url.searchParams.get('market') === 'Sets Won' ? index % 3 : value, isHome: null, opponent: null })),
          };
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      });
      await page.goto(`${base}/board`);
      await page.getByRole('group', { name: 'League', exact: true }).getByRole('button', { name: 'TENNIS', exact: true }).click();
      await page.getByRole('button', { name: 'Research Regression Player Total Games 22.5', exact: true }).filter({ visible: true }).first().click();
      await page.waitForURL('**/research?**');
      assert.equal(new URL(page.url()).searchParams.get('sport'), 'TENNIS');
      assert.equal(new URL(page.url()).searchParams.get('eventId'), 'test-event');
      assert.equal(new URL(page.url()).searchParams.get('book'), 'prizepicks');
      await page.getByRole('heading', { name: 'Regression Player', exact: true }).waitFor();
      assert.equal(await page.getByText('Open full player research', { exact: true }).count(), 0);
      assert.equal(await page.getByText('Player inspector', { exact: true }).count(), 0);
      if (noHistory) {
        await page.getByText('Verified history unavailable', { exact: true }).waitFor();
        assert.equal(await page.getByText('Verified history unavailable', { exact: true }).count(), 1);
        assert.equal(await page.locator('.op-samples').count(), 0);
        assert.equal(await page.locator('.player-split-card').count(), 0);
        assert.doesNotMatch(await page.locator('body').innerText(), /Auto Scout/);
        await page.getByText('Pick’em', { exact: false }).first().waitFor();
      } else {
        await page.locator('.op-chart-column').first().waitFor();
        assert.equal(await page.locator('.op-chart-column').count(), 5);
        const before = researchCalls;
        await page.getByRole('button', { name: 'Raise research line', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.op-line-number')?.textContent === '23');
        await page.getByRole('group', { name: 'Research side', exact: true }).locator('[data-side="UNDER"]').click();
        await page.waitForFunction(() => new URL(location.href).searchParams.get('side') === 'UNDER');
        assert.equal(researchCalls, before, 'changing side and line must reuse the verified sample');
        await page.getByRole('tab', { name: 'Sets Won 1.5', exact: true }).click();
        await page.waitForFunction(() => new URL(location.href).searchParams.get('market') === 'Sets Won');
        assert.equal(new URL(page.url()).searchParams.get('side'), 'UNDER');
        assert.equal(new URL(page.url()).searchParams.get('eventId'), 'test-event');
      }
      assert.deepEqual(errors, [], 'browser must not emit runtime errors');
      await page.screenshot({ path: `test-results/direct-prop/${viewport.width}-${noHistory ? 'unavailable' : 'history'}.png`, fullPage: true });
      await context.close();
      console.log(`PASS direct prop ${viewport.width}px ${noHistory ? 'unavailable' : 'verified fixture'}`);
    }
  }
} finally {
  await browser?.close();
  try { process.kill(-server.pid, 'SIGTERM'); } catch {}
}
