import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { billingPage } from '../lib/web/billing-pages.mjs';
import { landingPage } from '../lib/auth/landing.mjs';
import { researchClient, researchLanding } from '../lib/ui/research-home.mjs';

test('Oblige Pro explains what customer revenue supports without pretending it is an investment', () => {
  const html = billingPage('/pricing', { origin: 'https://example.test' });
  assert.match(html, /Oblige Pro/);
  assert.match(html, /live sportsbook/i);
  assert.match(html, /line history/i);
  assert.match(html, /infrastructure/i);
  assert.match(html, /verified research/i);
  assert.match(html, /not an investment/i);
  assert.match(html, /does not provide equity or ownership/i);
});

test('Oblige Pro stays fail-closed until verified recurring billing is enabled', () => {
  const html = billingPage('/pricing');
  assert.match(html, /Not open yet/);
  assert.match(html, /Pro checkout is not open yet/);
  assert.match(html, /\/api\/billing\/stripe\/config/);
  assert.match(html, /\/api\/billing\/stripe\/checkout/);
  assert.match(html, /x-csrf-token/);
});

test('signed-out visitors keep the founding campaign without changing native auth behavior', () => {
  const original = landingPage({ passwordSignup: true, googleSignup: false, beta: true, next: '/apex' });
  const decorated = researchLanding(original);
  assert.match(decorated, /Help build faster live data/);
  assert.match(decorated, /Explore Founding Pro/);
  assert.match(decorated, /href="\/pricing"/);
  const marker = '<script>\n(function(){';
  assert.ok(original.includes(marker) && decorated.includes(marker));
  assert.equal(decorated.slice(decorated.indexOf(marker)), original.slice(original.indexOf(marker)));
});

test('signed-in customers can reach the paid launch from the account menu', () => {
  const source = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
  const client = researchClient(source);
  assert.match(client, /id="asFounding"/);
  assert.match(client, /id="asFounding" href="\/pricing">Founding Pro/);
  assert.doesNotThrow(() => new vm.Script(client));
});