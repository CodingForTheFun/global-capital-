// The account gate, the landing page it serves, and re-pricing a projection
// at a new line without another paid request.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const { gateActive, gatedPath, gateHealth, signupPossible, resetGateWarning } = await import('../lib/auth/gate.mjs');
const { landingPage } = await import('../lib/auth/landing.mjs');
const { repriceProjection } = await import('../lib/projections/reprice.mjs');
const { scheduleContext } = await import('../lib/projections/service.mjs');
const { analysisSections, PROJECTION_OUTPUT_SCHEMA } = await import('../lib/projections/schema.mjs');

function clearAuthEnv() {
  delete process.env.REQUIRE_ACCOUNT;
  delete process.env.ACCOUNT_BETA_OPEN;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REDIRECT_URI;
  delete process.env.RESEND_API_KEY;
  delete process.env.POSTMARK_API_TOKEN;
  delete process.env.SENDGRID_API_KEY;
  resetGateWarning();
}

// --- the gate --------------------------------------------------------------

test('the gate never engages when nobody could get through it', () => {
  clearAuthEnv();
  assert.equal(signupPossible(), false);
  // This is the whole point: a gate in front of a broken sign-up is an outage,
  // not a funnel. It stands down and says so rather than locking everyone out.
  assert.equal(gateActive(), false);
  assert.equal(gateHealth().active, false);
});

test('beta mode alone is enough to open the gate', () => {
  clearAuthEnv();
  process.env.ACCOUNT_BETA_OPEN = 'true';
  try {
    assert.equal(signupPossible(), true);
    assert.equal(gateActive(), true);
    const health = gateHealth();
    assert.equal(health.passwordSignup, true, 'beta mode needs no mail provider');
    assert.equal(health.beta, true);
  } finally { clearAuthEnv(); }
});

test('a mail provider or Google also opens it', () => {
  clearAuthEnv();
  process.env.RESEND_API_KEY = 're_test';
  try { assert.equal(gateActive(), true); } finally { clearAuthEnv(); }

  process.env.GOOGLE_CLIENT_ID = 'id';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  process.env.GOOGLE_REDIRECT_URI = 'https://example.test/cb';
  try {
    assert.equal(gateActive(), true);
    assert.equal(gateHealth().googleSignup, true);
    // Google alone does not make a password form work.
    assert.equal(gateHealth().passwordSignup, false);
  } finally { clearAuthEnv(); }
});

test('REQUIRE_ACCOUNT=false turns it off even when sign-up works', () => {
  clearAuthEnv();
  process.env.ACCOUNT_BETA_OPEN = 'true';
  process.env.REQUIRE_ACCOUNT = 'false';
  try { assert.equal(gateActive(), false); } finally { clearAuthEnv(); }
});

test('the gate covers the board but never the routes needed to get in', () => {
  for (const path of ['/', '/props', '/research', '/apex', '/apex/board']) {
    assert.equal(gatedPath(path), true, `${path} should be gated`);
  }
  for (const path of [
    '/api/account/register', '/api/account/login', '/api/account/google/start',
    '/api/apex/props', '/assets/lib/analytics/research.mjs', '/api/account/health',
  ]) {
    assert.equal(gatedPath(path), false, `${path} must stay reachable while signed out`);
  }
});

// --- the landing page ------------------------------------------------------

test('the landing page carries the hero, the features and a working form', () => {
  const html = landingPage({ passwordSignup: true, googleSignup: true, beta: true });
  assert.match(html, /Institutional-grade prop intelligence/i);
  assert.match(html, /line discrepancies/i);
  assert.match(html, /free during beta/i);
  assert.match(html, /Stale line alerts/);
  assert.match(html, /Create free account/);
  assert.match(html, /Sign in/);
  assert.match(html, /Remember me for 30 days/);
  assert.match(html, /\/api\/account\/google\/start/);
  assert.match(html, /\/api\/account\/register/);
  assert.match(html, /18\+/);
});

test('the landing page hides a path that does not work', () => {
  const noGoogle = landingPage({ passwordSignup: true, googleSignup: false });
  assert.ok(!noGoogle.includes('/api/account/google/start'), 'no Google button without credentials');

  const nothing = landingPage({ passwordSignup: false, googleSignup: false });
  assert.ok(!nothing.includes('id="authForm"'), 'no dead form when sign-up cannot complete');
  assert.match(nothing, /being switched on/i);
});

test('the landing page cannot be used to bounce a visitor off-site', () => {
  const evil = landingPage({ next: 'https://example.evil/steal' });
  assert.ok(!evil.includes('example.evil'), 'an absolute URL must not become the redirect target');
  const protocolRelative = landingPage({ next: '//example.evil' });
  assert.ok(!protocolRelative.includes('example.evil'));
  // A real in-app path is kept.
  assert.match(landingPage({ next: '/props?sport=NFL' }), /\/props\?sport=NFL/);
});

