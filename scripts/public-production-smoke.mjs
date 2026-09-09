import { chromium } from 'playwright';

const BASE = process.env.AUTOSCOUT_PUBLIC_URL || 'https://autoprop-live-production.up.railway.app';

const rawResponse = await fetch(`${BASE}/apex`, { cache: 'no-store' });
const rawHtml = await rawResponse.text();
console.log(JSON.stringify({
  rawStatus: rawResponse.status,
  finalUrl: rawResponse.url,
  contentType: rawResponse.headers.get('content-type'),
  hasAutoScoutV3: rawHtml.includes('autoscout-v3-style'),
  hasRulesLabel: rawHtml.includes('AUTO SCOUT RULES'),
  hasAs3Literal: rawHtml.includes('id="as3"'),
  htmlStart: rawHtml.slice(0, 900),
  htmlEnd: rawHtml.slice(-900),
}, null, 2));

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error?.message || error)));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  const response = await page.goto(`${BASE}/apex`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3000);
  const state = await page.evaluate(() => ({
    url: location.href,
    readyState: document.readyState,
    as3: Boolean(document.querySelector('#as3')),
    bodyText: document.body?.innerText?.slice(0, 1000) || '',
    scriptCount: document.scripts.length,
    bodyChildCount: document.body?.children?.length || 0,
  }));
  console.log(JSON.stringify({ browserStatus: response?.status(), state, pageErrors, consoleErrors }, null, 2));
  if (!state.as3) throw new Error('Phase 2 shell did not boot; diagnostics printed above.');
} finally {
  await browser.close();
}
