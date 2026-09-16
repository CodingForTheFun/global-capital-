// Stripe subscription billing for Oblige Props.
//
// Deliberately written against Stripe's REST API with fetch and node:crypto
// rather than the SDK. This repository ships two production dependencies; a
// checkout session and a signature check do not justify a third, and the
// container is smaller and starts faster without it.
//
// The safety property is the same one PayPal's path already enforces: nothing
// the browser sends can grant Pro. A signed-in customer may start a checkout,
// but access changes only when this server has verified a Stripe-signed webhook
// and re-read the subscription from Stripe.
import crypto from 'node:crypto';

const text = (value) => String(value ?? '').trim();
const API = 'https://api.stripe.com/v1';

const SECRET_KEY = () => text(process.env.STRIPE_SECRET_KEY);
const WEBHOOK_SECRET = () => text(process.env.STRIPE_WEBHOOK_SECRET);
const enabledFlag = (value) => ['1', 'true', 'yes', 'on'].includes(text(value).toLowerCase());
const validPriceId = (value) => /^price_[A-Za-z0-9]+$/.test(text(value));

export const STRIPE_BILLING_PLANS = Object.freeze({
  monthly: Object.freeze({ key: 'monthly', label: 'Monthly', interval: 'month', intervalCount: 1 }),
  quarterly: Object.freeze({ key: 'quarterly', label: '3 Months', interval: 'month', intervalCount: 3 }),
  annual: Object.freeze({ key: 'annual', label: 'Annual', interval: 'year', intervalCount: 1 }),
});

const PLAN_KEYS = Object.freeze(Object.keys(STRIPE_BILLING_PLANS));

function configuredPriceIds() {
  return {
    // STRIPE_PRICE_ID remains the monthly fallback so an existing one-price
    // setup keeps working while the three-cadence launch is configured.
    monthly: text(process.env.STRIPE_PRICE_MONTHLY_ID) || text(process.env.STRIPE_PRICE_ID),
    quarterly: text(process.env.STRIPE_PRICE_QUARTERLY_ID),
    annual: text(process.env.STRIPE_PRICE_ANNUAL_ID),
  };
}

export function normalizeStripeBillingPlan(value, fallback = 'monthly') {
  const key = text(value).toLowerCase();
  if (PLAN_KEYS.includes(key)) return key;
  return fallback && PLAN_KEYS.includes(fallback) ? fallback : null;
}

export function stripePriceIdForPlan(plan = 'monthly') {
  const key = normalizeStripeBillingPlan(plan, null);
  if (!key) return null;
  const priceId = configuredPriceIds()[key];
  return validPriceId(priceId) ? priceId : null;
}

// Stripe signs `${timestamp}.${rawBody}`. Five minutes matches Stripe's own
// recommended tolerance: enough for clock skew, short enough that a captured
// delivery cannot be replayed later.
const SIGNATURE_TOLERANCE_SECONDS = 300;

export function stripeConfig() {
  const secretKey = SECRET_KEY();
  const webhookSecret = WEBHOOK_SECRET();
  const billingSwitch = enabledFlag(process.env.BILLING_ENABLED);
  const priceIds = configuredPriceIds();
  const configuredPlans = PLAN_KEYS.filter((key) => validPriceId(priceIds[key]));
  // A live key is what decides live mode, not a separate variable somebody can
  // set inconsistently with the key they pasted.
  const livemode = secretKey.startsWith('sk_live_');
  const credentialsConfigured = Boolean(secretKey && configuredPlans.length);
  const subscriptionConfigured = Boolean(credentialsConfigured && /^whsec_[A-Za-z0-9]+$/.test(webhookSecret));

  return {
    // Same two-key rule as PayPal: credentials alone can never start charging.
    // Someone has to turn BILLING_ENABLED on as a separate, deliberate act.
    enabled: Boolean(billingSwitch && subscriptionConfigured),
    billingSwitch,
    credentialsConfigured,
    subscriptionConfigured,
    launchConfigured: PLAN_KEYS.every((key) => configuredPlans.includes(key)),
    configuredPlans,
    livemode,
    environment: livemode ? 'live' : 'test',
    // Kept for backwards-compatible diagnostics; never sourced from the client.
    priceId: validPriceId(priceIds.monthly) ? priceIds.monthly : null,
    // Never the key, and never the webhook secret.
    publishableHint: secretKey ? `${secretKey.slice(0, 7)}…` : null,
  };
}

export function stripeConfigured() { return stripeConfig().subscriptionConfigured; }

async function stripeRequest(path, { method = 'GET', form = null } = {}) {
  const key = SECRET_KEY();
  if (!key) throw Object.assign(new Error('Stripe is not configured.'), { code: 'STRIPE_NOT_CONFIGURED' });

  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/x-www-form-urlencoded',
      // Without this a retried create would open a second subscription.
      ...(form?.has('__idempotency_key') ? { 'idempotency-key': form.get('__idempotency_key') } : {}),
    },
    body: form ? (() => { const copy = new URLSearchParams(form); copy.delete('__idempotency_key'); return copy; })() : undefined,
    signal: AbortSignal.timeout(15_000),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw Object.assign(new Error('Stripe request failed.'), {
      code: text(body?.error?.code) || `STRIPE_HTTP_${response.status}`,
      status: response.status,
      // Stripe error messages can name the account; only the type is kept.
      type: text(body?.error?.type) || null,
    });
  }
  return body;
}

