import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  clearPickFinderConnection,
  clearPickFinderSession,
  loadPickFinderCredentials,
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
const clean = (v = '') => String(v).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

async function text(page) {
  return clean(await page.locator('body').innerText().catch(() => ''));
}

async function unlocked(page) {
  const body = await text(page);
  if (/sign\s*in\s*to\s*unlock|log\s*in\s*to\s*unlock|sign\s*in\s*to\s*view|more props are locked/i.test(body)) return false;
  if (/\bL5\b|\bL10\b|\bL15\b|\bH2H\b|Avg L10|Hit Rate|Supporting Stats|Gamelog - Last 15/i.test(body)) return true;
  return false;
}

async function firstVisible(locators, timeout = 650) {
  for (const locator of locators) {
    try {
      const first = locator.first();
      if (await first.isVisible({ timeout })) return first;
    } catch {}
  }
  return null;
}

function frames(page) {
  return [page.mainFrame(), ...page.frames().filter((frame) => frame !== page.mainFrame())];
}

async function findEmail(frame) {
  return firstVisible([
    frame.locator('input[type="email"]'),
    frame.locator('input[autocomplete="username"]'),
    frame.locator('input[name*="email" i]'),
    frame.locator('input[placeholder*="email" i]'),
  ], 450);
}

async function findPassword(frame) {
  return firstVisible([
    frame.locator('input[type="password"]'),
    frame.locator('input[autocomplete="current-password"]'),
    frame.locator('input[name*="password" i]'),
    frame.locator('input[placeholder*="password" i]'),
  ], 450);
}

async function fields(page) {
  for (const frame of frames(page)) {
    const email = await findEmail(frame);
    const password = await findPassword(frame);
    if (email || password) return { frame, email, password };
  }
  return { frame: page.mainFrame(), email: null, password: null };
}

async function submitButton(frame) {
  return firstVisible([
    frame.locator('button[type="submit"]'),
    frame.getByRole('button', { name: /sign\s*in|log\s*in|continue|next|submit/i }),
    frame.getByRole('link', { name: /sign\s*in|log\s*in|continue|next/i }),
  ], 700);
}

// PickFinder currently renders its sign-in UI inside a floating modal. On some
// builds the modal backdrop briefly sits above the visible submit control and
// intercepts Playwright pointer events. A normal click is preferred, then we
// safely submit the control's own form (or dispatch its click handler) without
// exposing Playwright's internal locator/call-log text to the dashboard.
async function activateControl(control, { fallbackField = null, settleMs = 1200 } = {}) {
  if (!control) return false;
  try {
    await control.scrollIntoViewIfNeeded().catch(() => {});
    await control.click({ timeout: 2200 });
    await wait(settleMs);
    return true;
  } catch {}

  try {
    await control.evaluate((node) => {
      const form = node.closest?.('form');
      if (form && typeof form.requestSubmit === 'function') {
        const isSubmitButton = String(node.tagName || '').toUpperCase() === 'BUTTON' && String(node.type || '').toLowerCase() === 'submit';
        form.requestSubmit(isSubmitButton ? node : undefined);
      } else if (typeof node.click === 'function') {
        node.click();
      }
    });
    await wait(settleMs);
    return true;
  } catch {}

  if (fallbackField) {
    try {
      await fallbackField.press('Enter');
      await wait(settleMs);
      return true;
    } catch {}
  }
  return false;
}

async function clickSignInSurface(page) {
  for (const frame of frames(page)) {
    const control = await firstVisible([
      frame.getByRole('button', { name: /sign\s*in|log\s*in|unlock/i }),
      frame.getByRole('link', { name: /sign\s*in|log\s*in|unlock/i }),
      frame.getByText(/sign\s*in\s*to\s*unlock/i, { exact: false }),
    ], 500);
    if (!control) continue;
    if (await activateControl(control, { settleMs: 1300 })) return true;
  }
  return false;
}

