// Stripe Checkout routes for Oblige Props.
//
// Same rule the PayPal path already enforces: customer-controlled state never
// grants Pro. A signed-in user may open a checkout, but access changes only
// after a Stripe-signed webhook arrives AND this server re-reads the
// subscription from Stripe. A forged callback, a replayed URL or a hand-crafted
// POST cannot buy access.
//
// Stripe exists here for one reason PayPal cannot cover: hosted Checkout renders
// Apple Pay and Google Pay natively, which is most of this product's traffic.
import { currentAccount } from '../auth/routes.mjs';
import { csrfValid } from '../auth/session.mjs';
import { entitlementFor, grantPlan, revokePlan, publicEntitlement } from './entitlements.mjs';
import {
  stripeConfig,
  createCheckoutSession,
  getStripeBillingPlans,
  normalizeStripeBillingPlan,
  getSubscription,
  verifyWebhookSignature,
  ACTIVE_SUBSCRIPTION_STATUSES,
} from '../../payments/stripe.mjs';

const text = (value) => String(value ?? '').trim();
const SOURCE = 'stripe-subscription';

async function readRaw(req, limit = 256 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request body is too large.'), { code: 'REQUEST_INVALID' });
    chunks.push(Buffer.from(chunk));
  }
  // The signature covers the exact bytes Stripe sent, so the raw string is what
  // gets verified. Parsing and re-serialising would change what is checked.
  return Buffer.concat(chunks).toString('utf8');
}

async function readJson(req, limit = 8 * 1024) {
  const raw = await readRaw(req, limit);
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { throw Object.assign(new Error('Invalid JSON request.'), { code: 'REQUEST_INVALID' }); }
}

function sameOrigin(req) {
  const origin = text(req.headers.origin);
  if (!origin) return true;
  try {
    const host = text(req.headers['x-forwarded-host'] || req.headers.host);
    return Boolean(host) && new URL(origin).host === host;
  } catch { return false; }
}

function requestBase(req) {
  const host = text(req.headers['x-forwarded-host'] || req.headers.host).split(',')[0].trim();
  const forwarded = text(req.headers['x-forwarded-proto']).split(',')[0].trim().toLowerCase();
  const protocol = forwarded === 'http' ? 'http' : 'https';
  if (!host || /[\s/\\]/.test(host)) return null;
  return `${protocol}://${host}`;
}

let webhookState = { received: 0, accepted: 0, rejected: 0, lastEventType: null, lastEventAt: null, lastRejection: null };
export function stripeWebhookHealth() { return { ...webhookState }; }
export function __resetStripeWebhookState() {
  webhookState = { received: 0, accepted: 0, rejected: 0, lastEventType: null, lastEventAt: null, lastRejection: null };
}

/**
 * Apply a verified subscription state to an account.
 *
 * Revocation is scoped to the matching subscription reference, so a late
 * cancellation webhook for an old subscription cannot erase newer access the
 * customer has since paid for.
 */
async function applySubscription({ accountId, subscription }) {
  const id = text(accountId);
  const subscriptionId = text(subscription?.id);
  if (!id || !subscriptionId) return { changed: false, reason: 'INCOMPLETE' };

  const status = text(subscription?.status).toLowerCase();
  if (ACTIVE_SUBSCRIPTION_STATUSES.has(status)) {
    const periodEnd = Number(subscription?.current_period_end);
    await grantPlan({
      accountId: id,
      plan: 'pro',
      source: SOURCE,
      reference: subscriptionId,
      expiresAt: Number.isFinite(periodEnd) ? new Date(periodEnd * 1000).toISOString() : null,
    });
    return { changed: true, granted: true, subscriptionId };
  }

  const current = await entitlementFor(id);
  if (current?.record?.source !== SOURCE || text(current?.record?.reference) !== subscriptionId) {
    return { changed: false, reason: 'NOT_THIS_SUBSCRIPTION' };
  }
  await revokePlan({ accountId: id, source: SOURCE });
  return { changed: true, granted: false, subscriptionId };
}

