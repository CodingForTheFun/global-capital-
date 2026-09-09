import test from 'node:test';
import assert from 'node:assert/strict';
import { activateControl, waitForUnlock, isObstructionFailure } from '../scanner/interaction.mjs';
import { looksInternal } from '../lib/safe-error.mjs';

// The exact Playwright failure PickFinder's sign-in modal produces when its
// backdrop is layered above the submit button.
function backdropTimeout(ms = 3500) {
  return new Error(
    `locator.click: Timeout ${ms}ms exceeded.\n` +
    'Call log:\n' +
    "  - waiting for locator('button[type=\"submit\"]')\n" +
    '  - attempting click action\n' +
    '  - <div class="cl-modalBackdrop">…</div> intercepts pointer events',
  );
}

/** Minimal stand-in for a Playwright Locator. */
function fakeControl({ clickFails = 0, hasForm = true, domClickable = true } = {}) {
  const calls = [];
  let clicks = 0;
  return {
    calls,
    scrollIntoViewIfNeeded: async () => { calls.push('scroll'); },
    click: async () => {
      clicks++;
      calls.push('click');
      if (clicks <= clickFails) throw backdropTimeout();
    },
    evaluate: async (fn) => {
      calls.push('evaluate');
      // Mirror how the real page would answer the two evaluate payloads.
      const node = {
        tagName: 'BUTTON',
        type: 'submit',
        form: hasForm ? { requestSubmit() { calls.push('requestSubmit'); } } : null,
        closest: (selector) => (hasForm && selector === 'form' ? { requestSubmit() { calls.push('requestSubmit'); } } : null),
        click: domClickable ? () => { calls.push('domClick'); } : undefined,
      };
      return fn(node);
    },
  };
}

function fakeField() {
  const calls = [];
  return { calls, press: async (key) => { calls.push(`press:${key}`); } };
}

const fast = { settleMs: 0, overlaySettleMs: 0, clickTimeout: 10, retryTimeout: 10 };

test('a normal click is always preferred when the page allows it', async () => {
  const control = fakeControl();
  const field = fakeField();
  const result = await activateControl(control, { fallbackField: field, ...fast });
  assert.equal(result.ok, true);
  assert.equal(result.strategy, 'click');
  assert.ok(!control.calls.includes('evaluate'), 'no fallback should run');
  assert.deepEqual(field.calls, [], 'the keyboard path stays unused');
});

test('a backdrop that clears on its own is handled by the retry click', async () => {
  const control = fakeControl({ clickFails: 1 });
  const result = await activateControl(control, { fallbackField: fakeField(), ...fast });
  assert.equal(result.ok, true);
  assert.equal(result.strategy, 'click-after-settle');
  assert.ok(!control.calls.includes('requestSubmit'), 'DOM submission not needed');
});

test('a persistent modal backdrop falls back to the form’s own submit handler', async () => {
  // This is the reported production failure: the backdrop never yields.
  const control = fakeControl({ clickFails: Infinity });
  const field = fakeField();
  const result = await activateControl(control, { fallbackField: field, ...fast });

  assert.equal(result.ok, true, 'sign-in must still be submitted');
  assert.equal(result.strategy, 'form-submit');
  assert.ok(control.calls.includes('requestSubmit'), 'the site’s own submit handler runs');
  assert.deepEqual(field.calls, [], 'Enter is only needed when there is no form');
});

test('with no form, the keyboard Enter path submits the login', async () => {
  const control = fakeControl({ clickFails: Infinity, hasForm: false });
  const field = fakeField();
  const result = await activateControl(control, { fallbackField: field, ...fast });
  assert.equal(result.ok, true);
  assert.equal(result.strategy, 'keyboard-enter');
  assert.deepEqual(field.calls, ['press:Enter']);
});

test('DOM click is the last resort when nothing else is available', async () => {
  const control = fakeControl({ clickFails: Infinity, hasForm: false });
  const result = await activateControl(control, { fallbackField: null, ...fast });
  assert.equal(result.ok, true);
  assert.equal(result.strategy, 'dom-click');
  assert.ok(control.calls.includes('domClick'));
});

test('when every strategy fails the result is a clean failure, not a thrown Playwright error', async () => {
  const control = fakeControl({ clickFails: Infinity, hasForm: false, domClickable: false });
  const result = await activateControl(control, { fallbackField: null, ...fast });
  assert.equal(result.ok, false);
  assert.equal(result.strategy, null);
  assert.ok(result.trace.length >= 4, 'each attempt is recorded for diagnostics');
});

test('the diagnostic trace is server-side only and is never user-facing copy', async () => {
  const control = fakeControl({ clickFails: Infinity, hasForm: false, domClickable: false });
  const { trace } = await activateControl(control, { fallbackField: null, ...fast });
  const recorded = trace.map((row) => row.reason).filter(Boolean).join(' ');
  // The trace deliberately keeps the raw text for logs...
  assert.ok(recorded.includes('cl-modalBackdrop'), 'diagnostics retain the real cause');
  // ...and the sanitiser correctly identifies it as unfit for the dashboard.
  assert.ok(looksInternal(recorded), 'the trace must be classified as internal');
});

test('a missing control fails safely rather than throwing', async () => {
  const result = await activateControl(null, fast);
  assert.equal(result.ok, false);
  assert.equal(result.strategy, null);
});

test('obstruction failures are recognised as retryable by another strategy', () => {
  assert.equal(isObstructionFailure(backdropTimeout()), true);
  assert.equal(isObstructionFailure(new Error('element is not visible')), true);
  assert.equal(isObstructionFailure(new Error('locator.click: Timeout 3500ms exceeded')), true);
  assert.equal(isObstructionFailure(new Error('net::ERR_CONNECTION_REFUSED')), false);
});

test('waitForUnlock polls until the page reports unlocked, then stops', async () => {
  let checks = 0;
  const ok = await waitForUnlock(async () => ++checks >= 3, { attempts: 10, firstDelayMs: 0, delayMs: 0 });
  assert.equal(ok, true);
  assert.equal(checks, 3, 'polling stops at the first success');

  const never = await waitForUnlock(async () => false, { attempts: 4, firstDelayMs: 0, delayMs: 0 });
  assert.equal(never, false, 'a still-locked page fails closed');
});
