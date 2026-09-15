import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rememberSigninLanding } from '../lib/ui/remember-signin.mjs';

test('returning customers get a remembered-email fast sign-in path without storing passwords', () => {
  const input = `<!doctype html><html><head></head><body><form id="authForm"><button id="tabIn" type="button">Sign in</button><input id="email" type="email"><input id="password" type="password"><label class="check"><input id="remember" type="checkbox" checked> Remember me for 30 days</label></form><script>\n(function(){var nativeAuth=true;})();</script></body></html>`;
  const output = rememberSigninLanding(input);

  assert.match(output, /Keep me signed in on this device/);
  assert.match(output, /remember your email on this device/i);
  assert.match(output, /obligeprops\.rememberedEmail\.v1/);
  assert.match(output, /localStorage\.setItem\(KEY/);
  assert.match(output, /email\.setAttribute\('autocomplete','username'\)/, 'password managers should recognize the username field');
  assert.match(output, /if\(signIn\)signIn\.click\(\)/, 'a remembered customer should land on Sign in, not Sign up');
  assert.doesNotMatch(output, /localStorage\.setItem\([^\n]*(password|token)/i, 'passwords and session tokens must never enter localStorage');
  assert.ok(output.indexOf('id="oblige-fast-signin"') < output.indexOf('<script>\n(function(){var nativeAuth=true;'), 'the helper must not alter or append to the native auth script');
});

test('remembered sign-in decoration is idempotent and leaves non-auth pages alone', () => {
  const auth = '<html><head></head><body><form id="authForm"><label class="check"><input id="remember" type="checkbox" checked> Remember me for 30 days</label></form></body></html>';
  const once = rememberSigninLanding(auth);
  const twice = rememberSigninLanding(once);
  assert.equal(twice, once);
  assert.equal((once.match(/id="oblige-fast-signin"/g) || []).length, 1);
  assert.equal(rememberSigninLanding('<html><body>public</body></html>'), '<html><body>public</body></html>');
});

test('production edge patch wires the fast sign-in wrapper after the existing account landing transform', () => {
  const edge = readFileSync(new URL('../lib/edge/frontdoor-patch.mjs', import.meta.url), 'utf8');
  assert.match(edge, /rememberSigninLanding/);
  assert.match(edge, /rememberSigninLanding\(researchLanding\(originalLandingPage\(options\)\)\)/);
});
