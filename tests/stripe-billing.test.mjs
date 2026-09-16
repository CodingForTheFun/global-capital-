// Stripe exists here for hosted Checkout, including native Apple Pay and Google
// Pay when supported. The money-safety rules are identical to the PayPal path,
// and these tests pin them.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  stripeConfig,
  stripeConfigured,
  stripePriceIdForPlan,
  normalizeStripeBillingPlan,
  verifyWebhookSignature,
  ACTIVE_SUBSCRIPTION_STATUSES,
} from '../payments/stripe.mjs';

const SECRET = 'whsec_testsecretvalue';
const clear = () => {
  for (const k of [
    'STRIPE_SECRET_KEY','STRIPE_PRICE_ID','STRIPE_PRICE_MONTHLY_ID',
    'STRIPE_PRICE_QUARTERLY_ID','STRIPE_PRICE_ANNUAL_ID','STRIPE_WEBHOOK_SECRET','BILLING_ENABLED',
  ]) delete process.env[k];
};
const sign = (ts, body, secret = SECRET) => crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
const nowSec = () => Math.floor(Date.now() / 1000);

test('with nothing configured Stripe is inert', () => {
  clear();
  const c = stripeConfig();
  assert.equal(c.enabled, false);
  assert.equal(c.credentialsConfigured, false);
  assert.equal(c.launchConfigured, false);
  assert.equal(stripeConfigured(), false);
});

test('credentials alone can never start charging', () => {
  clear();
  process.env.STRIPE_SECRET_KEY = 'sk_live_abc123';
  process.env.STRIPE_PRICE_ID = 'price_abc123';
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  const c = stripeConfig();
  assert.equal(c.subscriptionConfigured, true);
  assert.equal(c.enabled, false, 'BILLING_ENABLED must be a separate deliberate act');
  process.env.BILLING_ENABLED = 'true';
  assert.equal(stripeConfig().enabled, true);
  clear();
});

test('the legacy price id remains the monthly fallback during migration', () => {
  clear();
  process.env.STRIPE_PRICE_ID = 'price_legacy';
  assert.equal(stripePriceIdForPlan('monthly'), 'price_legacy');
  process.env.STRIPE_PRICE_MONTHLY_ID = 'price_monthly';
  assert.equal(stripePriceIdForPlan('monthly'), 'price_monthly');
  clear();
});

test('three configured cadences are explicit and client input cannot become a price id', () => {
  clear();
  process.env.STRIPE_SECRET_KEY = 'sk_live_abc';
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  process.env.STRIPE_PRICE_MONTHLY_ID = 'price_monthly';
  process.env.STRIPE_PRICE_QUARTERLY_ID = 'price_quarterly';
  process.env.STRIPE_PRICE_ANNUAL_ID = 'price_annual';
  const c = stripeConfig();
  assert.equal(c.launchConfigured, true);
  assert.deepEqual(c.configuredPlans, ['monthly', 'quarterly', 'annual']);
  assert.equal(stripePriceIdForPlan('quarterly'), 'price_quarterly');
  assert.equal(stripePriceIdForPlan('price_attacker'), null);
  assert.equal(normalizeStripeBillingPlan('annual', null), 'annual');
  assert.equal(normalizeStripeBillingPlan('price_attacker', null), null);
  clear();
});

test('live mode is decided by the key itself, not a separate variable', () => {
  clear();
  process.env.STRIPE_PRICE_ID = 'price_abc123';
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
  assert.equal(stripeConfig().environment, 'test');
  process.env.STRIPE_SECRET_KEY = 'sk_live_abc';
  assert.equal(stripeConfig().environment, 'live');
  clear();
});

test('a malformed price or webhook secret is not accepted as configured', () => {
  clear();
  process.env.STRIPE_SECRET_KEY = 'sk_live_abc';
  process.env.STRIPE_PRICE_ID = 'prod_wrongkind';
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  assert.equal(stripeConfig().credentialsConfigured, false, 'a product id is not a price id');
  process.env.STRIPE_PRICE_ID = 'price_ok';
  process.env.STRIPE_WEBHOOK_SECRET = 'not-a-whsec';
  assert.equal(stripeConfig().subscriptionConfigured, false);
  clear();
});

test('config never leaks the secret key', () => {
  clear();
  process.env.STRIPE_SECRET_KEY = 'sk_live_SUPERSECRETVALUE';
  process.env.STRIPE_PRICE_ID = 'price_abc';
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  const serialized = JSON.stringify(stripeConfig());
  assert.ok(!serialized.includes('SUPERSECRETVALUE'), 'the key must never reach a response body');
  assert.ok(!serialized.includes(SECRET), 'the webhook secret must never reach a response body');
  clear();
});