export function createStripeBillingHandler({ json, sessions, secret, log = console } = {}) {
  return async function handleStripeRoutes(req, res, url) {
    const path = text(url?.pathname);
    if (!path.startsWith('/api/billing/stripe')) return false;
    const config = stripeConfig();

    if (req.method === 'GET' && path === '/api/billing/stripe/config') {
      let plans = [];
      if (config.subscriptionConfigured) {
        try { plans = await getStripeBillingPlans(); }
        catch { plans = []; }
      }
      json(res, 200, {
        ok: true,
        enabled: config.enabled,
        environment: config.environment,
        credentialsConfigured: config.credentialsConfigured,
        subscriptionConfigured: config.subscriptionConfigured,
        launchConfigured: config.launchConfigured,
        plans,
        reason: config.enabled ? null : config.billingSwitch ? 'STRIPE_NOT_CONFIGURED' : 'BILLING_DISABLED',
      });
      return true;
    }

    if (req.method === 'POST' && path === '/api/billing/stripe/checkout') {
      if (!config.enabled) { json(res, 503, { ok: false, code: 'BILLING_DISABLED' }); return true; }
      if (!sameOrigin(req)) { json(res, 403, { ok: false, code: 'BAD_ORIGIN' }); return true; }

      const auth = await currentAccount(req, sessions).catch(() => ({ user: null, token: null }));
      if (!auth?.user?.id) { json(res, 401, { ok: false, code: 'SIGN_IN_REQUIRED' }); return true; }
      if (!csrfValid(auth.token, req.headers['x-csrf-token'], secret)) {
        json(res, 403, { ok: false, code: 'CSRF_INVALID' });
        return true;
      }

      const current = await entitlementFor(auth.user.id);
      if (current?.plan?.id === 'pro') {
        json(res, 409, { ok: false, code: 'SUBSCRIPTION_EXISTS', message: 'This account already has Pro access.' });
        return true;
      }

      let body = {};
      try { body = await readJson(req); }
      catch { json(res, 400, { ok: false, code: 'REQUEST_INVALID' }); return true; }
      const plan = normalizeStripeBillingPlan(body?.plan, null);
      if (!plan || !config.configuredPlans.includes(plan)) {
        json(res, 400, { ok: false, code: 'BILLING_PLAN_INVALID' });
        return true;
      }

      const base = requestBase(req);
      if (!base) { json(res, 400, { ok: false, code: 'BAD_HOST' }); return true; }

      try {
        const session = await createCheckoutSession({
          accountId: auth.user.id,
          email: text(auth.user.email),
          plan,
          successUrl: `${base}/account?checkout=complete`,
          cancelUrl: `${base}/pricing?checkout=cancelled`,
          // A double-clicked button must not open two subscriptions. Include the
          // cadence so changing a selection does not reuse another plan's session.
          idempotencyKey: `checkout:${auth.user.id}:${plan}:${Math.floor(Date.now() / 60_000)}`,
        });
        if (!session.url) { json(res, 502, { ok: false, code: 'STRIPE_NO_CHECKOUT_URL' }); return true; }
        json(res, 200, { ok: true, url: session.url, plan });
      } catch (error) {
        log.log?.(`[Stripe checkout] failed code=${text(error?.code).slice(0, 60) || 'STRIPE_CHECKOUT_FAILED'}`);
        json(res, 502, { ok: false, code: 'STRIPE_CHECKOUT_FAILED' });
      }
      return true;
    }

    if (path === '/api/billing/stripe/webhook') {
      if (req.method !== 'POST') { json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' }); return true; }
      webhookState.received += 1;

      let rawBody = '';
      try { rawBody = await readRaw(req); }
      catch { webhookState.rejected += 1; webhookState.lastRejection = { reason: 'BODY_TOO_LARGE', at: new Date().toISOString() }; json(res, 413, { ok: false }); return true; }

      const check = verifyWebhookSignature({ header: req.headers['stripe-signature'], rawBody });
      if (!check.ok) {
        webhookState.rejected += 1;
        webhookState.lastRejection = { reason: check.reason, at: new Date().toISOString() };
        // No detail: a public endpoint should not tell a forger which part failed.
        json(res, 401, { ok: false });
        return true;
      }

      let event = null;
      try { event = JSON.parse(rawBody); } catch { event = null; }
      if (!event) { webhookState.rejected += 1; json(res, 400, { ok: false }); return true; }

      const type = text(event?.type);
      webhookState.accepted += 1;
      webhookState.lastEventType = type;
      webhookState.lastEventAt = new Date().toISOString();

      // Answer before doing the work. Stripe retries anything that is not a 2xx,
      // so a slow grant would turn one event into a queue of them.
      json(res, 200, { ok: true, received: type });

      try {
        const object = event?.data?.object || {};
        let accountId = text(object?.client_reference_id);
        const subscriptionId = text(object?.subscription || (type.startsWith('customer.subscription') ? object?.id : ''));

        if (type === 'checkout.session.completed' || type.startsWith('customer.subscription')) {
          if (!subscriptionId) return true;
          // The event is signed, but re-reading is what makes a replayed old
          // delivery harmless: Stripe is asked for the state as it is now.
          const subscription = await getSubscription(subscriptionId);
          if (!accountId) accountId = text(subscription?.metadata?.accountId);
          if (!accountId) {
            log.log?.(`[Stripe webhook] ${type} has no account reference; ignored`);
            return true;
          }
          const result = await applySubscription({ accountId, subscription });
          log.log?.(`[Stripe webhook] ${type} account=resolved changed=${Boolean(result.changed)} granted=${Boolean(result.granted)}`);
        }
      } catch (error) {
        log.log?.(`[Stripe webhook] handling failed type=${type} code=${text(error?.code).slice(0, 60) || 'STRIPE_WEBHOOK_HANDLING_FAILED'}`);
      }
      return true;
    }

    return false;
  };
}

export { publicEntitlement };