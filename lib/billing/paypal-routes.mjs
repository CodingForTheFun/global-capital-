// Verified recurring billing routes for Oblige Props.
//
// Customer-controlled state never grants Pro. A signed-in user may start a
// PayPal subscription, but access changes only after this server re-reads an
// ACTIVE subscription from PayPal or receives a cryptographically verified
// lifecycle webhook. Cancellation/suspension/expiry only revoke the matching
// processor-managed subscription, so an old webhook cannot erase newer access.

import { currentAccount } from '../auth/routes.mjs';
import { csrfValid } from '../auth/session.mjs';
import { entitlementFor, grantPlan, revokePlan, publicEntitlement } from './entitlements.mjs';
import {
  paypalConfig,
  fetchPayPalPlan,
  createPayPalSubscription,
  approvalUrlForSubscription,
  getPayPalSubscription,
  verifyPayPalWebhook,
} from '../../payments/paypal.mjs';

const text = (value) => String(value ?? '').trim();

async function readBody(req, limit = 256 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request body is too large.'), { code: 'REQUEST_INVALID' });
    chunks.push(Buffer.from(chunk));
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
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
  const forwardedProto = text(req.headers['x-forwarded-proto']).split(',')[0].trim().toLowerCase();
  const protocol = forwardedProto === 'https' ? 'https' : forwardedProto === 'http' ? 'http' : 'https';
  if (!host || /[\s/\\]/.test(host)) return null;
  return `${protocol}://${host}`;
}

function processorSubscription(entitlement) {
  return entitlement?.plan?.id === 'pro' && entitlement?.record?.source === 'paypal-subscription' && Boolean(entitlement?.record?.reference);
}

function publicConfigBase(config, extra = {}) {
  return {
    enabled: Boolean(config.enabled),
    mode: 'subscription',
    productName: config.productName,
    environment: config.environment,
    ...extra,
  };
}

async function requireMember(req, sessions, json, res) {
  const auth = await currentAccount(req, sessions).catch(() => ({ user: null, token: null }));
  if (!auth.user) {
    json(res, 401, { ok: false, code: 'AUTH_REQUIRED', message: 'Sign in before starting billing.' });
    return null;
  }
  return auth;
}

function csrfAllowed(req, auth, secret, json, res) {
  if (!sameOrigin(req)) {
    json(res, 403, { ok: false, code: 'ORIGIN_INVALID', message: 'Cross-origin billing request rejected.' });
    return false;
  }
  if (!csrfValid(auth.token, req.headers['x-csrf-token'], secret)) {
    json(res, 403, { ok: false, code: 'CSRF_INVALID', message: 'Your session expired. Reload and try again.' });
    return false;
  }
  return true;
}

async function canonicalSubscription(resource, paypal) {
  const initial = resource && typeof resource === 'object' ? resource : {};
  const id = text(initial.id || initial.billing_agreement_id);
  if (!id) return null;
  if (initial.custom_id && initial.plan_id && initial.status) return initial;
  try { return await paypal.getPayPalSubscription(id); }
  catch { return null; }
}

async function grantVerifiedSubscription(subscription, { paypal, planId }) {
  const row = await canonicalSubscription(subscription, paypal);
  if (!row) return { ok: false, code: 'SUBSCRIPTION_UNVERIFIED' };
  const accountId = text(row.custom_id);
  const subscriptionId = text(row.id);
  if (!accountId || text(row.plan_id) !== planId || text(row.status).toUpperCase() !== 'ACTIVE') {
    return { ok: false, code: 'SUBSCRIPTION_UNVERIFIED' };
  }
  await grantPlan({
    accountId,
    plan: 'pro',
    expiresAt: null,
    source: 'paypal-subscription',
    reference: subscriptionId,
  });
  return { ok: true, accountId, subscriptionId };
}

