// /api/health answered "ok" for every hour that password resets could not be
// delivered, because nothing in it looked at mail. This is the field that
// would have made that a one-line diagnosis instead of a session.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mailHealth } from '../lib/auth/mailer.mjs';

test('reports not configured when no provider key is present', () => {
  assert.deepEqual(mailHealth({}), { configured: false, provider: 'none', fromDomain: null });
});

test('reports the provider and sending domain, never the key or the address', () => {
  const out = mailHealth({ RESEND_API_KEY: 're_secret_value', MAIL_FROM: 'Oblige Props <noreply@obligeprops.com>' });
  assert.deepEqual(out, { configured: true, provider: 'resend', fromDomain: 'obligeprops.com' });
  const text = JSON.stringify(out);
  assert.ok(!text.includes('re_secret'), 'the key must never be reported');
  assert.ok(!text.includes('noreply@'), 'the mailbox must never be reported');
});

test('a bare address works too, and Mailgun needs both of its settings', () => {
  assert.equal(mailHealth({ SENDGRID_API_KEY: 'x', MAIL_FROM: 'noreply@example.test' }).fromDomain, 'example.test');
  assert.equal(mailHealth({ MAILGUN_API_KEY: 'x' }).configured, false);
  assert.equal(mailHealth({ MAILGUN_API_KEY: 'x', MAILGUN_DOMAIN: 'mg.example.test' }).provider, 'mailgun');
});
