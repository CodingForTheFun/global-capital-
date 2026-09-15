import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { researchClient } from '../lib/ui/research-home.mjs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('public access-code form no longer advertises an owner password', () => {
  const source = '<div class="as5" id="as5">Access code or owner password</div>';
  const rendered = researchClient(source);
  assert.match(rendered, />Access code</);
  assert.doesNotMatch(rendered, /owner password/i);
});

test('live owner panel exposes owner-account access-code management', () => {
  const client = read('public/owner-v2.js');
  assert.match(client, /\/api\/admin\/access-codes/);
  assert.match(client, /\/api\/admin\/access-codes\/generate/);
  assert.match(client, /\/api\/admin\/access-codes\/revoke/);
  assert.match(client, />3 days</);
  assert.match(client, />1 year</);
  assert.match(client, />Unlimited</);
  assert.match(client, /Custom days/);
  assert.match(client, /Unlimited uses/);
  assert.match(client, /shown in full only now/);
});

test('owner access-code routes remain behind the designated owner account and CSRF', () => {
  const routes = read('lib/auth/admin-access-routes.mjs');
  assert.match(routes, /requireOwner\(user\)/);
  assert.match(routes, /csrfValid\(token/);
  assert.match(routes, /\/api\/admin\/access-codes\/generate/);
  assert.match(routes, /\/api\/admin\/access-codes\/revoke/);
});

test('owner can grant account access for three days, one year, custom time, or unlimited', () => {
  const render = read('public/owner-v2-render.js');
  const client = read('public/owner-v2.js');
  assert.match(render, /data-days="3"/);
  assert.match(render, /data-days="365"/);
  assert.match(render, /data-days="custom"/);
  assert.match(render, /data-unlimited="true"/);
  assert.match(client, /3650/);
  assert.match(client, /unlimited: true/);
});
