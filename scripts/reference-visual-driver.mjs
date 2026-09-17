import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = (process.env.REFERENCE_VISUAL_BASE || 'http://localhost:3000').replace(/\/+$/, '');
const OUT = path.resolve(process.env.REFERENCE_VISUAL_OUT || 'reference-visual-artifacts');
const SPORTS = (process.env.REFERENCE_VISUAL_SPORTS || 'MLB,NFL,NBA,NHL,WNBA,NCAAF')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const QA_EMAIL = String(process.env.REFERENCE_VISUAL_EMAIL || '').trim();
const QA_PASSWORD = String(process.env.REFERENCE_VISUAL_PASSWORD || '');
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
  if (!QA_EMAIL || !QA_PASSWORD) {
    throw new Error(
      'Reference visual QA requires REFERENCE_VISUAL_EMAIL and REFERENCE_VISUAL_PASSWORD for a previously verified test account. Normal registration correctly requires email verification and cannot be used as a CI session shortcut.',
    );
  }

  const response = await context.request.post(`${BASE}/api/account/login`, {
    data: { email: QA_EMAIL, password: QA_PASSWORD, rememberMe: false },
    headers: { accept: 'application/json' },
  });
  const body = await response.json().catch(() => null);
  const token = sessionTokenFrom(response);
  if (!response.ok() || body?.ok !== true || !token) {
    const code = body?.code || body?.message || 'unknown response';
    throw new Error(
      `Verified QA login failed: HTTP ${response.status()} ${code} ok=${body?.ok === true} sessionCookie=${Boolean(token)}`,
    );
  }

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
  if (!me.ok() || meBody?.authenticated !== true || !meBody?.user?.id) {
    throw new Error(`Visual QA session was not accepted by /api/account/me: HTTP ${me.status()}`);
  }
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
  await page.locator('.prop-card-v2, article').first().waitFor({ state: 'visible', timeout: 45_000 });
  await page.waitForFunction(
    () => document.querySelectorAll('.prop-card-v2').length >= 2 || document.querySelectorAll('article').length >= 2,
    null,
    { timeout: 45_000 },
  );
}

async function settle(page, ms = 1200) {
  await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; }).catch(() => null);
  await page.waitForFunction(() => {
    const visibleImages = [...document.images].filter((image) => {
      const rect = image.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
    });
    return visibleImages.every((image) => image.complete);
  }, null, { timeout: 5_000 }).catch(() => null);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await sleep(ms);
}

async function boardMetrics(page) {
  return page.evaluate(() => {
    const rectOf = (element) => {
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
    const box = (selector) => rectOf(document.querySelector(selector));
    const propCards = [...document.querySelectorAll('.prop-card-v2')];
    const articleCards = [...document.querySelectorAll('article')];
    const cards = propCards.length ? propCards : articleCards;
    const visibleCards = cards.filter((card) => {
      const rect = card.getBoundingClientRect();
      return rect.top < innerHeight && rect.bottom > 0;
    }).length;
    const fullyVisibleCards = cards.filter((card) => {
      const rect = card.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight;
    }).length;
    const visibleImages = [...document.images].filter((image) => {
      const rect = image.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
    });
    return {
      viewport: { width: innerWidth, height: innerHeight },
      implementation: propCards.length ? 'BoardView/PropCard' : articleCards.length ? 'BetHoopsBoard/PredictionCard' : 'unknown',
      header: box('header[data-board="true"]'),
      summary: box('.board-summary'),
      toolbar: box('.board-toolbar'),
      grid: box('.board-grid'),
      firstCard: rectOf(cards[0]),
      cardCount: cards.length,
      cardsIntersectingViewport: visibleCards,
      cardsFullyVisible: fullyVisibleCards,
      visibleImages: visibleImages.length,
      loadedVisibleImages: visibleImages.filter((image) => image.complete && image.naturalWidth > 0).length,
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
    const visibleImages = [...document.images].filter((image) => {
      const rect = image.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
    });
    return {
      viewport: { width: innerWidth, height: innerHeight },
      header: box('header'),
      hero: box('.player-cinematic-hero'),
      sectionNav: box('.player-section-nav'),
      explorer: box('.player-explorer-panel'),
      firstChart: box('[title*=" · "]'),
      visibleImages: visibleImages.length,
      loadedVisibleImages: visibleImages.filter((image) => image.complete && image.naturalWidth > 0).length,
      bodyScrollWidth: document.documentElement.scrollWidth,
      bodyClientWidth: document.documentElement.clientWidth,
    };
  });
}

async function renderViewport(page, viewport, label, sport) {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto(`${BASE}/board`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await selectSport(page, sport);
  await settle(page, 1800);

  const boardFile = path.join(OUT, `board-${label}.png`);
  await page.screenshot({ path: boardFile, fullPage: false, animations: 'disabled', caret: 'hide' });
  const board = await boardMetrics(page);

  let openButton = page.locator('.prop-card-v2__open').first();
  if ((await openButton.count()) === 0) {
    openButton = page.getByRole('button', { name: 'Open analysis', exact: true }).first();
  }
  await openButton.waitFor({ state: 'visible', timeout: 20_000 });
  await openButton.click();
  await page.waitForURL(/\/research\?/, { timeout: 20_000 });
  await page.waitForSelector('.player-cinematic-hero', { timeout: 30_000 });
  await settle(page, 1600);

  const researchFile = path.join(OUT, `research-${label}.png`);
  await page.screenshot({ path: researchFile, fullPage: false, animations: 'disabled', caret: 'hide' });
  const research = await researchMetrics(page);

  return { board, research, files: { board: path.basename(boardFile), research: path.basename(researchFile) } };
}

await waitForFrontend();
const browser = await chromium.launch({ headless: true });
let context;
try {
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  await createLegitimateSession(context);
  const live = await findLiveSport(context);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

  const mobile = await renderViewport(page, { width: 390, height: 844 }, 'iphone-390x844', live.sport);
  const desktop = await renderViewport(page, { width: 1440, height: 1000 }, 'desktop-1440x1000', live.sport);

  const payload = {
    ok: true,
    renderedAt: new Date().toISOString(),
    source: 'real production backend through branch-local Next proxy',
    auth: 'preverified QA account through normal login route',
    sport: live,
    mobile,
    desktop,
    browserErrors: errors,
  };
  await fs.writeFile(path.join(OUT, 'metrics.json'), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify(payload, null, 2));
} catch (error) {
  const failure = {
    ok: false,
    renderedAt: new Date().toISOString(),
    source: 'real production backend through branch-local Next proxy',
    error: error instanceof Error ? error.message : String(error),
  };
  await fs.writeFile(path.join(OUT, 'failure.json'), `${JSON.stringify(failure, null, 2)}\n`);
  throw error;
} finally {
  await context?.close().catch(() => null);
  await browser.close();
}
