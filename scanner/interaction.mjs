// Resilient control activation for the PickFinder sign-in surface.
//
// PickFinder renders sign-in inside a floating modal. On some builds the modal's
// backdrop element sits above the visible submit control and swallows pointer
// events, so Playwright's actionability check never clears and `click()` throws a
// timeout naming the backdrop. That is a UI-layering problem, not an auth
// problem, so we degrade to progressively more basic — but still genuine — ways
// of submitting the form the user already authorised.
//
// Every strategy here is an ordinary interaction with PickFinder's own login
// form: a real click, the form's own submit handler, or the Enter key. Nothing
// here bypasses CAPTCHA, 2FA, verification challenges or any access control;
// when PickFinder demands one of those, callers detect it and fail closed.
//
// This module intentionally imports nothing from Playwright: it operates on the
// locator objects handed to it, which keeps it unit-testable without a browser.

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Interception/timeout failures are retryable by a different strategy. */
export function isObstructionFailure(error) {
  const message = String(error?.message || error || '');
  return /intercepts pointer events|element is not visible|element is outside of the viewport|not stable|timeout .*exceeded|subtree intercepts/i.test(message);
}

async function attempt(label, run, trace) {
  try {
    const outcome = await run();
    if (outcome === false) {
      trace.push({ strategy: label, ok: false, reason: 'strategy reported no-op' });
      return false;
    }
    trace.push({ strategy: label, ok: true });
    return true;
  } catch (error) {
    trace.push({ strategy: label, ok: false, reason: String(error?.message || error).slice(0, 400), obstruction: isObstructionFailure(error) });
    return false;
  }
}

/**
 * Submit `control` by whatever means the page actually allows.
 *
 * @returns {Promise<{ok: boolean, strategy: string|null, trace: Array}>}
 *          `trace` is diagnostic detail for server logs only — never for the UI.
 */
export async function activateControl(control, {
  fallbackField = null,
  clickTimeout = 3500,
  retryTimeout = 2000,
  settleMs = 1200,
  overlaySettleMs = 700,
} = {}) {
  const trace = [];
  if (!control) return { ok: false, strategy: null, trace: [{ strategy: 'none', ok: false, reason: 'no control supplied' }] };

  await control.scrollIntoViewIfNeeded?.().catch(() => {});

  // 1. Preferred: a real user-equivalent click.
  if (await attempt('click', () => control.click({ timeout: clickTimeout }), trace)) {
    await wait(settleMs);
    return { ok: true, strategy: 'click', trace };
  }

  // 2. A modal backdrop is frequently mid-animation. Let it settle, click again.
  await wait(overlaySettleMs);
  if (await attempt('click-after-settle', () => control.click({ timeout: retryTimeout }), trace)) {
    await wait(settleMs);
    return { ok: true, strategy: 'click-after-settle', trace };
  }

  // 3. Ask the control's own form to submit itself. requestSubmit() runs the
  //    page's validation and fires a real `submit` event, so the site's own
  //    handler does the work exactly as it would for a click.
  if (await attempt('form-submit', () => control.evaluate((node) => {
    const form = node.closest?.('form') || (node.form ?? null);
    if (!form || typeof form.requestSubmit !== 'function') return false;
    const isSubmitButton = String(node.tagName || '').toUpperCase() === 'BUTTON'
      && String(node.type || 'submit').toLowerCase() === 'submit';
    form.requestSubmit(isSubmitButton ? node : undefined);
    return true;
  }), trace)) {
    await wait(settleMs);
    return { ok: true, strategy: 'form-submit', trace };
  }

  // 4. Press Enter in the field the user last filled — the ordinary keyboard
  //    path to submitting a login form, and unaffected by pointer interception.
  if (fallbackField && await attempt('keyboard-enter', () => fallbackField.press('Enter', { timeout: retryTimeout }), trace)) {
    await wait(settleMs);
    return { ok: true, strategy: 'keyboard-enter', trace };
  }

  // 5. Last resort: dispatch the element's own click handler in the DOM.
  if (await attempt('dom-click', () => control.evaluate((node) => {
    if (typeof node.click !== 'function') return false;
    node.click();
    return true;
  }), trace)) {
    await wait(settleMs);
    return { ok: true, strategy: 'dom-click', trace };
  }

  return { ok: false, strategy: null, trace };
}

/**
 * Wait until the page reports the analytics are unlocked.
 * `isUnlocked` is supplied by the caller so this stays browser-agnostic.
 */
export async function waitForUnlock(isUnlocked, { attempts = 12, firstDelayMs = 1200, delayMs = 650 } = {}) {
  for (let i = 0; i < attempts; i++) {
    await wait(i === 0 ? firstDelayMs : delayMs);
    if (await isUnlocked()) return true;
  }
  return false;
}
