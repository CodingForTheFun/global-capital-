import test from 'node:test';
import assert from 'node:assert/strict';
import {
  completePasswordReset, PasswordResetError, requestPasswordReset,
  RESET_SENT_MESSAGE, validateResetInput,
} from '../apps/oblige-web/lib/password-reset.mjs';
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '../lib/auth/passwords.mjs';
import { RESEND_COOLDOWN_MS } from '../lib/auth/codes.mjs';
import * as client from '../apps/oblige-web/lib/password-reset.mjs';

const valid = { email: 'reader@example.test', code: '012345', password: 'A long fixture passphrase!', confirmPassword: 'A long fixture passphrase!' };
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const sent = { ok: true, code: 'AUTH_RESET_SENT' };
const reset = { ok: true, code: 'AUTH_PASSWORD_RESET' };

test('recovery client mirrors the existing backend length and resend limits', () => {
  assert.equal(client.PASSWORD_MIN_LENGTH, PASSWORD_MIN_LENGTH);
  assert.equal(client.PASSWORD_MAX_LENGTH, PASSWORD_MAX_LENGTH);
  assert.equal(client.RESET_COOLDOWN_SECONDS * 1000, RESEND_COOLDOWN_MS);
});
test('email is required and validated before making any request', async () => {
  for (const email of ['', 'missing-at', 'a@', '@example.test', 'a b@example.test']) {
    await assert.rejects(requestPasswordReset(email, { fetchImpl: () => assert.fail('must not send') }), { code: 'VALIDATION' });
  }
});
test('a reset request needs only an email, never a password', () => {
  assert.equal(validateResetInput({ email: valid.email }), null);
});
test('code must be exactly six numeric characters, preserving leading zeroes', () => {
  assert.equal(validateResetInput(valid, true), null);
  for (const code of ['', '12345', '1234567', 'abcdef', 123456]) assert.match(validateResetInput({ ...valid, code }, true), /six-digit/);
});
test('matching passwords and backend length bounds are checked before POST', async () => {
  for (const patch of [{ password: 'short' }, { password: 'x'.repeat(201) }, { confirmPassword: 'not the same' }]) {
    await assert.rejects(completePasswordReset({ ...valid, ...patch }, { fetchImpl: () => assert.fail('must not send') }), { code: 'VALIDATION' });
  }
});
test('forgot sends only the trimmed email to the existing same-origin POST', async () => {
  let count = 0;
  const result = await requestPasswordReset(` ${valid.email} `, { fetchImpl: async (url, init) => {
    count++;
    assert.equal(url, '/api/account/password/forgot');
    assert.equal(init.method, 'POST');
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.cache, 'no-store');
    assert.deepEqual(JSON.parse(init.body), { email: valid.email });
    assert.equal(init.headers['content-type'], 'application/json');
    return reply({ ...sent, message: 'untrusted address-specific server copy' });
  } });
  assert.equal(count, 1);
  assert.deepEqual(result, { message: RESET_SENT_MESSAGE });
});
test('known and unknown addresses always get the same client confirmation', async () => {
  const options = { fetchImpl: async () => reply(sent) };
  assert.deepEqual(await requestPasswordReset(valid.email, options), await requestPasswordReset('unknown@example.test', options));
});
test('reset sends only email, code and unchanged password; no credentials in URL', async () => {
  const input = { ...valid, email: ` ${valid.email} `, code: ' 012345 ', password: '  Preserve spaces!  ', confirmPassword: '  Preserve spaces!  ' };
  const result = await completePasswordReset(input, { fetchImpl: async (url, init) => {
    assert.equal(url, '/api/account/password/reset');
    assert.equal(init.method, 'POST');
    assert.equal(init.credentials, 'same-origin');
    assert.deepEqual(JSON.parse(init.body), { email: valid.email, code: '012345', password: input.password });
    return reply(reset);
  } });
  assert.equal(result.code, 'AUTH_PASSWORD_RESET');
});
for (const [name, factory] of [
  ['HTML fallback', () => new Response('<html>Not a reset response</html>')],
  ['empty JSON', () => reply({})],
  ['explicit failure with HTTP 200', () => reply({ ok: false })],
  ['unrelated successful endpoint', () => reply({ ok: true, code: 'AUTH_SIGNED_IN' })],
]) test(`${name} cannot claim recovery succeeded`, async () => {
  await assert.rejects(requestPasswordReset(valid.email, { fetchImpl: async () => factory() }), PasswordResetError);
  await assert.rejects(completePasswordReset(valid, { fetchImpl: async () => factory() }), PasswordResetError);
});
for (const code of ['AUTH_CODE_INVALID', 'AUTH_CODE_EXPIRED', 'AUTH_CODE_EXHAUSTED', 'AUTH_PASSWORD_WEAK']) {
  test(`${code} is a visible failure without leaking raw server details`, async () => {
    await assert.rejects(completePasswordReset(valid, { fetchImpl: async () => reply({ ok: false, code, message: 'private internal details' }, 400) }), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.status, 400);
      assert.doesNotMatch(error.message, /private internal/);
      return true;
    });
  });
}
test('rate limits are not automatically retried', async () => {
  let calls = 0;
  await assert.rejects(requestPasswordReset(valid.email, { fetchImpl: async () => { calls++; return reply({ ok: false }, 429); } }), { code: 'RATE_LIMITED' });
  assert.equal(calls, 1);
});
test('network failures are not retried or reported as email delivery', async () => {
  let calls = 0;
  await assert.rejects(requestPasswordReset(valid.email, { fetchImpl: async () => { calls++; throw new Error('network unavailable'); } }), { code: 'NETWORK' });
  assert.equal(calls, 1);
});
test('timeout aborts the request instead of leaving the form busy indefinitely', async () => {
  await assert.rejects(requestPasswordReset(valid.email, { timeoutMs: 5, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }) }), { code: 'TIMEOUT' });
});
test('unmounted recovery cancels its request', async () => {
  const controller = new AbortController();
  const pending = requestPasswordReset(valid.email, { signal: controller.signal, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }) });
  controller.abort();
  await assert.rejects(pending, { code: 'ABORTED' });
});
test('already-aborted calls cannot send email', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(requestPasswordReset(valid.email, { signal: controller.signal, fetchImpl: () => assert.fail('must not send') }), { code: 'ABORTED' });
});
test('unknown error codes including inherited property names are safely handled', async () => {
  for (const code of ['UNKNOWN', 'constructor', '__proto__']) {
    await assert.rejects(requestPasswordReset(valid.email, { fetchImpl: async () => reply({ ok: false, code }, 500) }), (error) => {
      assert.equal(typeof error.message, 'string');
      assert.match(error.message, /could not be completed/);
      return true;
    });
  }
});
