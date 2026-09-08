import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  clearPickFinderSession,
  getPickFinderConnectionState,
  loadPickFinderCredentials,
  loadPickFinderSession,
  savePickFinderCredentials,
  savePickFinderSession,
} from './secure-store.mjs';

const BASE = process.env.PICKFINDER_BASE_URL || 'https://www.pickfinder.app';
const PROPS = process.env.PICKFINDER_PROPS_URL || `${BASE}/props`;
const HEADLESS = String(process.env.HEADLESS ?? 'true').toLowerCase() !== 'false';
const DATA = path.resolve(process.env.DATA_DIR || './data');
const TZ = process.env.SCAN_TIME_ZONE || 'America/Chicago';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (value = '') => String(value).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

async function first(locators, timeout = 900) {
  for (const locator of locators) {
    try {
      const item = locator.first();
      if (await item.isVisible({ timeout })) return item;
    } catch {}
  }
  return null;
}

async function bodyText(page) {
  return clean(await page.locator('body').innerText().catch(() => ''));
}

async function visibleControls(page) {
  const locator = page.locator('button,a,[role="button"],[role="link"],[role="tab"],[role="combobox"],input');
  const count = Math.min(await locator.count().catch(() => 0), 180);
  const out = [];
  for (let i = 0; i < count; i++) {
    const item = locator.nth(i);
    if (!await item.isVisible().catch(() => false)) continue;
    const text = clean(await item.innerText().catch(() => '')) || clean(await item.getAttribute('aria-label').catch(() => '')) || clean(await item.getAttribute('placeholder').catch(() => ''));
    if (text && !out.includes(text) && !/@/.test(text)) out.push(text.slice(0, 140));
  }
  return out;
}

async function diagnostic(page, label, extra = {}) {
  if (String(process.env.DIAGNOSTICS ?? 'true').toLowerCase() === 'false') return;
  try {
    const dir = path.join(DATA, 'diagnostics-auth-v3');
    await fs.mkdir(dir, { recursive: true });
    const text = (await bodyText(page))
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
      .replace(/(token|password|secret)\s*[:=]\s*\S+/gi, '$1=[redacted]');
    await fs.writeFile(path.join(dir, `${Date.now()}-${label.replace(/[^a-z0-9_-]/gi, '-').slice(0, 60)}.json`), JSON.stringify({
      url: page.url(),
      controls: await visibleControls(page),
      bodyPreview: text.slice(0, 8000),
      ...extra,
    }, null, 2));
  } catch {}
}

async function discoverDetailUrl(page) {
  await page.goto(PROPS, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await wait(700);
  const link = await first([
    page.locator('a[href*="/players/"]'),
    page.getByRole('link').filter({ has: page.locator('[href*="/players/"]') }),
  ], 1100);
  const href = link ? await link.getAttribute('href').catch(() => null) : null;
  return href ? new URL(href, BASE).toString() : null;
}

function metricEvidence(text) {
  const patterns = ['L5', 'L10', 'L15', 'H2H'];
  let verified = 0;
  for (const label of patterns) {
    if (new RegExp(`${label}[^%\\n]{0,80}\\b\\d{1,3}%`, 'i').test(text)) verified++;
  }
  return verified;
}

async function verifyUnlocked(context, { keepPage = false } = {}) {
  const page = await context.newPage();
  try {
    const detailUrl = await discoverDetailUrl(page);
    if (!detailUrl) {
      await diagnostic(page, 'no-player-detail-link');
      return { unlocked: false, reason: 'No player detail link was available to verify the account.', detailUrl: null };
    }
    await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await wait(650);
    const text = await bodyText(page);
    if (/sign\s*in\s*to\s*unlock|log\s*in\s*to\s*unlock|login\s*to\s*unlock|subscribe\s*to\s*unlock/i.test(text)) {
      return { unlocked: false, reason: 'PickFinder detail analytics are locked.', detailUrl, page: keepPage ? page : null };
    }
    const evidence = metricEvidence(text);
    if (evidence < 2) {
      await diagnostic(page, 'detail-not-proven-unlocked', { detailUrl, metricEvidence: evidence });
      return { unlocked: false, reason: 'PickFinder did not expose enough historical analytics to prove the account is unlocked.', detailUrl, page: keepPage ? page : null };
    }
    return { unlocked: true, reason: null, detailUrl, page: keepPage ? page : null };
  } finally {
    if (!keepPage) await page.close().catch(() => {});
  }
}

async function findCredentialsForm(page) {
  const email = await first([
    page.locator('input[type="email"]'),
    page.getByLabel(/email|e-mail|username/i),
    page.getByPlaceholder(/email|e-mail|username/i),
    page.locator('input[name*="email" i]'),
    page.locator('input[name*="user" i]'),
  ], 700);
  const password = await first([
    page.locator('input[type="password"]'),
    page.getByLabel(/password/i),
    page.getByPlaceholder(/password/i),
    page.locator('input[name*="password" i]'),
  ], 700);
  return email && password ? { email, password } : null;
}

async function clickAuthEntry(page) {
  const patterns = [
    /sign\s*in\s*to\s*unlock/i,
    /^sign\s*in$/i,
    /^log\s*in$/i,
    /^login$/i,
    /unlock/i,
    /already have an account/i,
  ];
  for (const pattern of patterns) {
    const target = await first([
      page.getByRole('button', { name: pattern }),
      page.getByRole('link', { name: pattern }),
      page.getByText(pattern, { exact: false }),
    ], 500);
    if (!target) continue;
    try {
      await target.click({ timeout: 3000 });
      await wait(700);
      return true;
    } catch {}
  }
  return false;
}

async function openAuthForm(page) {
  // Start where PickFinder actually presents the lock, not at a guessed /sign-in route.
  const detailUrl = await discoverDetailUrl(page);
  if (detailUrl) {
    await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await wait(600);
    let form = await findCredentialsForm(page);
    if (form) return form;
    if (await clickAuthEntry(page)) {
      form = await findCredentialsForm(page);
      if (form) return form;
    }
  }

  // PickFinder has changed auth routes before. Probe likely routes only after the in-product entry point.
  for (const route of ['/login', '/signin', '/sign-in', '/auth/login', '/auth/sign-in']) {
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 18000 });
      await wait(450);
      let form = await findCredentialsForm(page);
      if (form) return form;
      if (await clickAuthEntry(page)) {
        form = await findCredentialsForm(page);
        if (form) return form;
      }
    } catch {}
  }

  await diagnostic(page, 'auth-form-not-found');
  throw Object.assign(new Error('PickFinder’s current sign-in form could not be opened automatically. The scanner captured a diagnostic so the login adapter can be calibrated without exposing your credentials.'), { code: 'PICKFINDER_AUTH_FORM_CHANGED' });
}

