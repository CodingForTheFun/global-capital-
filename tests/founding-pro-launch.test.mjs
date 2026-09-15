import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { billingPage } from '../lib/web/billing-pages.mjs';
import { landingPage } from '../lib/auth/landing.mjs';
import { researchClient, researchLanding } from '../lib/ui/research-home.mjs';

test('Founding Pro explains what customer revenue helps fund without pretending it is an investment', () => {
  const html = billingPage('/pricing', { origin: 'https://example.test' });
  assert.match(html, /Founding Pro/);
  assert.match(html, /live sportsbook/i);
  assert.match(html, /line[- ]history/i);
  assert.match(html, /infrastructure/i);
  assert.match(html, /deeper verified/i);
  assert.match(html, /not an investment/i);
  assert.match(html, /does not provide equity or ownership/i);
  assert.match(html, /No fake progress counter/i);
});

test('Founding Pro stays fail-closed until verified recurring billing is enabled', () => {
  const html = billingPage('/pricing');
  assert.match(html, /Founding Pro opens soon/);
  assert.match(html, /Verified recurring billing is not open yet/);
  assert.match(html, /\/api\/payments\/config/);
  assert.match(html, /\/api\/payments\/create-subscription/);
  assert.match(html, /x-csrf-token/);
});

test('signed-out visitors see the founding campaign without changing native auth behavior', () => {
  const original = landingPage({ passwordSignup: true, googleSignup: false, beta: true, next: '/apex' });
  const decorated = researchLanding(original);
  assert.match(decorated, /Help build faster live data/);
  assert.match(decorated, /Explore Founding Pro/);
  assert.match(decorated, /href="\/pricing"/);
  const marker = '<script>\n(function(){';
  assert.ok(original.includes(marker) && decorated.includes(marker));
  assert.equal(decorated.slice(decorated.indexOf(marker)), original.slice(original.indexOf(marker)));
});

test('signed-in customers can reach Founding Pro from the account menu', () => {
  const source = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
  const client = researchClient(source);
  assert.match(client, /id="asFounding"/);
  assert.match(client, /id="asFounding" href="\/pricing">Founding Pro/);
  assert.doesNotThrow(() => new vm.Script(client));
});
