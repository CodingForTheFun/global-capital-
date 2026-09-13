// Isolated browser QA. Fixture rows never ship to the production UI.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
const base = 'http://127.0.0.1:3020';
const data = await mkdtemp(path.join(tmpdir(), 'edge-workspace-ci-'));
await mkdir('artifacts', { recursive: true });
const proc = spawn(process.execPath, ['frontdoor-clearsports.mjs'], { env: { ...process.env, PORT: '3020', NODE_ENV: 'production', DATA_DIR: data,
  ACCOUNT_BETA_OPEN: 'true', ACCOUNT_OWNER_EMAIL: 'owner@local.invalid', DASHBOARD_SESSION_SECRET: randomBytes(32).toString('hex'), AUTOPROP_MASTER_KEY: randomBytes(32).toString('hex'),
  AUTO_SCAN_MINUTES: '0', DEMO_MODE: 'false', THE_ODDS_API_KEY: '', SPORTSDATAIO_API_KEY: '', CLEARSPORTS_API_KEY: '', ANTHROPIC_API_KEY: '', GEMINI_API_KEY: ''
}, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '', browser, page, passed = 0;
proc.stdout.on('data', chunk => { log += chunk; }); proc.stderr.on('data', chunk => { log += chunk; });
function check(condition, label) { assert.ok(condition, label); passed++; console.log('WORKSPACE_PASS', label); }
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) throw new Error('Integrated service exited');
    try { if ((await fetch(base + '/api/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  check(ready, 'Integrated startup health');
  check((await fetch(base + '/sportsbooks')).ok, 'New public workspace page resolves');
  check((await fetch(base + '/api/apex/props?sport=NFL')).status === 401, 'Research data remains gated for guests');
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
  page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/sportsbooks', { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'One account. Both workspaces.', exact: true }).waitFor();
  check(await page.getByRole('heading', { name: 'One account. Both workspaces.', exact: true }).isVisible(), 'Signed-out conversion state');
  let nav = page.getByRole('navigation', { name: 'Primary workspace navigation' }).filter({ visible: true });
  const labels = await nav.locator('a').allTextContents();
  check(labels.at(-2) === 'Tools' && labels.at(-1) === 'Auto Scout', 'Auto Scout immediately follows Tools');
  check(await nav.getByRole('link', { name: 'Auto Scout', exact: true }).getAttribute('href') === '/apex', 'Native same-origin Auto Scout destination');
  const registration = await context.request.post(base + '/api/account/register', { data: { email: 'workspace-qa@local.invalid', password: randomBytes(18).toString('hex') } });
  check(registration.ok() && (await registration.json()).authenticated === true, 'Real isolated account signs in');
  const fixtureRows = (sport) => ['DraftKings','FanDuel','BetMGM','Caesars','Fanatics'].flatMap((book, b) => Array.from({length: 19}, (_, i) => ['OVER','UNDER'].map((side,s) => ({
    id: `${sport}-${book}-${i}-${side}`, sport, eventId: `game-${i}`, playerId:`player-${i}`, playerName: sport === 'NBA' ? `Basketball Sample ${i+1}` : `Football Sample ${i+1}`,
    market: i % 2 ? 'Receptions' : 'Receiving Yards', marketId: i % 2 ? 'player_receptions' : 'player_reception_yds',
    line: i % 2 ? 4.5 : 55.5 + b, side, price: b === 4 ? null : -110 + s * 5,
    sportsbookKey: book.toLowerCase(), sportsbook: book, homeTeam:'Home QA', awayTeam:'Away QA', live: i === 0,
    entityType:'player', isAlternate:false,
  }))).flat());
  await page.route('**/api/apex/props?*', route => { const sport = new URL(route.request().url()).searchParams.get('sport'); return route.fulfill({ json: { ok: true, props: sport === 'MLB' ? [] : fixtureRows(sport) } }); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Football Sample 1 OVER 55.5 DraftKings', exact: true }).waitFor();
  check(await page.getByRole('button', { name: 'Football Sample 1 OVER 55.5 DraftKings', exact: true }).isVisible(), 'Existing normalized feed renders comparison cells');
  await page.getByRole('button', { name: 'Football Sample 1 OVER 55.5 DraftKings', exact: true }).click();
  check(await page.getByRole('button', { name: 'Football Sample 1 OVER 55.5 DraftKings', exact: true }).getAttribute('aria-pressed') === 'true', 'Line toggles into research slip');
  await page.screenshot({ path: 'artifacts/workspace-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await page.getByText('Football Sample 19', { exact: true }).waitFor();
  check(await page.getByText('Football Sample 19', { exact: true }).isVisible(), 'Pagination');
  await page.getByLabel('Book filter', { exact: true }).selectOption('fanatics');
  await page.getByRole('button', { name: 'Football Sample 1 OVER 59.5 Fanatics', exact: true }).waitFor();
  check(await page.getByText('Line only', { exact: true }).count() > 0, 'Absent prices remain line-only, not invented odds');
  await page.getByLabel('Book filter', { exact: true }).selectOption('all');
  nav = page.getByRole('navigation', { name: 'Primary workspace navigation' }).filter({ visible: true });
  await nav.getByRole('link', { name: 'Tools', exact: true }).click();
  await page.getByRole('heading', { name: 'Research tools', exact: true }).waitFor();
  check(await page.getByText('190.91', { exact: true }).isVisible(), 'Tools calculator uses standard odds arithmetic');
  await nav.getByRole('link', { name: 'Analytics', exact: true }).click();
  await page.getByRole('heading', { name: 'Coverage analytics', exact: true }).waitFor();
  check(await page.getByRole('heading', { name: 'Coverage analytics', exact: true }).isVisible(), 'Analytics shows measured coverage');
  await nav.getByRole('link', { name: 'My Research', exact: true }).click();
  await page.getByRole('heading', { name: 'My research snapshots', exact: true }).waitFor();
  check(await page.getByRole('button', { name: 'Remove', exact: true }).count() === 1, 'Session research tab');
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'My research snapshots', exact: true }).waitFor();
  check(await page.getByRole('button', { name: 'Remove', exact: true }).count() === 1, 'Research snapshot survives page reload');
  await page.setViewportSize({ width: 390, height: 844 });
  nav = page.getByRole('navigation', { name: 'Primary workspace navigation' }).filter({ visible: true });
  await nav.getByRole('link', { name: 'Sports', exact: true }).click();
  await page.screenshot({ path: 'artifacts/workspace-mobile.png', fullPage: true });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Mobile has no page-wide overflow');
  await page.getByRole('button', { name: 'Research (1)', exact: true }).click();
  await page.getByRole('dialog', { name: 'Mobile research slip', exact: true }).waitFor();
  check(await page.getByRole('dialog', { name: 'Mobile research slip', exact: true }).isVisible(), 'Accessible mobile research drawer');
  await page.getByRole('button', { name: 'Close research slip', exact: true }).click();
  await page.getByRole('button', { name: 'NBA', exact: true }).click();
  await page.getByRole('button', { name: 'Basketball Sample 1 OVER 55.5 DraftKings', exact: true }).waitFor();
  check(!(await page.getByRole('button', { name: 'Football Sample 1 OVER 55.5 DraftKings', exact: true }).count()), 'Sport changes do not show stale sport rows');
  await page.getByRole('button', { name: 'MLB', exact: true }).click();
  await page.getByRole('heading', { name: 'No available props match', exact: true }).waitFor();
  check(await page.getByRole('heading', { name: 'No available props match', exact: true }).isVisible(), 'Empty feed stays honest');
  await page.getByRole('button', { name: 'NFL', exact: true }).click();
  nav = page.getByRole('navigation', { name: 'Primary workspace navigation' }).filter({ visible: true });
  await nav.getByRole('link', { name: 'Auto Scout', exact: true }).click();
  await page.waitForURL('**/apex');
  await page.locator('.as5 .edge-workspace-nav').waitFor({ timeout: 20000 });
  const scoutNav = page.locator('.as5 .edge-workspace-nav');
  const scoutLabels = await scoutNav.locator('a').allTextContents();
  check(scoutLabels.at(-2) === 'Tools' && scoutLabels.at(-1) === 'Auto Scout', 'Original Auto Scout gets matching shared navigation');
  check(await scoutNav.getByRole('link', { name: 'Auto Scout', exact: true }).getAttribute('aria-current') === 'page', 'Active Auto Scout tab');
  const me = await context.request.get(base + '/api/account/me');
  check((await me.json()).authenticated === true, 'Same login survives switching workspaces');
  await page.screenshot({ path: 'artifacts/workspace-autoscout-mobile.png', fullPage: true });
  await scoutNav.getByRole('link', { name: 'Sports', exact: true }).click();
  await page.waitForURL('**/sportsbooks#sports');
  await page.getByRole('heading', { name: 'Smarter research. One workspace.', exact: true }).waitFor();
  check(await page.getByRole('heading', { name: 'Smarter research. One workspace.', exact: true }).isVisible(), 'Return to sportsbook-style workspace');
  check(errors.length === 0, `No browser exceptions: ${errors.join('; ')}`);
  await writeFile('artifacts/workspace-report.json', JSON.stringify({ passed, fixtureData: true, productionAccountsCreated: false, paidProviderCalls: 0, browserErrors: errors }, null, 2));
  console.log('WORKSPACE_VERIFIED', passed);
} catch (error) {
  await page?.screenshot({ path: 'artifacts/workspace-failure.png', fullPage: true }).catch(() => {});
  if (page) await writeFile('artifacts/workspace-failure.txt', await page.locator('body').innerText().catch(() => 'Unavailable'));
  throw error;
} finally {
  await browser?.close(); proc.kill('SIGTERM');
  await writeFile('artifacts/workspace-server.log', log);
}