test('the teaser is decorative, never real or invented prop data', async () => {
  const source = await fs.readFile(new URL('../lib/auth/landing.mjs', import.meta.url), 'utf8');
  // No player names, prices or lines anywhere in the marketing page.
  assert.ok(!/\bO\s*\d+\.\d\s*[-+]\d{3}\b/.test(source), 'no fabricated sportsbook prices');
  assert.match(source, /Blurred abstract shapes|never real props/i);
});

// --- re-pricing ------------------------------------------------------------

const entry = Object.freeze({
  available: true,
  projection: 33.2,
  line: 30.5,
  confidence: 70,
  probabilityOver: 0.68,
  calibration: { applied: true, stdDev: 8.4, sampleSize: 9 },
});

test('the projection itself never moves when the line does', () => {
  const out = repriceProjection(entry, { line: 35.5, overPrice: -110, underPrice: -110 });
  assert.equal(out.projection, 33.2, 'expected output does not depend on the offered line');
  assert.equal(out.line, 35.5);
  assert.equal(out.repriced, true);
  assert.equal(out.modelLine, 30.5);
});

test('raising the line lowers the chance of going over, and the edge with it', () => {
  const low = repriceProjection(entry, { line: 25.5, overPrice: -110, underPrice: -110 });
  const high = repriceProjection(entry, { line: 40.5, overPrice: -110, underPrice: -110 });
  assert.ok(low.probabilityOver > high.probabilityOver);
  assert.ok(low.edge > high.edge);
  assert.equal(low.edge, Number((33.2 - 25.5).toFixed(2)));
  // A line well above the projection should flip the side.
  assert.ok(high.probabilityOver < 0.5);
});

test('re-pricing at the original line agrees with the model it came from', () => {
  const same = repriceProjection(entry, { line: 30.5, overPrice: -110, underPrice: -110 });
  // Identical line returns the original entry untouched, not a second estimate.
  assert.equal(same, entry);
});

test('re-pricing declines rather than inventing a spread', () => {
  const noSpread = repriceProjection({ ...entry, calibration: { applied: false } }, { line: 35.5, overPrice: -110 });
  assert.equal(noSpread, null, 'without a measured spread there is nothing honest to price against');
  assert.equal(repriceProjection(null, { line: 30 }), null);
  assert.equal(repriceProjection({ available: false }, { line: 30 }), null);
});

test('EV and the pick label are recomputed from the price at the new line', () => {
  const cheap = repriceProjection(entry, { line: 25.5, overPrice: 150, underPrice: -200 });
  const dear = repriceProjection(entry, { line: 25.5, overPrice: -400, underPrice: 300 });
  assert.ok(cheap.evOver > dear.evOver, 'a better price must yield a better expected value');
  assert.ok(['STRONG OVER', 'LEAN OVER', 'PASS', 'LEAN UNDER', 'STRONG UNDER'].includes(cheap.pick));
});

// --- schedule context ------------------------------------------------------

test('rest days come from the log rather than a league-median guess', () => {
  const games = [
    { date: '2026-03-10T00:00:00.000Z', value: 30 },
    { date: '2026-03-07T00:00:00.000Z', value: 28 },
    { date: '2026-03-06T00:00:00.000Z', value: 22 },
  ];
  const context = scheduleContext(games, '2026-03-13T00:00:00.000Z');
  assert.equal(context.restDays, 3);
  assert.equal(context.gamesInLastSevenDays, 3);
  assert.equal(context.isBackToBack, false);

  const backToBack = scheduleContext(games, '2026-03-11T00:00:00.000Z');
  assert.equal(backToBack.restDays, 1);
  assert.equal(backToBack.isBackToBack, true);
});

test('no dates means null, never a stand-in value', () => {
  const empty = scheduleContext([], null);
  assert.equal(empty.restDays, null);
  assert.equal(empty.isBackToBack, null);
  assert.equal(empty.gamesInLastSevenDays, null);
});

// --- deep-dive sections ----------------------------------------------------

test('the four analysis sections are required of the model', () => {
  for (const key of ['scheme_matchup', 'usage_ripple', 'schedule_fatigue', 'game_script']) {
    assert.ok(PROJECTION_OUTPUT_SCHEMA.required.includes(key), `${key} must be required`);
    assert.ok(PROJECTION_OUTPUT_SCHEMA.properties[key], `${key} must be in the schema`);
  }
});

test('a section the payload could not support is dropped, not shown as filler', () => {
  const sections = analysisSections({
    scheme_matchup: 'Opponent allows 41 receiving yards per game to this position in the supplied log.',
    usage_ripple: 'Not enough data in this payload to assess.',
    schedule_fatigue: '   not enough data in this payload to assess.  ',
    game_script: '',
  });
  assert.equal(sections.length, 1);
  assert.equal(sections[0].label, 'Tactical & scheme matchup');
});

test('the prompt forbids writing a section from memory', async () => {
  const prompt = (await import('../lib/projections/system-prompt.mjs')).DEFAULT_PROJECTION_SYSTEM_PROMPT;
  assert.match(prompt, /THE PAYLOAD IS THE ONLY SOURCE/);
  assert.match(prompt, /Not enough data in this payload to assess\./);
  // And it must check the market against the position before writing.
  assert.match(prompt, /quarterback|position/i);
});