async function authDiagnostic(page, label) {
  try {
    const dir = path.join(DATA, 'diagnostics-v3');
    await fs.mkdir(dir, { recursive: true });
    const inputData = [];
    for (const frame of frames(page)) {
      const inputs = frame.locator('input');
      const count = Math.min(await inputs.count().catch(() => 0), 30);
      for (let i = 0; i < count; i++) {
        const node = inputs.nth(i);
        inputData.push({
          frameUrl: frame.url(),
          type: await node.getAttribute('type').catch(() => null),
          name: await node.getAttribute('name').catch(() => null),
          autocomplete: await node.getAttribute('autocomplete').catch(() => null),
          placeholder: await node.getAttribute('placeholder').catch(() => null),
        });
      }
    }
    const controls = [];
    for (const frame of frames(page)) {
      const nodes = frame.locator('button,a,[role="button"]');
      const count = Math.min(await nodes.count().catch(() => 0), 80);
      for (let i = 0; i < count; i++) {
        const node = nodes.nth(i);
        const labelText = clean(await node.innerText().catch(() => ''));
        if (!labelText) continue;
        controls.push({ frameUrl: frame.url(), text: labelText.slice(0, 120), href: await node.getAttribute('href').catch(() => null) });
      }
    }
    await fs.writeFile(path.join(dir, `${Date.now()}-${label}.json`), JSON.stringify({
      url: page.url(),
      frameUrls: frames(page).map((frame) => frame.url()),
      inputs: inputData,
      controls,
      bodyPreview: (await text(page)).slice(0, 12000),
    }, null, 2));
  } catch {}
}

async function exposeLoginForm(page) {
  await page.goto(PROPS, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await wait(1500);
  if (await unlocked(page)) return { alreadyUnlocked: true };

  await clickSignInSurface(page);
  let found = await fields(page);
  if (found.email || found.password) return { alreadyUnlocked: false, ...found };

  for (const url of [SIGNIN, `${BASE}/login`]) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await wait(3000);
    found = await fields(page);
    if (found.email || found.password) return { alreadyUnlocked: false, ...found };
    await clickSignInSurface(page);
    await wait(1000);
    found = await fields(page);
    if (found.email || found.password) return { alreadyUnlocked: false, ...found };
  }

  await authDiagnostic(page, 'login-surface-missing');
  throw Object.assign(new Error('PickFinder sign-in UI changed and AutoProp could not find the login form. Please reconnect after the authentication adapter updates.'), { code: 'PICKFINDER_AUTH_UI_CHANGED' });
}

async function loginWithCredentials(page, credentials) {
  let surface = await exposeLoginForm(page);
  if (surface.alreadyUnlocked) return;

  if (surface.email) await surface.email.fill(credentials.email);

  // Some auth providers expose email first, then password after Continue/Next.
  if (!surface.password) {
    const continueButton = await submitButton(surface.frame);
    if (continueButton) {
      const advanced = await activateControl(continueButton, { fallbackField: surface.email, settleMs: 1600 });
      if (!advanced) {
        await authDiagnostic(page, 'continue-action-blocked');
        throw Object.assign(new Error('PickFinder sign-in could not continue to the password step. Please reconnect and try again.'), { code: 'PICKFINDER_AUTH_UI_CHANGED' });
      }
      surface = { ...surface, ...(await fields(page)) };
    }
  }

  if (!surface.password) {
    const body = await text(page);
    await authDiagnostic(page, 'password-field-missing');
    if (/google|apple|magic\s*link|verification\s*code|one[- ]time/i.test(body)) {
      throw Object.assign(new Error('PickFinder is showing a provider or verification-code login. Complete that verification on PickFinder, then reconnect AutoProp.'), { code: 'PICKFINDER_INTERACTIVE_AUTH' });
    }
    throw Object.assign(new Error('PickFinder password step could not be verified. Please reconnect and try again.'), { code: 'PICKFINDER_AUTH_UI_CHANGED' });
  }

  await surface.password.fill(credentials.password);
  const submit = await submitButton(surface.frame);
  if (!submit) {
    await authDiagnostic(page, 'submit-button-missing');
    throw Object.assign(new Error('PickFinder sign-in could not be submitted. Please reconnect and try again.'), { code: 'PICKFINDER_AUTH_UI_CHANGED' });
  }

  const submitted = await activateControl(submit, { fallbackField: surface.password, settleMs: 1200 });
  if (!submitted) {
    await authDiagnostic(page, 'submit-action-blocked');
    throw Object.assign(new Error('PickFinder sign-in was blocked by its login window. Please reconnect and try again.'), { code: 'PICKFINDER_AUTH_UI_CHANGED' });
  }

  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await wait(1200);

  await page.goto(PROPS, { waitUntil: 'domcontentloaded', timeout: 45000 });
  for (let i = 0; i < 12; i++) {
    await wait(i === 0 ? 1200 : 650);
    if (await unlocked(page)) return;
  }

  const body = await text(page);
  await authDiagnostic(page, 'login-still-locked');
  if (/captcha|two[- ]factor|2fa|verification\s*code|one[- ]time|verify your/i.test(body)) {
    throw Object.assign(new Error('PickFinder requires interactive verification. Complete that verification on PickFinder, then reconnect AutoProp.'), { code: 'PICKFINDER_INTERACTIVE_AUTH' });
  }
  throw Object.assign(new Error('PickFinder did not unlock the analytics. Verify the account/subscription and reconnect.'), { code: 'PICKFINDER_RECONNECT' });
}

