// Test-only browser assertions. No public accounts, wagers or paid data requests.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

async function settles(read, expected) {
  for (let i = 0; i < 50; i++) {
    if (await read() === expected) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(await read(), expected);
}

export async function assertGameControls(page, check) {
  const markets = page.getByRole('region', { name: 'Game markets', exact: true });
  const quote = () => markets.getByRole('button', { name: 'Detroit QA DraftKings Moneyline Detroit QA', exact: true });
  const star = () => markets.getByRole('button', { name: 'Favorite Detroit QA at Chicago QA', exact: true });
  const favorites = () => markets.getByRole('button', { name: 'Favorites', exact: true });
  const format = value => markets.getByRole('group', { name: 'Odds display format', exact: true }).getByRole('button', { name: value, exact: true });
  await quote().waitFor();
  let requests = 0;
  const count = request => { if (request.url().includes('/api/apex/game-markets?')) requests++; };
  page.on('request', count);
  try {
    await format('decimal').click();
    await settles(() => quote().locator('b').textContent(), '1.91');
    check(await format('decimal').getAttribute('aria-pressed') === 'true', 'Decimal odds display and selected state');
    await format('american').click();
    await settles(() => quote().locator('b').textContent(), '-110');
    check(true, 'American odds restored without changing the underlying quote');
    await star().click();
    await settles(() => star().getAttribute('aria-pressed'), 'true');
    await favorites().click();
    check(await star().count() === 1, 'Favorite game remains in the filtered board');
    await star().click();
    await markets.getByRole('heading', { name: 'No game lines match', exact: true }).waitFor();
    check(await markets.getByRole('button', { name: 'Export quotes', exact: true }).isDisabled(), 'Empty favorites disable CSV export');
    await favorites().click();
    await star().waitFor();
    await star().click();
    await settles(() => star().getAttribute('aria-pressed'), 'true');
    await markets.getByLabel('Game sportsbook', { exact: true }).selectOption('fanduel');
    await markets.getByRole('button', { name: 'Detroit QA FanDuel Moneyline Detroit QA', exact: true }).waitFor();
    const downloadReady = page.waitForEvent('download');
    await markets.getByRole('button', { name: 'Export quotes', exact: true }).click();
    const download = await downloadReady;
    const file = await download.path();
    check(Boolean(file), 'CSV download exists');
    const csv = await readFile(file, 'utf8');
    const lines = csv.trim().split('\r\n');
    check(download.suggestedFilename() === 'obligepay-nfl-game-quotes.csv', 'CSV has the correct sport filename');
    check(lines.length === 7 && lines.slice(1).every(line => line.includes('"FanDuel"')) && !csv.includes('DraftKings'), 'CSV contains only the selected book and six actual fixture outcomes');
    check(csv.includes('"American odds"') && csv.includes('"-110"') && csv.includes('"-2.5"'), 'CSV preserves labeled American odds and signed spread values');
    await markets.getByLabel('Game sportsbook', { exact: true }).selectOption('all');
    await markets.getByLabel('Search games', { exact: true }).fill('No such QA team');
    await markets.getByRole('heading', { name: 'No game lines match', exact: true }).waitFor();
    check(await markets.getByRole('button', { name: 'Export quotes', exact: true }).isDisabled(), 'Empty search does not export hidden quotes');
    await markets.getByLabel('Search games', { exact: true }).fill('');
    await quote().waitFor();
    check(requests === 0, 'Favorites, formatting, CSV and search create no extra game-feed requests');
    await format('decimal').click();
    await page.reload({ waitUntil: 'networkidle' });
    await quote().waitFor();
    await settles(() => quote().locator('b').textContent(), '1.91');
    await settles(() => star().getAttribute('aria-pressed'), 'true');
    check(true, 'Odds preference and account-scoped session favorites survive reload');
    await format('american').click();
    await settles(() => quote().locator('b').textContent(), '-110');
    await page.screenshot({ path: 'artifacts/sportsbook-controls-desktop.png', fullPage: true });
    for (const width of [375, 390, 768]) {
      await page.setViewportSize({ width, height: 900 });
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `BoiBook controls fit ${width}px without page overflow`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'artifacts/sportsbook-controls-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1600, height: 1100 });
  } finally {
    page.off('request', count);
  }
}