async function submitLogin(page, emailValue, passwordValue) {
  const form = await openAuthForm(page);
  await form.email.fill(String(emailValue));
  await form.password.fill(String(passwordValue));
  const submit = await first([
    page.locator('button[type="submit"]'),
    page.getByRole('button', { name: /sign\s*in|log\s*in|login|continue|submit/i }),
    page.locator('input[type="submit"]'),
  ], 1000);
  if (!submit) {
    await diagnostic(page, 'auth-submit-not-found');
    throw Object.assign(new Error('PickFinder’s sign-in submit control changed.'), { code: 'PICKFINDER_AUTH_FORM_CHANGED' });
  }
  await submit.click({ timeout: 4500 });
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await wait(1000);
  const text = await bodyText(page);
  if (/captcha|two[- ]factor|2fa|verification code|one[- ]time code|authenticator/i.test(text)) {
    await diagnostic(page, 'interactive-verification-required');
    throw Object.assign(new Error('PickFinder requires an interactive verification step for this login. AutoProp will not bypass it.'), { code: 'PICKFINDER_INTERACTIVE_REQUIRED' });
  }
  if (/invalid password|incorrect password|wrong password|invalid credentials|could not sign in/i.test(text)) {
    throw Object.assign(new Error('PickFinder rejected the email or password.'), { code: 'PICKFINDER_INVALID_CREDENTIALS' });
  }
}

async function browserContext(storageState = null) {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({
    ...(storageState ? { storageState } : {}),
    viewport: { width: 1440, height: 1050 },
    locale: 'en-US',
    timezoneId: TZ,
  });
  return { browser, context };
}

export async function connectPickFinderV3({ email, password } = {}) {
  const cleanEmail = String(email || '').trim();
  const cleanPassword = String(password || '');
  if (!cleanEmail || !cleanEmail.includes('@')) throw new Error('Enter the email for your own PickFinder account.');
  if (!cleanPassword) throw new Error('Enter your PickFinder password.');
  await clearPickFinderSession().catch(() => {});
  const { browser, context } = await browserContext();
  try {
    const page = await context.newPage();
    await submitLogin(page, cleanEmail, cleanPassword);
    const verification = await verifyUnlocked(context);
    if (!verification.unlocked) {
      await diagnostic(page, 'login-did-not-unlock', { reason: verification.reason, detailUrl: verification.detailUrl });
      throw Object.assign(new Error('PickFinder accepted the sign-in flow but the player analytics are still locked. Check that this PickFinder account has access, then reconnect.'), { code: 'PICKFINDER_NOT_UNLOCKED' });
    }
    await savePickFinderCredentials({ email: cleanEmail, password: cleanPassword });
    await savePickFinderSession(await context.storageState());
    return { connected: true, ...await getPickFinderConnectionState(), verifiedByDetailPage: true };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

export async function ensurePickFinderV3({ onProgress } = {}) {
  const progress = (message) => { try { onProgress?.({ stage: 'auth', message }); } catch {} };
  progress('Checking your PickFinder session');
  const saved = await loadPickFinderSession().catch(() => null);
  if (saved) {
    const { browser, context } = await browserContext(saved);
    try {
      const verification = await verifyUnlocked(context);
      if (verification.unlocked) {
        await savePickFinderSession(await context.storageState()).catch(() => {});
        return { connected: true, reusedSession: true };
      }
    } finally {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  }

  const credentials = await loadPickFinderCredentials().catch(() => null);
  if (!credentials?.email || !credentials?.password) {
    throw Object.assign(new Error('Connect your own PickFinder account before running a scan.'), { code: 'PICKFINDER_RECONNECT' });
  }
  progress('Refreshing your PickFinder login');
  await connectPickFinderV3({ email: credentials.email, password: credentials.password });
  return { connected: true, reusedSession: false };
}