async function revokeVerifiedSubscription(subscription, { paypal, planId }) {
  const row = await canonicalSubscription(subscription, paypal);
  if (!row) return { ok: false, code: 'SUBSCRIPTION_UNVERIFIED' };
  const accountId = text(row.custom_id);
  const subscriptionId = text(row.id);
  if (!accountId || text(row.plan_id) !== planId) return { ok: false, code: 'SUBSCRIPTION_UNVERIFIED' };
  const current = await entitlementFor(accountId);
  // A stale cancellation must never revoke a newer paid subscription or an
  // owner-granted access record that replaced this one.
  if (current?.record?.source !== 'paypal-subscription' || text(current?.record?.reference) !== subscriptionId) {
    return { ok: true, accountId, subscriptionId, unchanged: true };
  }
  await revokePlan({ accountId, source: 'paypal-subscription' });
  return { ok: true, accountId, subscriptionId, unchanged: false };
}

export function createPayPalBillingHandler(overrides = {}) {
  const paypal = {
    paypalConfig,
    fetchPayPalPlan,
    createPayPalSubscription,
    approvalUrlForSubscription,
    getPayPalSubscription,
    verifyPayPalWebhook,
    ...overrides.paypal,
  };

  return async function handleBillingRoutes(req, res, url, { sessions, json, secret, log = console }) {
    const path = url.pathname;
    if (!path.startsWith('/api/payments/')) return false;

    try {
      const config = paypal.paypalConfig();

      if (path === '/api/payments/config' && req.method === 'GET') {
        if (!config.enabled) {
          json(res, 200, { ok: true, ...publicConfigBase(config, { reason: config.billingSwitch ? 'SUBSCRIPTION_NOT_CONFIGURED' : 'BILLING_DISABLED' }) });
          return true;
        }
        try {
          const plan = await paypal.fetchPayPalPlan();
          json(res, 200, {
            ok: true,
            ...publicConfigBase(config, {
              planId: config.planId,
              price: plan.price,
              currency: plan.currency,
              intervalUnit: plan.intervalUnit,
              intervalCount: plan.intervalCount,
            }),
          });
        } catch (error) {
          log?.error?.('[billing] PayPal plan verification failed', text(error?.code || 'PAYPAL_PLAN_UNVERIFIED'));
          json(res, 200, { ok: true, ...publicConfigBase({ ...config, enabled: false }, { reason: 'PLAN_UNVERIFIED' }) });
        }
        return true;
      }

      // Retire the old one-time endpoints explicitly. They must not silently
      // remain chargeable after the product moves to recurring subscriptions.
      if (path === '/api/payments/create-order' || path === '/api/payments/capture-order') {
        json(res, 410, { ok: false, code: 'ONE_TIME_CHECKOUT_RETIRED', message: 'This checkout has moved to verified recurring subscriptions.' });
        return true;
      }

      if (path === '/api/payments/create-subscription') {
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' }, { allow: 'POST' });
          return true;
        }
        if (!config.enabled) {
          json(res, 503, { ok: false, code: 'BILLING_DISABLED', message: 'Founding Pro billing is not open yet.' });
          return true;
        }
        const auth = await requireMember(req, sessions, json, res);
        if (!auth || !csrfAllowed(req, auth, secret, json, res)) return true;
        const current = await entitlementFor(auth.user.id);
        if (processorSubscription(current)) {
          json(res, 409, { ok: false, code: 'SUBSCRIPTION_EXISTS', message: 'This account already has an active paid Pro subscription.' });
          return true;
        }
        const base = requestBase(req);
        if (!base) {
          json(res, 400, { ok: false, code: 'BILLING_HOST_INVALID', message: 'Checkout could not determine a safe return address.' });
          return true;
        }
        const subscription = await paypal.createPayPalSubscription({
          accountId: auth.user.id,
          email: auth.user.email,
          returnUrl: `${base}/checkout?billing=return`,
          cancelUrl: `${base}/checkout?billing=cancel`,
        });
        const approvalUrl = paypal.approvalUrlForSubscription(subscription);
        if (!subscription?.id || !approvalUrl) throw Object.assign(new Error('PayPal approval link missing.'), { code: 'PAYPAL_APPROVAL_MISSING' });
        json(res, 200, { ok: true, subscriptionId: subscription.id, approvalUrl });
        return true;
      }

      if (path === '/api/payments/confirm-subscription') {
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' }, { allow: 'POST' });
          return true;
        }
        if (!config.subscriptionConfigured) {
          json(res, 503, { ok: false, code: 'BILLING_DISABLED', message: 'Subscription verification is not configured.' });
          return true;
        }
        const auth = await requireMember(req, sessions, json, res);
        if (!auth || !csrfAllowed(req, auth, secret, json, res)) return true;
        const body = await readBody(req, 8_000);
        const subscription = await paypal.getPayPalSubscription(body.subscriptionId);
        if (text(subscription?.custom_id) !== auth.user.id || text(subscription?.plan_id) !== config.planId) {
          json(res, 403, { ok: false, code: 'SUBSCRIPTION_MISMATCH', message: 'That subscription does not belong to this account.' });
          return true;
        }
        if (text(subscription?.status).toUpperCase() !== 'ACTIVE') {
          json(res, 409, { ok: false, code: 'SUBSCRIPTION_NOT_ACTIVE', message: 'PayPal has not activated this subscription yet.' });
          return true;
        }
        const granted = await grantVerifiedSubscription(subscription, { paypal, planId: config.planId });
        if (!granted.ok) throw Object.assign(new Error('Subscription could not be verified.'), { code: granted.code });
        const access = publicEntitlement(await entitlementFor(auth.user.id));
        log?.log?.(`[billing] PayPal subscription activated for account ${auth.user.id}`);
        json(res, 200, { ok: true, entitlement: access, subscriptionId: granted.subscriptionId });
        return true;
      }

      if (path === '/api/payments/webhook') {
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' }, { allow: 'POST' });
          return true;
        }
        if (!config.subscriptionConfigured) {
          json(res, 503, { ok: false, code: 'WEBHOOK_NOT_CONFIGURED', message: 'Billing webhook verification is not configured.' });
          return true;
        }
        const event = await readBody(req);
        const verified = await paypal.verifyPayPalWebhook({ headers: req.headers, event });
        if (!verified) {
          log?.warn?.('[billing] rejected unverified PayPal webhook');
          json(res, 400, { ok: false, code: 'WEBHOOK_SIGNATURE_INVALID', message: 'Webhook signature could not be verified.' });
          return true;
        }

        const type = text(event?.event_type).toUpperCase();
        const resource = event?.resource || {};
        let result = { ok: true, ignored: true };
        if (type === 'BILLING.SUBSCRIPTION.ACTIVATED') {
          result = await grantVerifiedSubscription(resource, { paypal, planId: config.planId });
        } else if (type === 'BILLING.SUBSCRIPTION.UPDATED') {
          const status = text(resource?.status).toUpperCase();
          if (status === 'ACTIVE') result = await grantVerifiedSubscription(resource, { paypal, planId: config.planId });
          else if (['CANCELLED', 'SUSPENDED', 'EXPIRED'].includes(status)) result = await revokeVerifiedSubscription(resource, { paypal, planId: config.planId });
        } else if (['BILLING.SUBSCRIPTION.CANCELLED', 'BILLING.SUBSCRIPTION.SUSPENDED', 'BILLING.SUBSCRIPTION.EXPIRED'].includes(type)) {
          result = await revokeVerifiedSubscription(resource, { paypal, planId: config.planId });
        }

        if (!result.ok && !result.ignored) {
          log?.error?.('[billing] verified PayPal webhook could not be reconciled', type, text(event?.id).slice(0, 80));
          json(res, 422, { ok: false, code: result.code || 'WEBHOOK_RECONCILIATION_FAILED', message: 'Verified billing event could not be reconciled.' });
          return true;
        }
        log?.log?.(`[billing] verified PayPal webhook ${type || 'UNKNOWN'} ${text(event?.id).slice(0, 80)}`);
        json(res, 200, { ok: true });
        return true;
      }

      json(res, 404, { ok: false, code: 'NOT_FOUND', message: 'Unknown billing route.' });
      return true;
    } catch (error) {
      log?.error?.('[billing] request failed', text(error?.code || error?.message || 'BILLING_ERROR').slice(0, 120));
      const badRequest = error?.code === 'REQUEST_INVALID';
      json(res, badRequest ? 400 : 502, {
        ok: false,
        code: badRequest ? 'REQUEST_INVALID' : 'BILLING_UNAVAILABLE',
        message: badRequest ? 'That billing request could not be processed.' : 'Billing is temporarily unavailable. No access change was made.',
      });
      return true;
    }
  };
}

export const handleBillingRoutes = createPayPalBillingHandler();
