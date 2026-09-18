import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

const BASE = process.env.AUTOSCOUT_PUBLIC_URL || 'https://www.obligeprops.com';
const EXPECTED_SHA = process.env.AUTOSCOUT_EXPECTED_SHA || '';
const HEALTH_ATTEMPTS = Math.max(1, Number.parseInt(process.env.AUTOSCOUT_SMOKE_HEALTH_ATTEMPTS || '60', 10) || 60);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth() {
  let last = 'no response';
  for (let i = 0; i < HEALTH_ATTEMPTS; i += 1) {
    try {
      const response = await fetch(`${BASE}/api/health`, { cache: 'no-store' });
      const body = await response.json();
      const revisionReady = !EXPECTED_SHA || body?.revision === EXPECTED_SHA;
      if (
        response.ok
        && body?.ok === true
        && body?.service === 'autoscout-apex'
        && body?.provider?.configured === true
        && revisionReady
      ) return body;
      last = `HTTP ${response.status} service=${body?.service || 'unknown'} revision=${body?.revision || 'none'}`;
    } catch (error) {
      last = error?.message || String(error);
    }
    await sleep(10_000);
  }
  throw new Error(`Production health did not become ready: ${last}`);
}

async function accountHealth() {
  const response = await fetch(`${BASE}/api/account/health`, { cache: 'no-store' });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true) throw new Error(`Account health returned HTTP ${response.status}`);
  if (body?.gate?.active !== true) throw new Error('Production account gate is not active.');
  return body;
}

async function verifySignedOutApiGate() {
  const response = await fetch(`${BASE}/api/apex/props?sport=NFL`, {
    cache: 'no-store',
    redirect: 'manual',
  });
  const body = await response.json().catch(() => null);
  if (response.status !== 401 || body?.code !== 'AUTH_REQUIRED') {
    throw new Error(`Signed-out prop API did not fail closed: HTTP ${response.status} code=${body?.code || 'none'}`);
  }
}

async function verifySignedOutBrowserGate() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const navigation = await page.goto(`${BASE}/apex`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (!navigation?.ok()) throw new Error(`Signed-out /apex returned HTTP ${navigation?.status() || 'unknown'}`);

    await page.waitForFunction(() => {
      const legacyGate = (
        Boolean(document.querySelector('#authForm'))
        || Boolean(document.querySelector('.gBtn'))
        || Boolean(document.querySelector('.note'))
      );
      const emailField = Boolean(document.querySelector('#account-email, input[type="email"]'));
      const credentialField = Boolean(document.querySelector('#account-password, #account-code, input[type="password"], input[inputmode="numeric"]'));
      return legacyGate || (emailField && credentialField);
    }, null, { timeout: 30_000 });

    if (await page.locator('.asRow').count()) throw new Error('Signed-out account gate exposed legacy prop rows.');
    const title = await page.title();
    const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
    if (!/Oblige Props/i.test(title) || !/Oblige Props/i.test(bodyText)) {
      throw new Error('Signed-out customer surface is not branded as Oblige Props.');
    }
    return {
      title,
      accountSurface: true,
      propRowsExposed: false,
      path: new URL(page.url()).pathname,
    };
  } finally {
    await browser.close();
  }
}

function runBetaAuthenticatedSmoke() {
  const child = spawnSync(process.execPath, ['scripts/public-production-smoke-v2.mjs'], {
    env: process.env,
    stdio: 'inherit',
  });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(`Authenticated beta smoke failed with exit code ${child.status ?? 'unknown'}.`);
}

const before = await waitForHealth();
const account = await accountHealth();
await verifySignedOutApiGate();
const browser = await verifySignedOutBrowserGate();

// In instant-signup beta mode, preserve the full authenticated prop-card smoke.
// When production requires email verification, do not create disposable fake
// customer accounts merely to satisfy CI. Verify the fail-closed account gate,
// canonical customer domain and production health instead.
let authenticatedSmoke = 'not-required';
if (account?.gate?.beta === true) {
  runBetaAuthenticatedSmoke();
  authenticatedSmoke = 'passed';
} else {
  authenticatedSmoke = 'verification-required';
}

const after = await waitForHealth();
if (after.startedAt !== before.startedAt) throw new Error('Data core restarted during production smoke.');

console.log(JSON.stringify({
  ok: true,
  revision: after.revision,
  host: new URL(BASE).host,
  providerConfigured: after.provider?.configured === true,
  databaseConfigured: after.persistence?.configured === true,
  accountGate: {
    active: account?.gate?.active === true,
    beta: account?.gate?.beta === true,
    passwordAvailable: account?.password?.available === true,
    googleAvailable: account?.google?.available === true,
  },
  signedOutGateVerified: true,
  authenticatedSmoke,
  browser,
  stableProcess: true,
}, null, 2));