test('a correctly signed webhook verifies', () => {
  const body = '{"type":"checkout.session.completed"}';
  const ts = nowSec();
  assert.equal(verifyWebhookSignature({ header: `t=${ts},v1=${sign(ts, body)}`, rawBody: body, secret: SECRET }).ok, true);
});

test('a forged or tampered webhook is rejected', () => {
  const ts = nowSec();
  const body = '{"amount":500}';
  assert.equal(verifyWebhookSignature({ header: `t=${ts},v1=${'a'.repeat(64)}`, rawBody: body, secret: SECRET }).reason, 'BAD_SIGNATURE');
  const realSig = sign(ts, body);
  assert.equal(verifyWebhookSignature({ header: `t=${ts},v1=${realSig}`, rawBody: '{"amount":1}', secret: SECRET }).reason, 'BAD_SIGNATURE');
});

test('a replayed old delivery is rejected even with a real signature', () => {
  const ts = nowSec() - 3600;
  const body = '{}';
  assert.equal(verifyWebhookSignature({ header: `t=${ts},v1=${sign(ts, body)}`, rawBody: body, secret: SECRET }).reason, 'TIMESTAMP_OUT_OF_RANGE');
});

test('a short signature is rejected without throwing', () => {
  const ts = nowSec();
  assert.equal(verifyWebhookSignature({ header: `t=${ts},v1=abc`, rawBody: '{}', secret: SECRET }).reason, 'BAD_SIGNATURE');
});

test('only genuinely paying statuses hold Pro open', () => {
  assert.ok(ACTIVE_SUBSCRIPTION_STATUSES.has('active'));
  assert.ok(ACTIVE_SUBSCRIPTION_STATUSES.has('trialing'));
  for (const status of ['past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']) {
    assert.ok(!ACTIVE_SUBSCRIPTION_STATUSES.has(status), `${status} must not grant access`);
  }
});

test('the webhook is the only thing that grants, and revocation is scoped', () => {
  const routes = readFileSync(new URL('../lib/billing/stripe-routes.mjs', import.meta.url), 'utf8');
  assert.match(routes, /const subscription = await getSubscription\(subscriptionId\);/,
    'a signed event is still re-read, so a replayed delivery cannot grant stale access');
  assert.match(routes, /if \(current\?\.record\?\.source !== SOURCE \|\| text\(current\?\.record\?\.reference\) !== subscriptionId\)/,
    'a late cancellation must not erase newer access the customer has paid for');
  assert.match(routes, /client_reference_id/);
});

test('the account is taken from the signed session, never the request body', () => {
  const stripe = readFileSync(new URL('../payments/stripe.mjs', import.meta.url), 'utf8');
  const routes = readFileSync(new URL('../lib/billing/stripe-routes.mjs', import.meta.url), 'utf8');
  assert.match(routes, /accountId: auth\.user\.id/);
  assert.match(stripe, /form\.set\('client_reference_id', id\)/);
  assert.match(stripe, /subscription_data\[metadata\]\[accountId\]/,
    'subscription lifecycle events must retain the server-derived account reference');
});

test('checkout uses the real session token for CSRF and blocks duplicate Pro checkout', () => {
  const routes = readFileSync(new URL('../lib/billing/stripe-routes.mjs', import.meta.url), 'utf8');
  assert.match(routes, /csrfValid\(auth\.token, req\.headers\['x-csrf-token'\], secret\)/);
  assert.doesNotMatch(routes, /csrfValid\(req, secret\)/);
  assert.match(routes, /current\?\.plan\?\.id === 'pro'/);
  assert.match(routes, /SUBSCRIPTION_EXISTS/);
});

test('checkout accepts only a cadence key and never a browser-supplied Stripe price id', () => {
  const routes = readFileSync(new URL('../lib/billing/stripe-routes.mjs', import.meta.url), 'utf8');
  assert.match(routes, /normalizeStripeBillingPlan\(body\?\.plan, null\)/);
  assert.match(routes, /config\.configuredPlans\.includes\(plan\)/);
  assert.doesNotMatch(routes, /body\?\.priceId|body\.priceId/);
});

test('the frontdoor patch does not reference bindings before they exist', () => {
  const patch = readFileSync(new URL('../lib/edge/frontdoor-patch.mjs', import.meta.url), 'utf8');
  const header = JSON.parse('"' + patch.match(/let output = "(.*?)" \+ source;/s)[1] + '"');
  assert.match(header, /import \{ createStripeBillingHandler \}/, 'the handler must be imported');
  assert.ok(!/createStripeBillingHandler\(/.test(header), 'it must not be CALLED in the header, where directJson does not exist yet');
  assert.match(patch, /__stripeRoutes = __stripeRoutes \|\| createStripeBillingHandler\(/, 'build it lazily at first request');
});