import test from 'node:test';
import assert from 'node:assert/strict';
import {
  publicError,
  publicMessageFor,
  publicErrorFromRecord,
  internalDetail,
  looksInternal,
  safeError,
  GENERIC_MESSAGE,
  PICKFINDER_SIGN_IN_FAILED,
  PUBLIC_MESSAGES,
} from '../lib/safe-error.mjs';

// The exact failure this work was opened for.
const MODAL_BACKDROP_ERROR = new Error(
  `locator.click: Timeout 3500ms exceeded.
Call log:
  - waiting for locator('button[type="submit"]')
  -   locator resolved to <button type="submit" class="cl-formButtonPrimary">Sign in</button>
  - attempting click action
  -   waiting for element to be visible, enabled and stable
  - <div class="cl-modalBackdrop cl-modalBackdrop-signIn">…</div> intercepts pointer events`,
);

test('the reported Playwright modal-backdrop error never reaches the user', () => {
  const { message } = publicError(MODAL_BACKDROP_ERROR, PICKFINDER_SIGN_IN_FAILED);
  assert.equal(message, PICKFINDER_SIGN_IN_FAILED);
  for (const secret of ['locator.click', 'Timeout 3500ms', 'Call log', 'cl-modalBackdrop', 'intercepts pointer events', 'button[type="submit"]', 'cl-formButtonPrimary']) {
    assert.ok(!message.includes(secret), `leaked: ${secret}`);
  }
});

test('unclassified errors collapse to generic copy (fails closed)', () => {
  assert.equal(publicMessageFor(new Error('ECONNREFUSED 10.0.0.4:5432')), GENERIC_MESSAGE);
  assert.equal(publicMessageFor(new Error('Cannot read properties of undefined (reading \'click\')')), GENERIC_MESSAGE);
  assert.equal(publicMessageFor('some string'), GENERIC_MESSAGE);
  assert.equal(publicMessageFor(null), GENERIC_MESSAGE);
  assert.equal(publicMessageFor(undefined), GENERIC_MESSAGE);
});

test('stack traces and file paths never survive the boundary', () => {
  const error = new Error('boom');
  error.stack = 'Error: boom\n    at performLogin (/app/scanner/pickfinder-v2.mjs:319:18)';
  const { message } = publicError(error);
  assert.equal(message, GENERIC_MESSAGE);
  assert.ok(!message.includes('/app/'));
  assert.ok(!message.includes('pickfinder-v2.mjs'));
});

test('known codes map to fixed, AutoProp-authored copy', () => {
  for (const [code, expected] of Object.entries(PUBLIC_MESSAGES)) {
    assert.equal(publicMessageFor({ code }), expected, `code ${code}`);
  }
});

test('an attacker-supplied code cannot select arbitrary copy', () => {
  assert.equal(publicMessageFor({ code: 'NOT_A_REAL_CODE' }), GENERIC_MESSAGE);
  assert.equal(publicError({ code: 'NOT_A_REAL_CODE' }).code, null);
  assert.equal(publicMessageFor({ code: 'constructor' }), GENERIC_MESSAGE);
  assert.equal(publicMessageFor({ code: '__proto__' }), GENERIC_MESSAGE);
  assert.equal(publicMessageFor({ code: 'toString' }), GENERIC_MESSAGE);
});

test('a publicMessage that contains internals is rejected, not forwarded', () => {
  const sloppy = safeError('PICKFINDER_AUTH_UI_CHANGED', 'locator.click: Timeout 3500ms exceeded');
  const { message } = publicError(sloppy);
  assert.equal(message, PUBLIC_MESSAGES.PICKFINDER_AUTH_UI_CHANGED);
  assert.ok(!message.includes('locator'));
});

test('safeError carries public copy outward and the cause inward', () => {
  const error = safeError('PICKFINDER_AUTH_BLOCKED', PICKFINDER_SIGN_IN_FAILED, { cause: MODAL_BACKDROP_ERROR });
  assert.equal(publicMessageFor(error), PICKFINDER_SIGN_IN_FAILED);
  const detail = internalDetail(error, { stage: 'test' });
  assert.equal(detail.stage, 'test');
  assert.equal(detail.code, 'PICKFINDER_AUTH_BLOCKED');
  assert.ok(detail.causeMessage.includes('cl-modalBackdrop'), 'diagnostics keep the real cause');
});

test('looksInternal flags automation and infrastructure detail', () => {
  const internal = [
    'locator.click: Timeout 3500ms exceeded',
    'Call log:\n  - attempting click action',
    '<div class="cl-modalBackdrop"> intercepts pointer events',
    'getByRole("button", { name: /sign in/i })',
    '    at performLogin (/app/scanner/pickfinder-v2.mjs:319:18)',
    'waiting for selector "input[type=password]"',
    'Error in node_modules/playwright-core/lib/client.js',
    'strict mode violation',
  ];
  for (const value of internal) assert.ok(looksInternal(value), `should be internal: ${value}`);

  for (const value of Object.values(PUBLIC_MESSAGES)) {
    assert.ok(!looksInternal(value), `product copy misflagged: ${value}`);
  }
  assert.ok(!looksInternal(GENERIC_MESSAGE));
});

test('stale diagnostic records written before sanitisation cannot leak', () => {
  // last-error.json files already on the Railway volume hold the raw message.
  const legacy = {
    at: '2026-09-08T00:00:00.000Z',
    message: 'locator.click: Timeout 3500ms exceeded ... cl-modalBackdrop intercepts pointer events',
    rawMessage: 'locator.click: Timeout 3500ms exceeded',
    code: 'PICKFINDER_AUTH_UI_CHANGED',
    stack: 'Error\n    at /app/scanner/pickfinder-v2.mjs:319:18',
  };
  const { message } = publicErrorFromRecord(legacy);
  assert.equal(message, PUBLIC_MESSAGES.PICKFINDER_AUTH_UI_CHANGED);
  assert.ok(!message.includes('locator'));
  assert.ok(!message.includes('cl-modalBackdrop'));
});

test('records with no code at all still yield safe copy', () => {
  const { message } = publicErrorFromRecord({ at: 'x', rawMessage: 'locator.click failed', stack: 'at /app/x.mjs:1:1' });
  assert.equal(message, GENERIC_MESSAGE);
});