async function launch(storageState = null) {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({
    ...(storageState ? { storageState } : {}),
    viewport: { width: 1440, height: 1050 },
    locale: 'en-US',
    timezoneId: TZ,
  });
  return { browser, context, page: await context.newPage() };
}

export async function ensurePickFinderSession({ onProgress } = {}) {
  onProgress?.({ stage: 'auth', message: 'Verifying PickFinder session' });
  const saved = await loadPickFinderSession().catch(() => null);
  let runtime = await launch(saved);
  try {
    await runtime.page.goto(PROPS, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await wait(1300);
    if (await unlocked(runtime.page)) {
      await savePickFinderSession(await runtime.context.storageState());
      return { ok: true, reusedSession: Boolean(saved) };
    }
  } finally {
    await runtime.context.close().catch(() => {});
    await runtime.browser.close().catch(() => {});
  }

  await clearPickFinderSession().catch(() => {});
  const credentials = await loadPickFinderCredentials();
  if (!credentials) {
    throw Object.assign(new Error('PickFinder is not connected. Open Manage PickFinder and reconnect the account.'), { code: 'PICKFINDER_RECONNECT' });
  }

  onProgress?.({ stage: 'auth', message: 'Signing in to PickFinder' });
  runtime = await launch();
  try {
    await loginWithCredentials(runtime.page, credentials);
    await savePickFinderSession(await runtime.context.storageState());
    return { ok: true, reusedSession: false };
  } finally {
    await runtime.context.close().catch(() => {});
    await runtime.browser.close().catch(() => {});
  }
}

export async function verifyAndSavePickFinderConnection({ email, password } = {}) {
  if (!email || !password) {
    throw Object.assign(new Error('Enter your PickFinder email and password.'), { code: 'PICKFINDER_CREDENTIALS_REQUIRED' });
  }
  await savePickFinderCredentials({ email, password });
  await clearPickFinderSession().catch(() => {});
  try {
    const result = await ensurePickFinderSession();
    return { connected: true, sessionSaved: true, configured: true, reusedSession: result.reusedSession };
  } catch (error) {
    await clearPickFinderConnection().catch(() => {});
    // Never allow raw Playwright locator/call-log internals to escape to the UI.
    if (/locator\.|timeout\s*\d+ms|call log:|intercepts pointer events|getByRole\(|waiting for/i.test(String(error?.message || ''))) {
      throw Object.assign(new Error('PickFinder sign-in could not be completed because its login window changed. Please reconnect and try again.'), { code: 'PICKFINDER_AUTH_UI_CHANGED' });
    }
    throw error;
  }
}
