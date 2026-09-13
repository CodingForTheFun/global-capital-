// Read-only production checks: no accounts created, provider/AI calls or payments.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const base = 'https://www.obligepay.com';
const expected = process.env.GITHUB_SHA;
const report = { expected, observed: null, passed: 0, domain: base, accountCreated: false, errors: [] };
await mkdir('artifacts', { recursive: true });
const check = (ok, message) => { assert.ok(ok, message); report.passed++; console.log('PUBLIC_PASS', message); };
let browser;
try {
  for (let i = 0; i < 36; i++) {
    try {
      const r = await fetch(base + '/api/guest-health?verify=' + Date.now(), { signal: AbortSignal.timeout(10000) });
      const data = await r.json();
      if (r.ok && data.release === expected) { report.observed = data.release; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  check(report.observed === expected, 'Public domain runs the exact promoted release');
  check((await fetch(base + '/api/health')).ok, 'Integrated health');
  check((await fetch(base + '/api/apex/props?sport=NFL')).status === 401, 'Guest cannot bypass research API authentication');
  check((await fetch(base + '/assets/edge-workspace-nav.js')).ok, 'Auto Scout bridge script');
  check((await fetch(base + '/assets/edge-workspace-nav.css')).ok, 'Auto Scout navigation stylesheet');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', e => report.errors.push(e.message));
  const response = await page.goto(base + '/sportsbooks', { waitUntil: 'networkidle' });
  check(response.ok(), 'Live sportsbook workspace loads');
  await page.getByRole('heading', { name: 'One account. Both workspaces.', exact: true }).waitFor();
  let nav = page.getByRole('navigation', { name: 'Primary workspace navigation' }).filter({ visible: true });
  const labels = await nav.locator('a').allTextContents();
  check(labels.at(-2) === 'Tools' && labels.at(-1) === 'Auto Scout', 'Auto Scout immediately beside Tools in production');
  check(await nav.getByRole('link', { name: 'Auto Scout', exact: true }).getAttribute('href') === '/apex', 'Same-site destination');
  await page.screenshot({ path: 'artifacts/workspace-live-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Live mobile width fits');
  await page.screenshot({ path: 'artifacts/workspace-live-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Log in', exact: true }).first().click();
  await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor();
  check(await page.getByRole('dialog').isVisible(), 'Existing login form opens');
  check(report.errors.length === 0, 'No public browser exceptions');
  console.log('WORKSPACE_PUBLIC_VERIFIED', JSON.stringify(report));
} catch (e) { report.failure = e.message; throw e; }
finally { await browser?.close(); await writeFile('artifacts/workspace-live-report.json', JSON.stringify(report, null, 2)); }
