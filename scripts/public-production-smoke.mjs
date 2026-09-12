// QA-only follow-up: do not merge this temporary verifier into production.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

const BASE = process.env.AUTOSCOUT_PUBLIC_URL || 'https://autoprop-live-production.up.railway.app';
const PUBLIC = 'https://www.obligepay.com';
const ROLLOUT_AFTER = Date.parse('2026-09-12T00:47:38Z');
const BOOKS = ['prizepicks', 'underdog'];
const report = { expectedCommit: '3a470ad8bb35f2d92173a5d495c9fc1a459b5f20', checkedAt: new Date().toISOString(), sports: [], browser: [] };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function json(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(45000), ...options });
  const body = await response.json();
  assert.ok(response.ok, `HTTP ${response.status} from ${new URL(url).pathname}`);
  return { response, body };
}
async function ready() {
  for (let attempt = 0; attempt < 12; attempt++) {
    const { body } = await json(`${BASE}/api/health`);
    if (body.ok && body.service === 'autoscout-apex' && Date.parse(body.startedAt) >= ROLLOUT_AFTER) return body;
    await delay(2000);
  }
  throw new Error('The expected new deployment was not serving health.');
}
async function session() {
  const { body: status } = await json(`${BASE}/api/account/health`);
  if (!status.gate?.active) return null;
  assert.equal(status.password?.available, true, 'Use the existing legitimate sign-up path only.');
  const { response, body } = await json(`${BASE}/api/account/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `smoke-dfs-${randomUUID()}@smoke.autoscout.test`, password: `Smoke-${randomUUID()}!` }),
  });
  assert.equal(body.ok, true);
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).find(value => value.startsWith('sp_account='));
  assert.ok(cookie, 'A normal account session is required; never bypass the gate.');
  return cookie;
}

let browser;
try {
  const health = await ready();
  const { body: publicHealth } = await json(`${PUBLIC}/api/health`);
  assert.equal(publicHealth.startedAt, health.startedAt, 'Both domains must serve the same deployment.');
  report.startedAt = health.startedAt;
  report.domainsMatch = true;
  const cookie = await session();
  const options = cookie ? { headers: { cookie } } : {};
  report.authenticatedSmokeSession = Boolean(cookie);
  const boards = [];
  for (const sport of ['NFL', 'WNBA', 'MLB', 'NBA', 'NCAAF']) {
    const { body } = await json(`${BASE}/api/apex/props?sport=${sport}`, options);
    assert.equal(body.meta?.coverage?.version, 2, `${sport}: old board or unverified stale fallback`);
    const rows = body.props || [];
    for (const row of rows) {
      assert.equal(row.isAlternate, false, 'Regular-line board cannot return alternates.');
      assert.ok(row.playerName && ['OVER', 'UNDER'].includes(row.side));
      assert.ok(row.line !== null && row.line !== '' && Number.isFinite(Number(row.line)));
    }
    const platforms = Object.fromEntries(BOOKS.map(book => {
      const actual = rows.filter(row => row.sportsbookKey === book);
      const meta = body.meta.coverage.platforms[book];
      assert.equal(meta.requested, true, `${sport}: ${book} must be requested`);
      assert.equal(meta.lineCount, actual.length, `${sport}: metadata must match actual ${book} rows`);
      const sample = actual[0];
      return [book, { ...meta, sample: sample ? { player: sample.playerName, market: sample.market, side: sample.side, line: sample.line, updatedAt: sample.providerUpdatedAt } : null }];
    }));
    const entry = { sport, events: body.meta.events, lines: rows.length, stale: Boolean(body.meta.stale), fetchedAt: body.meta.fetchedAt,
      complete: body.meta.coverage.complete, reasons: body.meta.coverage.reasons, availableEvents: body.meta.coverage.availableEvents,
      checkedEvents: body.meta.coverage.checkedEvents, platforms };
    report.sports.push(entry);
    boards.push({ sport, rows });
  }
  console.log('DFS_LIVE_API ' + JSON.stringify({ startedAt: report.startedAt, domainsMatch: report.domainsMatch, sports: report.sports }));

  browser = await chromium.launch({ headless: true });
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    if (cookie) {
      const [name, ...value] = cookie.split('=');
      await context.addCookies([{ name, value: value.join('='), url: PUBLIC, httpOnly: true, sameSite: 'Lax' }]);
    }
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { assert.equal(/apiKey=|THE_ODDS_API_KEY|CLEARSPORTS_API_KEY|SPORTSDATAIO_API_KEY/i.test(request.url()), false, 'No provider keys in browser URLs.'); });
    const response = await page.goto(`${PUBLIC}/apex`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    assert.ok(response?.ok());
    await page.waitForSelector('#as5', { timeout: 60000 });
    await page.waitForSelector('.asRow', { timeout: 60000 });
    const check = { viewport, platforms: [], pageErrors: errors };
    for (const book of BOOKS) {
      const board = boards.find(board => board.rows.some(row => row.sportsbookKey === book));
      if (!board) { check.platforms.push({ book, status: 'no_live_lines_returned' }); continue; }
      const tab = page.locator(`.asSport[data-sport="${board.sport}"]`);
      if (await tab.getAttribute('aria-pressed') !== 'true') {
        await tab.click();
        await page.waitForResponse(response => response.url().includes('/api/apex/props') && new URL(response.url()).searchParams.get('sport') === board.sport && response.ok(), { timeout: 45000 }).catch(() => {});
      }
      await page.waitForFunction(book => Array.from(document.querySelector('#asBook')?.options || []).some(option => option.value === book), book, { timeout: 45000 });
      await page.selectOption('#asBook', book);
      await page.waitForSelector('.asRow', { timeout: 15000 });
      assert.equal(await page.locator('#asBook').inputValue(), book);
      const card = page.locator('.asRow').first();
      const cardText = await card.innerText();
      assert.match(cardText, book === 'prizepicks' ? /PrizePicks/i : /Underdog/i);
      await card.click();
      await page.waitForSelector('#asDrawerBg.on', { timeout: 15000 });
      await page.waitForFunction(() => document.querySelector('#asDrawerBody .asSection') || document.querySelector('#asDrawerBody .asError'), null, { timeout: 45000 });
      const hasLineControl = await page.locator('#asLinePlus').count() > 0;
      let lineAdjusted = false;
      if (hasLineControl && await page.locator('#asLineInput').count()) {
        const before = Number(await page.locator('#asLineInput').inputValue());
        await page.locator('#asLinePlus').click();
        await page.waitForFunction(before => Number(document.querySelector('#asLineInput')?.value) > before, before, { timeout: 15000 });
        lineAdjusted = true;
      }
      const overflow = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
      assert.ok(overflow.document <= overflow.viewport + 1, 'No horizontal document overflow with drawer open.');
      await page.locator('#asClose').click();
      check.platforms.push({ book, sport: board.sport, visibleCards: await page.locator('.asRow').count(), drawer: true, lineAdjusted });
    }
    const overflow = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
    check.overflow = overflow;
    assert.ok(overflow.document <= overflow.viewport + 1, 'No horizontal document overflow.');
    assert.equal(errors.length, 0, 'No uncaught browser exceptions.');
    report.browser.push(check);
    await context.close();
  }
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = String(error.message || error).slice(0, 1000);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  console.log('DFS_DEPLOYMENT_QA ' + JSON.stringify(report));
}
