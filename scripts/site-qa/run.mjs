/**
 * Hourly site QA for obligeprops.com.
 *
 * Code-only checks (no model calls, no Claude credits): health, the news feed,
 * the props feed and the rendered pages at phone and desktop width. Findings
 * are written to qa-report.json and the job summary. The process exits 1 only
 * for findings not already alerted in the last DEDUPE_HOURS, so one break sends
 * one push from GitHub, not one an hour.
 *
 * Env:
 *   SITE_QA_BASE            site to check (default https://www.obligeprops.com)
 *   SITE_QA_SPORTS          props feeds to check (default NFL,MLB)
 *   SITE_QA_EXPECTED_SHA    production-stable head; a mismatch flags a stuck deploy
 *   SITE_QA_EXPECTED_SHA_AT that commit's ISO time; the check waits 30 min after it
 *   SITE_QA_STATE_IN/OUT    dedupe state from the previous run / for the next one
 *   SITE_QA_OUT             output directory (default site-qa-report)
 *   AUTOSCOUT_SMOKE_EMAIL / AUTOSCOUT_SMOKE_PASSWORD  pre-provisioned test account
 *   SITE_QA_CHROMIUM / SITE_QA_CHROMIUM_ARGS  local runs only
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { checkHealth, checkNews, checkPage, checkProps, dedupe, summarize } from './checks.mjs';

const BASE = (process.env.SITE_QA_BASE || 'https://www.obligeprops.com').replace(/\/+$/, '');
const SPORTS = (process.env.SITE_QA_SPORTS || 'NFL,MLB').split(',').map((v) => v.trim()).filter(Boolean);
const OUT = process.env.SITE_QA_OUT || 'site-qa-report';
const EMAIL = String(process.env.AUTOSCOUT_SMOKE_EMAIL || '').trim();
const PASSWORD = String(process.env.AUTOSCOUT_SMOKE_PASSWORD || '');
const DEPLOY_GRACE_MS = 30 * 60_000;

const findings = [];
const skipped = [];
const note = (id, severity, area, message) => findings.push({ id, severity, area, message });

async function getJson(path, init = {}) {
  const response = await fetch(BASE + path, { cache: 'no-store', ...init, signal: AbortSignal.timeout(20_000) });
  return { status: response.status, body: await response.json().catch(() => null), response };
}

async function signIn() {
  if (!EMAIL || !PASSWORD) {
    skipped.push('Signed-in checks (board, research, props feed): AUTOSCOUT_SMOKE_EMAIL / AUTOSCOUT_SMOKE_PASSWORD are not set');
    return null;
  }
  const { status, body, response } = await getJson('/api/account/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, rememberMe: false }),
  });
  const cookie = (response.headers.getSetCookie?.() || []).map((v) => String(v).split(';')[0]).find((v) => v.startsWith('sp_account='));
  if (status !== 200 || body?.ok !== true || !cookie) {
    note('auth:login', 'high', 'auth', `The QA test account could not sign in (HTTP ${status}${body?.code ? ' ' + body.code : ''})`);
    return null;
  }
  return cookie;
}

async function measure(browser, { path, width, cookie }) {
  const context = await browser.newContext({
    viewport: { width, height: width < 1024 ? 844 : 800 },
    deviceScaleFactor: width < 1024 ? 2 : 1,
    serviceWorkers: 'block',
  });
  if (cookie) {
    const [name, value] = cookie.split('=');
    await context.addCookies([{ name, value, url: BASE }]);
  }
  const page = await context.newPage();
  const errors = [];
  const cspViolations = [];
  page.on('pageerror', (error) => errors.push(String(error.message).slice(0, 200)));
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) cspViolations.push(message.text().slice(0, 200));
  });
  let status = 0;
  try {
    const response = await page.goto(BASE + path, { waitUntil: 'load', timeout: 45_000 });
    status = response?.status() || 0;
    await page.waitForTimeout(3000);
    // Walk the page so lazy images load before they are judged.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += innerHeight) {
        scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      scrollTo(0, 0);
    });
    await page.waitForTimeout(2000);
    const metrics = await page.evaluate(async () => {
      await document.fonts.ready;
      const nav = document.querySelector('nav[aria-label="Sections"]');
      const links = nav ? [...nav.querySelectorAll('a')].filter((a) => a.offsetParent) : [];
      const header = document.querySelector('body > header, header[data-board]') || document.querySelector('header');
      const box = header?.getBoundingClientRect();
      const style = header ? getComputedStyle(header) : null;
      return {
        overflowX: document.documentElement.scrollWidth - innerWidth,
        navRows: new Set(links.map((a) => Math.round(a.getBoundingClientRect().top))).size,
        headerVisible: Boolean(box && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'),
        fontsLoaded: [...document.fonts].some((face) => face.family.replace(/["']/g, '') === 'Inter' && face.status === 'loaded'),
        brokenImages: [...document.images].filter((img) => img.complete && img.naturalWidth === 0 && img.offsetParent && getComputedStyle(img).opacity !== '0').length,
      };
    });
    return { path, width, status, errors, cspViolations, ...metrics };
  } catch (error) {
    return { path, width, status, errors: [...errors, String(error.message).slice(0, 200)], cspViolations, overflowX: 0, navRows: 1, headerVisible: true, fontsLoaded: true, brokenImages: 0 };
  } finally {
    await context.close();
  }
}

function researchPath(row) {
  const params = new URLSearchParams({ sport: row.sport, player: row.playerName, market: row.market, line: String(row.line) });
  if (row.period && row.period !== 'game') params.set('period', row.period);
  return '/research?' + params;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const now = Date.now();

  const health = await getJson('/api/health').catch(() => ({ status: 0, body: null }));
  const expected = process.env.SITE_QA_EXPECTED_SHA || '';
  const expectedAt = Date.parse(process.env.SITE_QA_EXPECTED_SHA_AT || '') || 0;
  const checkRevision = expected && expectedAt && now - expectedAt > DEPLOY_GRACE_MS;
  if (expected && !checkRevision) skipped.push('Deploy revision check: the production-stable head is under 30 minutes old');
  findings.push(...checkHealth(health.body, { expectedRevision: checkRevision ? expected : '' }));

  const news = await getJson('/api/news?sport=all').catch(() => ({ body: null }));
  findings.push(...checkNews(news.body));

  const cookie = await signIn();
  let sample = null;
  if (cookie) {
    for (const sport of SPORTS) {
      const props = await getJson(`/api/apex/props?sport=${encodeURIComponent(sport)}`, { headers: { cookie } }).catch(() => ({ status: 0, body: null }));
      if (props.status !== 200) {
        note(`props:${sport}:http`, 'high', 'props', `${sport} props feed returned HTTP ${props.status}`);
        continue;
      }
      const rows = (props.body?.props || []).map((row) => ({ ...row, sport: row.sport || sport }));
      findings.push(...checkProps(sport, rows, { now }));
      sample ||= rows.find((row) => row.playerName && row.market && Number.isFinite(Number(row.line)));
    }
  }

  const pages = ['/', '/scores', '/news', '/account'];
  if (cookie) pages.push('/board');
  if (cookie && sample) pages.push(researchPath(sample));

  const browser = await chromium.launch({
    executablePath: process.env.SITE_QA_CHROMIUM || undefined,
    args: (process.env.SITE_QA_CHROMIUM_ARGS || '').split(' ').filter(Boolean),
  });
  const measured = [];
  try {
    for (const path of pages) {
      for (const width of [390, 1280]) {
        const signedIn = path === '/board' || path.startsWith('/research');
        const result = await measure(browser, { path, width, cookie: signedIn ? cookie : null });
        measured.push(result);
        findings.push(...checkPage({ ...result, path: path.split('?')[0] }));
      }
    }
  } finally {
    await browser.close();
  }

  const previous = process.env.SITE_QA_STATE_IN && existsSync(process.env.SITE_QA_STATE_IN)
    ? JSON.parse(readFileSync(process.env.SITE_QA_STATE_IN, 'utf8'))
    : {};
  const { fresh, state } = dedupe(findings, previous, { now });
  writeFileSync(process.env.SITE_QA_STATE_OUT || `${OUT}/state.json`, JSON.stringify(state, null, 2));

  const report = {
    checkedAt: new Date(now).toISOString(),
    base: BASE,
    revision: health.body?.revision || null,
    signedIn: Boolean(cookie),
    findings,
    newFindings: fresh.map((item) => item.id),
    skipped,
    pages: measured,
  };
  writeFileSync(`${OUT}/qa-report.json`, JSON.stringify(report, null, 2));
  const summary = summarize(findings, { skipped });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  console.log(summary);

  if (fresh.length) {
    console.error(`${fresh.length} new problem(s): ${fresh.map((item) => item.id).join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[site-qa] run failed:', error?.message || error);
  process.exitCode = 1;
});