function verifiedPriceSummary(plan, price) {
  const key = normalizeStripeBillingPlan(plan, null);
  const expected = key ? STRIPE_BILLING_PLANS[key] : null;
  const amount = Number(price?.unit_amount);
  const currency = text(price?.currency).toUpperCase();
  const interval = text(price?.recurring?.interval).toLowerCase();
  const intervalCount = Number(price?.recurring?.interval_count || 1);
  if (!expected || price?.active === false || text(price?.type).toLowerCase() !== 'recurring') return null;
  if (!Number.isInteger(amount) || amount <= 0 || !currency) return null;
  if (interval !== expected.interval || intervalCount !== expected.intervalCount) return null;
  return {
    key,
    label: expected.label,
    unitAmount: amount,
    currency,
    interval,
    intervalCount,
  };
}

/** Re-read a configured Stripe Price so the browser never supplies an amount. */
export async function getStripeBillingPlan(plan = 'monthly') {
  const key = normalizeStripeBillingPlan(plan, null);
  const priceId = stripePriceIdForPlan(key);
  if (!key || !priceId) return null;
  const price = await stripeRequest(`/prices/${encodeURIComponent(priceId)}`);
  return verifiedPriceSummary(key, price);
}

/** Public, verified price summaries for the pricing page. Price IDs stay server-side. */
export async function getStripeBillingPlans() {
  const configured = stripeConfig().configuredPlans;
  const settled = await Promise.allSettled(configured.map((key) => getStripeBillingPlan(key)));
  return settled
    .map((result) => result.status === 'fulfilled' ? result.value : null)
    .filter(Boolean);
}

/**
 * Open a hosted Checkout session.
 *
 * Hosted Checkout is what makes Apple Pay and Google Pay work without this
 * service ever touching card data or a payment sheet: Stripe renders the
 * wallet buttons when the viewer's device supports them.
 */
export async function createCheckoutSession({ accountId, email = '', plan = 'monthly', successUrl, cancelUrl, idempotencyKey = '' } = {}) {
  const id = text(accountId);
  if (!id) throw Object.assign(new Error('An account id is required.'), { code: 'STRIPE_NO_ACCOUNT' });
  const planKey = normalizeStripeBillingPlan(plan, null);
  if (!planKey) throw Object.assign(new Error('Unknown billing cadence.'), { code: 'STRIPE_PLAN_INVALID' });

  // Verify the configured price directly with Stripe before opening checkout.
  // This prevents a mistyped quarterly/annual env var from charging the wrong cadence.
  const verifiedPlan = await getStripeBillingPlan(planKey);
  const priceId = stripePriceIdForPlan(planKey);
  if (!verifiedPlan || !priceId) throw Object.assign(new Error('Stripe billing cadence is not configured.'), { code: 'STRIPE_PLAN_NOT_CONFIGURED' });

  const form = new URLSearchParams();
  form.set('mode', 'subscription');
  form.set('line_items[0][price]', priceId);
  form.set('line_items[0][quantity]', '1');
  form.set('success_url', successUrl);
  form.set('cancel_url', cancelUrl);
  // This is how a completed checkout is mapped back to an account. It is set
  // server-side from the signed session, never from the request body.
  form.set('client_reference_id', id);
  // Subscription lifecycle webhooks do not contain Checkout's client_reference_id.
  // Persist the account reference on the Stripe subscription as well so renewals,
  // cancellations and later updates can always reconcile to the correct account.
  form.set('subscription_data[metadata][accountId]', id);
  form.set('subscription_data[metadata][billingPlan]', planKey);
  if (email) form.set('customer_email', email);
  form.set('allow_promotion_codes', 'true');
  if (idempotencyKey) form.set('__idempotency_key', idempotencyKey);

  const session = await stripeRequest('/checkout/sessions', { method: 'POST', form });
  return { id: text(session?.id), url: text(session?.url), plan: planKey };
}

/** Re-read a subscription from Stripe rather than trusting a webhook payload. */
export async function getSubscription(subscriptionId) {
  const id = text(subscriptionId);
  if (!id) return null;
  return stripeRequest(`/subscriptions/${encodeURIComponent(id)}`);
}

/** Statuses that should hold Pro open. Anything else does not. */
export const ACTIVE_SUBSCRIPTION_STATUSES = Object.freeze(new Set(['active', 'trialing']));

/**
 * Verify a Stripe webhook signature.
 *
 * Returns a reason rather than throwing: an unverified delivery on a public
 * endpoint is an ordinary event, not an exception.
 */
export function verifyWebhookSignature({ header, rawBody, secret = WEBHOOK_SECRET(), now = Date.now }) {
  if (!secret) return { ok: false, reason: 'WEBHOOK_NOT_CONFIGURED' };
  const raw = text(header);
  if (!raw) return { ok: false, reason: 'MISSING_SIGNATURE' };

  const parts = Object.fromEntries(
    raw.split(',').map((piece) => piece.split('=').map((s) => s.trim())).filter((pair) => pair.length === 2),
  );
  const timestamp = Number(parts.t);
  const signature = text(parts.v1);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: 'MISSING_TIMESTAMP' };
  if (!signature) return { ok: false, reason: 'MISSING_SIGNATURE' };

  if (Math.abs(Math.floor(now() / 1000) - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'TIMESTAMP_OUT_OF_RANGE' };
  }

  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  // Length first: timingSafeEqual throws on a size mismatch, and a wrong length
  // is already a wrong signature.
  if (signature.length !== expected.length) return { ok: false, reason: 'BAD_SIGNATURE' };
  if (!crypto.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expected, 'utf8'))) {
    return { ok: false, reason: 'BAD_SIGNATURE' };
  }
  return { ok: true };
}