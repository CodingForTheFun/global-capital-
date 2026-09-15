import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { landingPage } from '../lib/auth/landing.mjs';
import { researchLanding } from '../lib/ui/research-home.mjs';

test('signed-out landing exposes complete verification and password recovery flows', () => {
  const original = landingPage({ passwordSignup: true, googleSignup: false, beta: false, next: '/apex' });
  const html = researchLanding(original);

  for (const id of [
    'authForm', 'verifyStep', 'verifyCode', 'verifySubmit', 'verifyResend',
    'forgotStep', 'resetEmail', 'forgotSubmit', 'resetStep', 'resetCode',
    'newPassword', 'confirmPassword', 'resetSubmit', 'resetResend',
  ]) assert.ok(html.includes(`id="${id}"`), id);

  for (const route of [
    '/api/account/register', '/api/account/login', '/api/account/verify',
    '/api/account/resend', '/api/account/password/forgot', '/api/account/password/reset',
  ]) assert.ok(html.includes(route), route);

  assert.match(html, /data\.requiresVerification/);
  assert.match(html, /Password updated\. Signing you in/);
  assert.ok(html.includes('a[href="/reset-password.html"]'));
  assert.ok(html.includes('RESEND_COOLDOWN_SECONDS=60'));
  assert.ok(html.includes('Resend code in '));

  const script = original.slice(original.indexOf('<script>') + '<script>'.length, original.indexOf('</script>'));
  new vm.Script(script);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.ok(scripts.length >= 2);
  for (const source of scripts) new vm.Script(source);
});

test('unsafe external next target still falls back to the local root', () => {
  const html = landingPage({ passwordSignup: true, next: 'https://evil.invalid' });
  assert.match(html, /mode='signup', next="\/"/);
});
