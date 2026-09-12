import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
const base = 'http://127.0.0.1:3000';
const data = await mkdtemp(path.join(tmpdir(), 'obligepay-edge-ci-'));
await mkdir('artifacts', { recursive: true });
const server = spawn(process.execPath, ['frontdoor-clearsports.mjs'], { env: { ...process.env, PORT: '3000', NODE_ENV: 'production', DATA_DIR: data,
  ACCOUNT_BETA_OPEN: 'true', ACCOUNT_OWNER_EMAIL: 'owner@local.invalid', DASHBOARD_SESSION_SECRET: randomBytes(32).toString('hex'), AUTOPROP_MASTER_KEY: randomBytes(32).toString('hex'),
  AUTO_SCAN_MINUTES: '0', DEMO_MODE: 'false', THE_ODDS_API_KEY: '', SPORTSDATAIO_API_KEY: '', CLEARSPORTS_API_KEY: '', ANTHROPIC_API_KEY: '',
  GEMINI_API_KEY: 'edge-ci-fixture-only', NODE_OPTIONS: `--import=${path.resolve('tests/mock-guest-provider.mjs')}` }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; server.stdout.on('data', c => { log += c; }); server.stderr.on('data', c => { log += c; });
let browser, page; let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
try {
  let started = false;
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error('Frontdoor exited before healthcheck');
    try { if ((await fetch(base + '/api/health')).ok) { started = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  check(started, 'Integrated readiness includes guest and research core');
  check((await fetch(base + '/api/guest-health')).ok, 'Next.js health');
  const home = await fetch(base); const html = await home.text();
  check(html.includes('Find the story behind the line.'), 'Guests see the new dashboard');
  check(home.headers.get('cache-control').includes('no-store'), 'No shared caching for account-dependent home');
  check((await fetch(base + '/preview')).ok, 'Public preview route');
  check((await fetch(base + '/assets/edge-theme.css')).ok, 'Merged research theme');
  const session = await fetch(base + '/api/ask-prop');
  const cookie = session.headers.get('set-cookie').split(';')[0];
  check(session.headers.get('set-cookie').includes('HttpOnly'), 'Guest cookie is HttpOnly');
  const context = { player: 'Jayson Tatum', team: 'BOS', opponent: 'NYK', stat: 'Points', line: 26.5, pickDirection: 'OVER', recentGameResults: [31,29,24,35,28] };
  const ask = (body, extras = {}) => fetch(base + '/api/ask-prop', { method: 'POST', headers: { 'content-type': 'application/json', cookie, ...extras }, body: JSON.stringify(body) });
  check((await ask({ prompt: 42, prop: context })).status === 400, 'Non-string prompts rejected');
  check((await ask({ prompt: 'What happened?', prop: { ...context, recentGameResults: [999] } })).status === 400, 'Forged sample history rejected');
  check((await ask({ prompt: 'x'.repeat(9000), prop: context })).status === 413, 'Body limit enforced');
  check((await ask({ prompt: 'Count hits', prop: context }, { origin: 'https://not-our-site.invalid' })).status === 403, 'Cross-origin requests rejected');
  const first = await ask({ prompt: 'How many sample games hit?', prop: context });
  check(first.status === 200, 'First question succeeds against mocked LLM');
  check((await first.json()).answer.includes('4 games hit'), 'Correct canonical card context reaches model');
  const second = await ask({ prompt: 'One more?', prop: context });
  check(second.status === 403 && (await second.json()).code === 'AUTH_REQUIRED', 'Second query blocked by server');
  check((await (await fetch(base + '/api/ask-prop', { headers: { cookie } })).json()).used, 'Usage survives frontend storage reset');
  const cli = spawnSync('agent-browser', ['open', base], { encoding: 'utf8', timeout: 30000 });
  if (cli.status === 0) {
    const snap = spawnSync('agent-browser', ['snapshot', '-i'], { encoding: 'utf8', timeout: 30000 });
    await writeFile('artifacts/agent-browser-snapshot.txt', snap.stdout || snap.stderr || '');
    spawnSync('agent-browser', ['close'], { timeout: 10000 });
  } else await writeFile('artifacts/agent-browser-status.txt', cli.error?.message || cli.stderr || 'CLI unavailable; Playwright verification follows.');
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Jayson Tatum', exact: true }).waitFor();
  check(await page.getByTestId('active-line').textContent() === '26.5', 'Initial line');
  await page.getByRole('button', { name: 'Increase line', exact: true }).click();
  check(await page.getByTestId('active-line').textContent() === '27', 'Half-point adjuster');
  await page.getByRole('button', { name: 'UNDER', exact: true }).click();
  check(await page.getByTestId('hit-rate').textContent() === '20% hit', 'Under recalculates sample hit rate');
  await page.getByRole('button', { name: /Domantas Sabonis/ }).click();
  check(await page.getByTestId('active-line').textContent() === '12.5', 'Selection resets line');
  await page.getByRole('button', { name: 'Increase line', exact: true }).click();
  check(await page.getByTestId('hit-rate').textContent() === '75% hit', 'Push excluded from denominator');
  await page.screenshot({ path: 'artifacts/edge-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Filters 🔒', exact: true }).click();
  await page.getByRole('heading', { name: 'Create a Free Account', exact: true }).waitFor();
  check(await page.getByRole('dialog').isVisible(), 'Locked filter opens auth');
  await page.keyboard.press('Escape');
  await page.locator('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor();
  check(await page.getByRole('dialog').isVisible(), 'Login selects login form');
  await page.keyboard.press('Escape');
  await page.locator('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'MLB', exact: true }).first().click();
  await page.getByText('No sample cards match', { exact: true }).waitFor();
  check(await page.getByText('No sample cards match', { exact: true }).isVisible(), 'Empty sport is honest');
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile has no horizontal overflow');
  await page.screenshot({ path: 'artifacts/edge-mobile.png', fullPage: true });
  check(errors.length === 0, `No guest browser exceptions: ${errors.join('; ')}`);
  await page.getByRole('button', { name: 'Try for free', exact: true }).click();
  await page.getByRole('heading', { name: 'Create a Free Account', exact: true }).waitFor();
  await page.getByLabel('Email address', { exact: true }).fill('edge-ci-user@local.invalid');
  await page.getByLabel('Password', { exact: true }).fill('Local-QA-only!7933');
  await page.getByRole('button', { name: 'Create Free Account', exact: true }).click();
  await page.waitForURL('**/apex', { timeout: 20000 });
  const account = await page.evaluate(async () => (await fetch('/api/account/me')).json());
  check(account.authenticated === true, 'Real local beta registration signs in to existing account backend');
  const signedHome = await page.request.get(base);
  check(!(await signedHome.text()).includes('Find the story behind the line.'), 'Signed-in home remains real research app');
  await writeFile('artifacts/edge-verification.json', JSON.stringify({ passed: checks, browserErrors: errors, liveProviderCalled: false, productionAccountsModified: false }, null, 2));
  console.log(`EDGE_RELEASE_PASS: ${checks} assertions; desktop/mobile browser checks; isolated real registration; LLM fixture only.`);
} catch (error) {
  await page?.screenshot({ path: 'artifacts/edge-failure.png', fullPage: true }).catch(() => {});
  if (page) await writeFile('artifacts/edge-failure-text.txt', await page.locator('body').innerText().catch(() => 'Unavailable'));
  throw error;
} finally {
  await browser?.close(); server.kill('SIGTERM');
  await writeFile('artifacts/edge-server.log', log);
}
