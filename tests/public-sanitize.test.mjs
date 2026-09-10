import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePublicPayload, customerMessage, scrubText, mentionsVendor } from '../lib/public-sanitize.mjs';

const VENDORS = ['The Odds API', 'SportsDataIO', 'ClearSports', 'SportsGameOdds', 'PickFinder', 'the-odds-api'];
const seen = (payload) => JSON.stringify(payload);

test('every known vendor name is detected', () => {
  for (const vendor of VENDORS) assert.equal(mentionsVendor(`served by ${vendor} today`), true, vendor);
  assert.equal(mentionsVendor('served by our data partner'), false);
});

test('the exact coverage message from the live cards is replaced, not just scrubbed', () => {
  // Shown verbatim on every WNBA card before this change.
  const out = customerMessage('ClearSports does not currently document WNBA endpoints.');
  assert.ok(!mentionsVendor(out), out);
  assert.ok(!/endpoint/i.test(out), 'endpoint wording is our vendor contract, not the customer\'s problem');
  assert.equal(out, 'Historical data is not available for this league yet.');
});

test('entitlement and subscription wording never reaches a customer', () => {
  const out = customerMessage('Historical game logs are not included in the current stats subscription.');
  assert.ok(!/subscription|plan|tier|credit/i.test(out), out);
  assert.equal(out, 'Historical data is not available for this player yet.');
});

test('a plain product message is left alone', () => {
  const original = 'No usable historical games were returned for this player and market.';
  assert.equal(customerMessage(original), original);
});

test('scrubbing never leaves a dangling lowercase sentence', () => {
  const out = customerMessage('ClearSports is unavailable.');
  assert.ok(/^[A-Z]/.test(out), `must start capitalised: ${out}`);
  assert.ok(out.length > 11);
});

test('credit, quota and plan-limit fields are removed from a health payload', () => {
  // Shape captured from the live public endpoint.
  const live = {
    ok: true, service: 'autoscout-apex',
    theOddsApiConfigured: true, sportsDataIoConfigured: true,
    preferredProvider: 'The Odds API',
    provider: {
      id: 'the-odds-api', configured: true,
      bookmakers: ['prizepicks', 'fanduel'],
      maxEvents: 2, maxMarketsPerEvent: 6, monthlyCredits: 20000,
      diagnostics: { requestsToday: 41 },
    },
  };
  const out = sanitizePublicPayload(live);
  const text = seen(out);
  for (const field of ['monthlyCredits', 'maxEvents', 'maxMarketsPerEvent', 'diagnostics', 'requestsToday',
    'theOddsApiConfigured', 'sportsDataIoConfigured', 'preferredProvider']) {
    assert.ok(!text.includes(field), `${field} must not reach a customer`);
  }
  assert.ok(!mentionsVendor(text), text);
  assert.equal(out.ok, true, 'the useful part of the payload survives');
  assert.deepEqual(out.provider.bookmakers, ['prizepicks', 'fanduel'], 'sportsbooks are product data, not vendor detail');
});

test('sportsbook identity survives — it is what the customer is shopping', () => {
  const out = sanitizePublicPayload({
    props: [{ playerName: 'Angel Reese', sportsbook: 'FanDuel', sportsbookKey: 'fanduel', line: 2.5, source: 'The Odds API', provider: 'the-odds-api' }],
  });
  assert.equal(out.props[0].sportsbook, 'FanDuel');
  assert.equal(out.props[0].sportsbookKey, 'fanduel');
  assert.equal(out.props[0].line, 2.5);
  assert.ok(!mentionsVendor(seen(out)), seen(out));
});

test('a vendor label becomes a generic label rather than vanishing', () => {
  const out = sanitizePublicPayload({ meta: { provider: 'The Odds API', events: 2 } });
  assert.equal(out.meta.provider, 'Live odds', 'the key survives so callers do not break');
  assert.equal(out.meta.events, 2);
});

test('research payloads are labelled as stats, not odds', () => {
  const out = sanitizePublicPayload({ available: true, source: 'SportsDataIO' }, { statsContext: true });
  assert.equal(out.source, 'Historical stats');
});

test('nested arrays and objects are cleaned all the way down', () => {
  const out = sanitizePublicPayload({
    a: [{ b: [{ message: 'ClearSports does not currently document WNBA endpoints.', credits: 5 }] }],
  });
  const text = seen(out);
  assert.ok(!mentionsVendor(text), text);
  assert.ok(!text.includes('credits'));
  assert.equal(out.a[0].b[0].message, 'Historical data is not available for this league yet.');
});

test('sanitizing is idempotent', () => {
  const once = sanitizePublicPayload({ meta: { provider: 'The Odds API' }, message: 'ClearSports does not currently document WNBA endpoints.' });
  assert.deepEqual(sanitizePublicPayload(once), once);
});

test('non-objects and empties pass through safely', () => {
  assert.equal(sanitizePublicPayload(null), null);
  assert.equal(sanitizePublicPayload(42), 42);
  assert.equal(sanitizePublicPayload('plain text'), 'plain text');
  assert.deepEqual(sanitizePublicPayload([]), []);
  assert.equal(scrubText(null), '');
});
