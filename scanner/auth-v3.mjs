import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  clearPickFinderSession,
  getPickFinderConnectionState,
  loadPickFinderSession,
  savePickFinderCredentials,
  savePickFinderSession,
} from './secure-store.mjs';

const BASE = process.env.PICKFINDER_BASE_URL || 'https://www.pickfinder.app';
const PROPS = process.env.PICKFINDER_PROPS_URL || `${BASE}/props`;
const SIGNIN = process.env.PICKFINDER_SIGN_IN_URL || `${BASE}/sign-in`;
const HEADLESS = String(process.env.HEADLESS ?? 'true').toLowerCase() !== 'false';
const DATA = path.resolve(process.env.DATA_DIR || './data');
const TZ = process.env.SCAN_TIME_ZONE || 'America/Chicago';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (value = '') => String(value).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

async function bodyText(page) {
  return clean(await page.locator('body').innerText().catch(() => ''));
}

async function unlocked(page) {
  const text = await bodyText(page);
  if (/sign\s+in\s+to\s+unlock|log\s+in\s+to\s+unlock|sign\s+in\s+to\s+view|more props are locked/i.test(text)) return false;
  const passwordVisible = await page.locator('input[type="password"]:visible').count().catch(() => 0);
  if (passwordVisible) return false;
  return /\bL5\b|\bL10\b|\bL15\b|\bH2H\b|Avg L10|Hit Rate/i.test(text);
}

async function safeDiagnostic(page, label, extra = {}) {
  try {
    const dir = path.join(DATA, 'diagnostics-auth-v3');
    await fs.mkdir(dir, { recursive: true });
    const controls = await page.locator('button,a,[role="button"],[role="link"]').allInnerTexts().catch(() => []);
    await fs.writeFile(path.join(dir, `${Date.now()}-${label}.json`), JSON.stringify({
      at: new Date().toISOString(),
      url: page.url(),
      controls: controls.map(clean).filter(Boolean).slice(0, 120),
      bodyPreview: (await bodyText(page)).slice(0, 8000),
      frameUrls: page.frames().map((frame) => frame.url()).filter(Boolean).slice(0, 20),
      ...extra,
    }, null, 2));
  } catch {}
}

async function clickAuthEntry(page) {
  const patterns = [
    /sign\s+in\s+to\s+unlock/i,
    /^sign\s*in$/i,
    /^log\s*in$/i,
    /^login$/i,
    /unlock/i,
  ];
  for (const pattern of patterns) {
    for (const locator of [
      page.getByRole('button', { name: pattern }),
      page.getByRole('link', { name: pattern }),
      page.getByText(pattern, { exact: false }),
    ]) {
      try {
        const item = locator.first();
        if (!await item.isVisible({ timeout: 400 })) continue;
        await item.scrollIntoViewIfNeeded().catch(() => {});
        await item.click({ timeout: 2500 });
        await wait(900);
        return true;
      } catch {}
    }
  }
  return false;
}

async function findInputAcrossFrames(page, kind) {
  const selectors = kind === 'email'
    ? ['input[type="email"]', 'input[name*="email" i]', 'input[autocomplete="username"]', 'input[placeholder*="email" i]']
    : ['input[type="password"]', 'input[name*="password" i]', 'input[autocomplete="current-password"]', 'input[placeholder*="password" i]'];

  for (const frame of page.frames()) {
    for (const selector of selectors) {
      try {
        const locator = frame.locator(selector).first();
        if (await locator.isVisible({ timeout: 250 })) return { frame, locator };
      } catch {}
    }
    try {
      const locator = frame.getByLabel(kind === 'email' ? /email/i : /password/i).first();
      if (await locator.isVisible({ timeout: 250 })) return { frame, locator };
    } catch {}
  }
  return null;
}

async function clickContinue(frame) {
  for (const pattern of [/^continue$/i, /^next$/i, /^sign\s*in$/i, /^log\s*in$/i, /^login$/i, /^submit$/i]) {
    for (const locator of [
      frame.getByRole('button', { name: pattern }),
      frame.locator('button[type="submit"]'),
      frame.locator('input[type="submit"]'),
    ]) {
      try {
        const item = locator.first();
        if (!await item.isVisible({ timeout: 300 })) continue;
        await item.click({ timeout: 3000 });
        await wait(900);
        return true;
      } catch {}
    }
  }
  return false;
}

