import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// All browser API calls are intercepted. No reset mail or password mutation is
// allowed through, even when inspecting the deployed public UI.
const base = new URL(process.env.RESET_UI_BASE_URL || 'http://127.0.0.1:3000');
const local = ['127.0.0.1', 'localhost'].includes(base.hostname);
if (!local && base.origin !== 'https://www.obligeprops.com') throw new Error('Only local or the canonical ObligeProps host is allowed.');
const out = 'artifacts/password-reset';
await mkdir(out, { recursive: true });
const report = { mode: 'API-fixtured browser verification; no real emails or password changes', origin: base.origin, checks: [] };
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    const name = viewport.width < 600 ? 'mobile' : 'desktop';
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    let forgotCalls = 0, resetCalls = 0, loginCalls = 0;
    let resetOutcome = 'AUTH_CODE_EXPIRED';
    let releaseForgot;
    let holdForgot = false;
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== base.origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) {
        if (request.method() !== 'GET') return route.abort();
        return route.continue();
      }
      let body = { ok: false, code: 'AUTH_REQUIRED' }, status = 401;
      if (url.pathname === '/api/account/me') { body = { authenticated: false, user: null, mailConfigured: true }; status = 200; }
      if (url.pathname === '/api/account/google/status') { body = { available: false }; status = 200; }
      if (url.pathname === '/api/account/password/forgot') {
        forgotCalls++;
        assert.equal(request.method(), 'POST');
        assert.deepEqual(request.postDataJSON(), { email: 'recovery-fixture@example.test' });
        if (holdForgot) await new Promise((resolve) => { releaseForgot = resolve; });
        body = { ok: true, code: 'AUTH_RESET_SENT' }; status = 200;
      }
      if (url.pathname === '/api/account/password/reset') {
        resetCalls++;
        assert.equal(request.method(), 'POST');
        assert.deepEqual(request.postDataJSON(), { email: 'recovery-fixture@example.test', code: '012345', password: 'Long fixture passphrase!' });
        body = { ok: resetOutcome === 'AUTH_PASSWORD_RESET', code: resetOutcome };
        status = body.ok ? 200 : 400;
      }
      if (url.pathname === '/api/account/login') loginCalls++;
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      await page.goto(new URL('/account', base).href, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.getByRole('button', { name: 'Forgot password?', exact: true }).click();
      await page.getByRole('heading', { name: 'Reset your password', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Send reset code', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'Enter a valid email address.' }).waitFor();
      assert.equal(forgotCalls, 0);
      await page.getByLabel('Account email', { exact: true }).fill('recovery-fixture@example.test');
      await page.screenshot({ path: `${out}/${name}-request.png`, fullPage: true });
      holdForgot = true;
      await page.getByRole('button', { name: 'Send reset code', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('fieldset')?.disabled === true);
      // A second synthetic submit must still be rejected by the synchronous ref lock.
      await page.locator('form').evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      await page.waitForTimeout(100);
      assert.equal(forgotCalls, 1);
      assert.equal(typeof releaseForgot, 'function');
      releaseForgot();
      holdForgot = false;
      await page.getByRole('heading', { name: 'Choose a new password', exact: true }).waitFor();
      await page.getByRole('status').filter({ hasText: 'If that email address has an account' }).waitFor();
      assert.equal(await page.getByRole('button', { name: /Resend code in/ }).isDisabled(), true);
      assert.equal(await page.getByLabel('Account email', { exact: true }).getAttribute('readonly'), '');
      await page.getByLabel('Reset code', { exact: true }).fill('012345');
      await page.getByLabel('New password', { exact: true }).fill('Long fixture passphrase!');
      await page.getByLabel('Confirm new password', { exact: true }).fill('Different fixture password!');
      await page.getByRole('button', { name: 'Update password', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'do not match' }).waitFor();
      assert.equal(resetCalls, 0);
      await page.getByLabel('Confirm new password', { exact: true }).fill('Long fixture passphrase!');
      await page.getByRole('button', { name: 'Update password', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'expired' }).waitFor();
      assert.equal(resetCalls, 1);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      assert.equal(overflow, false, `${name}: recovery must not overflow horizontally`);
      assert.equal(await page.getByLabel('New password', { exact: true }).getAttribute('autocomplete'), 'new-password');
      assert.equal(await page.getByLabel('Reset code', { exact: true }).getAttribute('autocomplete'), 'one-time-code');
      await page.screenshot({ path: `${out}/${name}-reset.png`, fullPage: true, mask: [page.getByLabel('New password', { exact: true }), page.getByLabel('Confirm new password', { exact: true })] });
      resetOutcome = 'AUTH_PASSWORD_RESET';
      await page.getByRole('button', { name: 'Update password', exact: true }).click();
      await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor();
      await page.getByRole('status').filter({ hasText: 'Password updated. Sign in with your new password.' }).waitFor();
      assert.equal(await page.getByLabel('Password', { exact: true }).inputValue(), '');
      assert.equal(loginCalls, 0, 'Reset must not automatically sign in');
      assert.equal(resetCalls, 2);
      // Reopening retains only the email, never passwords/codes.
      await page.getByRole('button', { name: 'Forgot password?', exact: true }).click();
      assert.equal(await page.getByLabel('Account email', { exact: true }).inputValue(), 'recovery-fixture@example.test');
      await page.getByRole('button', { name: 'Already have a reset code?', exact: true }).click();
      await page.getByRole('heading', { name: 'Choose a new password', exact: true }).waitFor();
      assert.equal(await page.getByLabel('Reset code', { exact: true }).inputValue(), '');
      assert.equal(await page.getByLabel('New password', { exact: true }).inputValue(), '');
      assert.equal(forgotCalls, 1, 'Resume must not send another email');
      await page.getByRole('button', { name: 'Use a different email', exact: true }).click();
      await page.getByRole('heading', { name: 'Reset your password', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Back to sign in', exact: true }).click();
      await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor();
      const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
      assert.doesNotMatch(stored, /Long fixture passphrase|012345|recovery-fixture/);
      assert.deepEqual(pageErrors, []);
      report.checks.push({ viewport: name, status: 'PASS', forgotCalls, resetCalls, automaticLoginCalls: loginCalls, horizontalOverflow: overflow, pageErrors: 0 });
    } catch (error) {
      await page.screenshot({ path: `${out}/${name}-failure.png`, fullPage: true }).catch(() => {});
      report.checks.push({ viewport: name, status: 'FAIL', error: String(error.message) });
      throw error;
    } finally { await context.close(); }
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
