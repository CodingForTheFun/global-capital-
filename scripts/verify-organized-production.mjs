// Verify the deployed research board without creating disposable production accounts.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.AUTOSCOUT_PUBLIC_URL || 'https://www.obligeprops.com';
const expectedSha = String(process.env.AUTOSCOUT_EXPECTED_SHA || '').trim();
const smokeEmail = String(process.env.AUTOSCOUT_SMOKE_EMAIL || '').trim();
const smokePassword = String(process.env.AUTOSCOUT_SMOKE_PASSWORD || '');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await mkdir('artifacts/organized-board', { recursive: true });

async function waitForDeployment() {
  let last = 'no response';
  for (let n = 0; n < 48; n += 1) {
    try {
      const [asset, health] = await Promise.all([
        fetch(base + '/assets/lib/ui/prop-board.mjs', { cache: 'no-store', signal: AbortSignal.timeout(12_000) }),
        fetch(base + '/api/health', { cache: 'no-store', signal: AbortSignal.timeout(12_000) }),
      ]);
      const [assetText, healthBody] = await Promise.all([
        asset.ok ? asset.text() : Promise.resolve(''),
        health.ok ? health.json() : Promise.resolve(null),
      ]);
      const revisionReady = !expectedSha || healthBody?.revision === expectedSha;
      if (
        asset.ok
        && assetText.includes('uniquePlayerCards')
        && assetText.includes('cleanMarketLabel')
        && health.ok
        && healthBody?.ok === true
        && revisionReady
      ) {
        return healthBody;
      }
      last = `asset=${asset.status} health=${health.status} revision=${healthBody?.revision || 'none'}`;
    } catch (error) {
      last = error?.message || String(error);
    }
    await sleep(10_000);
  }
  throw new Error(`Organized board deployment did not become ready: ${last}`);
}

async function sessionCookie() {
  const healthResponse = await fetch(base + '/api/account/health', {
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const health = await healthResponse.json().catch(() => null);
  assert.ok(healthResponse.ok && health?.ok === true, 'Account health must be available.');
  assert.equal(health?.gate?.active, true, 'Production account gate must remain active.');

  if (!smokeEmail || !smokePassword) return null;
  assert.equal(health?.password?.available, true, 'Password sign-in must be available for the configured smoke identity.');

  const login = await fetch(base + '/api/account/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: smokeEmail, password: smokePassword, rememberMe: false }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await login.json().catch(() => null);
  assert.ok(login.ok && body?.ok === true, `Pre-provisioned smoke sign-in failed: HTTP ${login.status}`);
  const cookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).find((value) => value.startsWith('sp_account='));
  assert.ok(cookie, 'Pre-provisioned smoke sign-in returned no account session cookie.');
  return cookie;
}

async function verifySignedOutGate(report) {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const response = await page.goto(base + '/apex', { waitUntil: 'domcontentloaded', timeout: 60_000 });
      assert.ok(response?.ok(), `Signed-out /apex must load on ${label}.`);
      await page.waitForFunction(() => {
        const email = document.querySelector('#account-email, input[type="email"]');
        const password = document.querySelector('#account-password, input[type="password"], #account-code');
        return Boolean(email && password);
      }, null, { timeout: 30_000 });
      assert.equal(await page.locator('.asCard').count(), 0, 'Signed-out users must never see prop cards.');
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `artifacts/organized-board/${label}-account-gate.png`, fullPage: true });
      report.viewports.push({ label, accountGate: true, propCardsExposed: false, pageErrors: errors });
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

async function verifyAuthenticatedBoard(cookie, report) {
  const [cookieName, ...cookieParts] = cookie.split('=');
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
      const ctx = await browser.newContext({ viewport });
      await ctx.addCookies([{ name: cookieName, value: cookieParts.join('='), url: base, httpOnly: true, sameSite: 'Lax' }]);
      const page = await ctx.newPage();
      const errors = [];
      const photos = new Map();
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('response', async (response) => {
        if (!response.url().includes('/api/apex/player-artwork?')) return;
        const headers = await response.allHeaders();
        photos.set(response.url(), {
          status: response.status(),
          verified: headers['x-artwork-status'] === 'verified',
          type: headers['content-type'],
        });
      });

      await page.goto(base + '/apex', { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForSelector('#asPropTypes .asTypeChip', { timeout: 60_000 });
      await page.waitForSelector('.asCard .asResearchState.ready', { timeout: 90_000 });
      const cards = await page.locator('.asCard').evaluateAll((nodes) => nodes.map((node) => ({
        name: node.querySelector('.asPlayer')?.textContent,
        market: node.querySelector('.asCardMarket')?.textContent,
        metrics: [...node.querySelectorAll('.asBadge')].map((badge) => ({
          name: badge.querySelector('small')?.textContent,
          value: badge.querySelector('b')?.textContent,
        })),
        history: node.querySelector('.asResearchState')?.textContent,
      })));

      assert.ok(cards.length > 0 && cards.length <= 20);
      assert.equal(new Set(cards.map((card) => card.name)).size, cards.length, 'No repeated player cards in selected prop type');
      assert.ok(cards.some((card) => card.metrics.some((metric) => metric.name === 'L5' && /^\d+(\.\d+)?%$/.test(metric.value || ''))), 'Real rendered L5 values must be visible');
      assert.ok(cards.every((card) => !/\b(?:unknown|unkn|unk)\b/i.test(card.market || '')), 'Placeholder unknown labels must not appear in market text');

      await page.waitForFunction(() => [...document.querySelectorAll('.asAvatar img')].some((image) => image.complete && image.naturalWidth > 128), null, { timeout: 60_000 });
      assert.ok([...photos.values()].some((photo) => photo.verified && photo.status === 200 && photo.type?.startsWith('image/')), 'Verified upstream photo response must reach the browser');

      const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      assert.ok(noOverflow);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `artifacts/organized-board/${label}.png`, fullPage: true });

      await page.locator('[data-prop-type="all"]').click();
      await page.waitForSelector('.asCard [data-card-choice]', { timeout: 30_000 });
      const allNames = await page.locator('.asCard .asPlayer').allTextContents();
      assert.equal(new Set(allNames).size, allNames.length, 'All-players view must also avoid duplicate cards');

      const selector = page.locator('.asCard [data-card-choice]').first();
      const optionText = (await selector.locator('option').allTextContents()).map((value) => value.trim()).filter(Boolean);
      assert.ok(optionText.length > 1, 'Grouped player card must expose multiple stat choices.');
      assert.ok(optionText.every((value) => !/[·@]/.test(value)), 'Stat choices must not repeat matchup or game-time text.');
      assert.ok(optionText.every((value) => !/\b(?:over|under|alternate|full game)\b/i.test(value)), 'Stat choices must contain only the stat category.');

      report.viewports.push({
        label,
        category: cards[0]?.market,
        visiblePlayers: cards.length,
        noRepeatedPlayers: true,
        groupedAllPlayers: true,
        statOnlySelector: true,
        noOverflow,
        pageErrors: errors,
        verifiedPhotoResponses: [...photos.values()].filter((photo) => photo.verified).length,
        sampleCards: cards.slice(0, 3),
      });
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}

const health = await waitForDeployment();
const cookie = await sessionCookie();
const report = {
  scope: 'Deployed organized board, actual upstream data, no interception or fixtures',
  revision: health?.revision || null,
  authenticatedBoard: cookie ? 'verified' : 'skipped-no-preprovisioned-credentials',
  viewports: [],
};

if (cookie) await verifyAuthenticatedBoard(cookie, report);
else await verifySignedOutGate(report);

await writeFile('artifacts/organized-board/report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