async function locateAuthForm(page) {
  let email = await findInputAcrossFrames(page, 'email');
  let password = await findInputAcrossFrames(page, 'password');
  if (email || password) return { email, password };

  await clickAuthEntry(page);
  await wait(500);
  email = await findInputAcrossFrames(page, 'email');
  password = await findInputAcrossFrames(page, 'password');
  if (email || password) return { email, password };

  await page.goto(SIGNIN, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await wait(900);
  email = await findInputAcrossFrames(page, 'email');
  password = await findInputAcrossFrames(page, 'password');
  if (email || password) return { email, password };

  await clickAuthEntry(page);
  await wait(600);
  return {
    email: await findInputAcrossFrames(page, 'email'),
    password: await findInputAcrossFrames(page, 'password'),
  };
}

async function interactiveChallenge(page) {
  const text = await bodyText(page);
  return /captcha|verification code|verify your|two[- ]?factor|2fa|one[- ]?time|authenticator|security code|magic link/i.test(text);
}

async function submitCredentials(page, credentials) {
  let { email, password } = await locateAuthForm(page);
  if (!email && !password) {
    await safeDiagnostic(page, 'form-not-found');
    throw Object.assign(new Error('PickFinder sign-in UI could not be opened. The login flow may have changed.'), { code: 'PICKFINDER_AUTH_UI_CHANGED' });
  }

  if (email) {
    await email.locator.fill(credentials.email);
    if (!password) {
      await clickContinue(email.frame);
      await wait(700);
      password = await findInputAcrossFrames(page, 'password');
    }
  }

  if (!password) {
    if (await interactiveChallenge(page)) {
      await safeDiagnostic(page, 'interactive-verification');
      throw Object.assign(new Error('PickFinder requires interactive verification. Complete it on PickFinder, then reconnect AutoProp.'), { code: 'PICKFINDER_INTERACTIVE_VERIFICATION' });
    }
    await safeDiagnostic(page, 'password-not-found');
    throw Object.assign(new Error('PickFinder did not expose a password step that AutoProp can verify.'), { code: 'PICKFINDER_AUTH_UI_CHANGED' });
  }

  await password.locator.fill(credentials.password);
  const submitted = await clickContinue(password.frame);
  if (!submitted) {
    await safeDiagnostic(page, 'submit-not-found');
    throw Object.assign(new Error('PickFinder sign-in submit control could not be found.'), { code: 'PICKFINDER_AUTH_UI_CHANGED' });
  }

  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await wait(1200);
  if (await interactiveChallenge(page)) {
    await safeDiagnostic(page, 'interactive-verification');
    throw Object.assign(new Error('PickFinder requires interactive verification. Complete it on PickFinder, then reconnect AutoProp.'), { code: 'PICKFINDER_INTERACTIVE_VERIFICATION' });
  }
}

export async function verifyPickFinderConnection({ email, password } = {}) {
  if (!email || !password) throw new Error('Enter your PickFinder email and password.');
  await savePickFinderCredentials({ email, password });
  await clearPickFinderSession();

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, locale: 'en-US', timezoneId: TZ });
  const page = await context.newPage();
  try {
    await page.goto(PROPS, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await wait(800);
    if (!await unlocked(page)) await submitCredentials(page, { email, password });

    await page.goto(PROPS, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await wait(1000);
    if (!await unlocked(page)) {
      await safeDiagnostic(page, 'still-locked-after-submit');
      throw Object.assign(new Error('PickFinder accepted the sign-in flow but the props analytics are still locked. Verify the account/subscription and reconnect.'), { code: 'PICKFINDER_STILL_LOCKED' });
    }

    await savePickFinderSession(await context.storageState());
    return { connected: true, ...await getPickFinderConnectionState(), authFlow: 'unlock-aware-v3' };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

export async function validateSavedPickFinderSession() {
  const saved = await loadPickFinderSession();
  if (!saved) return { connected: false, unlocked: false };
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ storageState: saved, viewport: { width: 1440, height: 1050 }, locale: 'en-US', timezoneId: TZ });
  const page = await context.newPage();
  try {
    await page.goto(PROPS, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await wait(750);
    const isUnlocked = await unlocked(page);
    if (isUnlocked) await savePickFinderSession(await context.storageState()).catch(() => {});
    return { connected: isUnlocked, unlocked: isUnlocked };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
