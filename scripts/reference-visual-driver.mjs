import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = (process.env.REFERENCE_VISUAL_BASE || 'http://localhost:3000').replace(/\/+$/, '');
const OUT = path.resolve(process.env.REFERENCE_VISUAL_OUT || 'reference-visual-artifacts');
const SPORTS = (process.env.REFERENCE_VISUAL_SPORTS || 'MLB,NFL,NBA,NHL,WNBA,NCAAF')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await fs.mkdir(OUT, { recursive: true });

async function waitForFrontend() {
  let last = 'no response';
  for (let attempt = 0; attempt < 45; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/`, { redirect: 'manual' });
      if (response.status >= 200 && response.status < 500) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error?.message || String(error);
    }
    await sleep(1000);
  }
  throw new Error(`Local Oblige frontend did not become ready: ${last}`);
}

function sessionTokenFrom(response) {
  const values = response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === 'set-cookie')
    .map((header) => header.value);
  for (const value of values) {
    const match = /(?:^|;\s*)sp_account=([^;]+)/.exec(value);
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}

async function createLegitimateSession(context) {
  const email = `visual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@smoke.autoscout.test`;
  const password = `Visual-${Math.random().toString(36).slice(2)}-${Date.now()}!Aa9`;
  const response = await context.request.post(`${BASE}/api/account/register`, {
    data: { email, password, rememberMe: false },
    headers: { accept: 'application/json' },
  });
  const body = await response.json().catch(() => null);
  const token = sessionTokenFrom(response);
  if (!response.ok() || body?.ok !== true || !token) {
    throw new Error(
      `Normal registration did not produce the QA session used by the production smoke path: HTTP ${response.status()} ${body?.code || body?.message || 'no session cookie'}`,
    );
  }

  // The upstream production customer domain marks its cookie Secure. We are
  // rendering the branch through localhost, so copy only the already-signed
  // normal session token into localhost's cookie jar; no auth rule is bypassed.
  await context.addCookies([
    {
      name: 'sp_account',
      value: token,
      url: BASE,
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);

  const me = await context.request.get(`${BASE}/api/account/me`);
  const meBody = await me.json().catch(() => null);
  if (!me.ok() || meBody?.authenticated !== true) {
    throw new Error(`Visual QA session did not authenticate through the normal account route: HTTP ${me.status()}`);
  }
  return { email };
}

async function findLiveSport(context) {
  for (const sport of SPORTS) {
    const response = await context.request.get(`${BASE}/api/apex/props?sport=${encodeURIComponent(sport)}`);
    if (!response.ok()) continue;
    const body = await response.json().catch(() => null);
    const props = Array.isArray(body?.props) ? body.props : [];
    const complete = props.filter(
      (row) => row?.playerName && row?.market && Number.isFinite(Number(row.line)) && (row?.sportsbook || row?.sportsbookKey),
    );
    if (complete.length >= 2) return { sport, count: complete.length };
  }
  throw new Error(`No real provider-backed props were available in ${SPORTS.join(', ')}.`);
}

async function selectSport(page, sport) {
  const current = page.getByRole('button', { name: sport, exact: true }).first();
  await current.waitFor({ state: 'visible', timeout: 30_000 });
  if ((await current.getAttribute('aria-pressed')) !== 'true') await current.click();
  await page.waitForSelector('.prop-card-v2', { timeout: 45_000 });
  await page.waitForFunction(() => document.querySelectorAll('.prop-card-v2').length >= 2, null, { timeout: 45_000 });
}

async function settle(page, ms = 1800) {
  await page.evaluate(() => document.fonts?.ready).catch(() => null);
  await sleep(ms);
}

async function boardMetrics(page) {
  return page.evaluate(() => {
    const box = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        top: Math.round(rect.top * 10) / 10,
        bottom: Math.round(rect.bottom * 10) / 10,
        left: Math.round(rect.left * 10) / 10,
        right: Math.round(rect.right * 10) / 10,
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
      };
    };
    const cards = [...document.querySelectorAll('.prop-card-v2')];
    const visibleCards = cards.filter((card) => {
      const rect = card.getBoundingClientRect();
      return rect.top < innerHeight && rect.bottom > 0;
    }).length;
    const firstFullyVisible = cards.filter((card) => {
      const rect = card.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight;
    }).length;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      header: box('header[data-board="true"]'),
      summary: box('.board-summary'),
      toolbar: box('.board-toolbar'),
      grid: box('.board-grid'),
      firstCard: box('.prop-card-v2'),
      cardCount: cards.length,
      cardsIntersectingViewport: visibleCards,
      cardsFullyVisible: firstFullyVisible,
      bodyScrollWidth: document.documentElement.scrollWidth,
      bodyClientWidth: document.documentElement.clientWidth,
    };
  });
}

async function researchMetrics(page) {
  return page.evaluate(() => {
    const box = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        top: Math.round(rect.top * 10) / 10,
        bottom: Math.round(rect.bottom * 10) / 10,
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
      };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      header: box('header'),
      hero: box('.player-cinematic-hero'),
      sectionNav: box('.player-section-nav'),
      explorer: box('.player-explorer-panel'),
      firstChart: box('[title*=" · "]'),
      bodyScrollWidth: document.documentElement.scrollWidth,
      bodyClientWidth: document.documentElement.clientWidth,
    };
  });
}

async function renderViewport(page, viewport, label, sport, researchUrlRef) {
  await page.setViewportSize(viewport);
  await page.goto(`${BASE}/board`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await selectSport(page, sport);
  await settle(page, 2600);

  const boardFile = path.join(OUT, `board-${label}.png`);
  await page.screenshot({ path: boardFile, fullPage: false });
  const board = await boardMetrics(page);

  // Prefer a card whose real L10 observations have landed. If verified
  // research is unavailable for every visible prop, open the first card and
  // preserve the product's honest unavailable state.
  const researched = page.locator('.prop-card-v2').filter({ has: page.locator('[aria-label^="Last "]') });
  let card = page.locator('.prop-card-v2').first();
  try {
    await researched.first().waitFor({ state: 'visible', timeout: 12_000 });
    card = researched.first();
  } catch {
    // Honest fallback; no data is synthesized for the screenshot.
  }
  await card.locator('.prop-card-v2__open').click();
  await page.waitForURL(/\/research\?/, { timeout: 20_000 });
  researchUrlRef.value = page.url();
  await page.waitForSelector('.player-cinematic-hero', { timeout: 30_000 });
  await settle(page, 2200);

  const researchFile = path.join(OUT, `research-${label}.png`);
  await page.screenshot({ path: researchFile, fullPage: false });
  const research = await researchMetrics(page);

  return { board, research, files: { board: path.basename(boardFile), research: path.basename(researchFile) } };
}

await waitForFrontend();
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  });
  const account = await createLegitimateSession(context);
  const live = await findLiveSport(context);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

  const researchUrl = { value: null };
  const mobile = await renderViewport(page, { width: 390, height: 844 }, 'iphone-390x844', live.sport, researchUrl);
  const desktop = await renderViewport(page, { width: 1440, height: 1000 }, 'desktop-1440x1000', live.sport, researchUrl);

  const payload = {
    ok: true,
    renderedAt: new Date().toISOString(),
    source: 'real production backend through branch-local Next proxy',
    account: { email: account.email },
    sport: live,
    mobile,
    desktop,
    browserErrors: errors,
  };
  await fs.writeFile(path.join(OUT, 'metrics.json'), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify(payload, null, 2));
} finally {
  await browser.close();
}
