import crypto from 'node:crypto';

const LIVE_API = 'https://api-m.paypal.com';
const SANDBOX_API = 'https://api-m.sandbox.paypal.com';
const PLAN_CACHE_MS = 5 * 60_000;
let planCache = null;

const text = (value) => String(value ?? '').trim();
const enabledFlag = (value) => /^(?:1|true|yes|on)$/i.test(text(value));

function paypalApiBase() {
  return text(process.env.PAYPAL_ENV || 'sandbox').toLowerCase() === 'live' ? LIVE_API : SANDBOX_API;
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : null;
}

export function paypalConfig() {
  const clientId = text(process.env.PAYPAL_CLIENT_ID);
  const secret = text(process.env.PAYPAL_CLIENT_SECRET);
  const planId = text(process.env.PAYPAL_PLAN_ID);
  const webhookId = text(process.env.PAYPAL_WEBHOOK_ID);
  const legacyPrice = money(process.env.PAYPAL_PRICE_USD);
  const currency = text(process.env.PAYPAL_CURRENCY || 'USD').toUpperCase();
  const productName = text(process.env.PAYPAL_PRODUCT_NAME || 'Oblige Props Founding Pro');
  const environment = text(process.env.PAYPAL_ENV || 'sandbox').toLowerCase() === 'live' ? 'live' : 'sandbox';
  const billingSwitch = enabledFlag(process.env.BILLING_ENABLED);
  const credentialsConfigured = Boolean(clientId && secret);
  const subscriptionConfigured = Boolean(credentialsConfigured && /^P-[A-Z0-9]{24}$/i.test(planId) && /^[A-Z0-9]{6,50}$/i.test(webhookId));

  return {
    // Live/sandbox charging is intentionally impossible until the owner turns
    // on BILLING_ENABLED *and* the complete subscription verification chain is
    // configured. Merely adding credentials can never start taking money.
    enabled: Boolean(billingSwitch && subscriptionConfigured),
    billingSwitch,
    credentialsConfigured,
    subscriptionConfigured,
    clientId: clientId || null,
    planId: planId || null,
    webhookId: webhookId || null,
    legacyPrice,
    currency,
    productName,
    environment,
    mode: 'subscription',
  };
}

async function accessToken(fetcher = globalThis.fetch) {
  const clientId = text(process.env.PAYPAL_CLIENT_ID);
  const secret = text(process.env.PAYPAL_CLIENT_SECRET);
  if (!clientId || !secret) throw Object.assign(new Error('PayPal is not configured.'), { code: 'PAYPAL_NOT_CONFIGURED' });
  const response = await fetcher(`${paypalApiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw Object.assign(new Error('PayPal authorization failed.'), { code: 'PAYPAL_AUTH_FAILED', status: response.status });
  }
  return data.access_token;
}

async function paypalRequest(pathname, { requestId = null, fetcher = globalThis.fetch, headers = {}, ...options } = {}) {
  const token = await accessToken(fetcher);
  const response = await fetcher(`${paypalApiBase()}${pathname}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(requestId ? { 'paypal-request-id': requestId } : {}),
      ...headers,
    },
    signal: options.signal || AbortSignal.timeout(18_000),
  });
  const raw = await response.text().catch(() => '');
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  if (!response.ok) {
    throw Object.assign(new Error('PayPal request failed.'), {
      code: 'PAYPAL_REQUEST_FAILED',
      status: response.status,
      debugId: text(data?.debug_id).slice(0, 80) || null,
    });
  }
  return data;
}

export function summarizePayPalPlan(plan) {
  if (!plan || plan.status !== 'ACTIVE') throw Object.assign(new Error('PayPal plan is not active.'), { code: 'PAYPAL_PLAN_INACTIVE' });
  const cycle = Array.isArray(plan.billing_cycles)
    ? plan.billing_cycles.find((row) => row?.tenure_type === 'REGULAR' && row?.pricing_scheme?.fixed_price?.value)
    : null;
  const price = money(cycle?.pricing_scheme?.fixed_price?.value);
  const currency = text(cycle?.pricing_scheme?.fixed_price?.currency_code).toUpperCase();
  const intervalUnit = text(cycle?.frequency?.interval_unit).toUpperCase();
  const intervalCount = Number(cycle?.frequency?.interval_count);
  if (!price || !currency || !intervalUnit || !Number.isFinite(intervalCount) || intervalCount < 1) {
    throw Object.assign(new Error('PayPal plan pricing could not be verified.'), { code: 'PAYPAL_PLAN_UNVERIFIED' });
  }
  return {
    id: text(plan.id),
    name: text(plan.name),
    status: plan.status,
    price,
    currency,
    intervalUnit,
    intervalCount,
  };
}

export async function fetchPayPalPlan({ fetcher = globalThis.fetch, force = false } = {}) {
  const config = paypalConfig();
  if (!config.credentialsConfigured || !config.planId) throw Object.assign(new Error('PayPal subscription plan is not configured.'), { code: 'PAYPAL_NOT_CONFIGURED' });
  if (!force && planCache?.planId === config.planId && planCache.expiresAt > Date.now()) return planCache.value;
  const plan = await paypalRequest(`/v1/billing/plans/${encodeURIComponent(config.planId)}`, { method: 'GET', fetcher });
  const value = summarizePayPalPlan(plan);
  planCache = { planId: config.planId, expiresAt: Date.now() + PLAN_CACHE_MS, value };
  return value;
}

function absoluteHttps(url) {
  const value = text(url);
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (!['https:', 'http:'].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch { return null; }
}

export async function createPayPalSubscription({ accountId, email = null, returnUrl, cancelUrl, fetcher = globalThis.fetch } = {}) {
  const config = paypalConfig();
  if (!config.enabled) throw Object.assign(new Error('Billing is disabled.'), { code: 'BILLING_DISABLED' });
  const id = text(accountId);
  if (!id) throw Object.assign(new Error('Account is required.'), { code: 'BILLING_ACCOUNT_REQUIRED' });
  const approvedReturn = absoluteHttps(returnUrl);
  const approvedCancel = absoluteHttps(cancelUrl);
  if (!approvedReturn || !approvedCancel) throw Object.assign(new Error('Billing return URL is invalid.'), { code: 'BILLING_RETURN_URL_INVALID' });

  // Verify that the configured plan is still active and has fixed recurring
  // pricing before a customer can be sent to PayPal.
  await fetchPayPalPlan({ fetcher });
  const payload = {
    plan_id: config.planId,
    custom_id: id.slice(0, 127),
    application_context: {
      brand_name: text(process.env.PAYPAL_BRAND_NAME || 'Oblige Props').slice(0, 127),
      user_action: 'SUBSCRIBE_NOW',
      return_url: approvedReturn,
      cancel_url: approvedCancel,
    },
  };
  const customerEmail = text(email);
  if (customerEmail && customerEmail.length <= 254) payload.subscriber = { email_address: customerEmail };

  return paypalRequest('/v1/billing/subscriptions', {
    method: 'POST',
    requestId: crypto.randomUUID(),
    body: JSON.stringify(payload),
    fetcher,
  });
}

export function approvalUrlForSubscription(subscription) {
  const link = Array.isArray(subscription?.links) ? subscription.links.find((row) => row?.rel === 'approve' && row?.href) : null;
  return link ? text(link.href) : null;
}

export async function getPayPalSubscription(subscriptionId, { fetcher = globalThis.fetch } = {}) {
  const id = text(subscriptionId);
  if (!/^[A-Z0-9-]{8,40}$/i.test(id)) throw Object.assign(new Error('Invalid PayPal subscription ID.'), { code: 'PAYPAL_SUBSCRIPTION_ID_INVALID' });
  return paypalRequest(`/v1/billing/subscriptions/${encodeURIComponent(id)}`, { method: 'GET', fetcher });
}

function header(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()] ?? headers?.[name.toUpperCase()];
  return Array.isArray(value) ? text(value[0]) : text(value);
}

export async function verifyPayPalWebhook({ headers, event, fetcher = globalThis.fetch } = {}) {
  const config = paypalConfig();
  if (!config.subscriptionConfigured || !config.webhookId) return false;
  const body = {
    auth_algo: header(headers, 'paypal-auth-algo'),
    cert_url: header(headers, 'paypal-cert-url'),
    transmission_id: header(headers, 'paypal-transmission-id'),
    transmission_sig: header(headers, 'paypal-transmission-sig'),
    transmission_time: header(headers, 'paypal-transmission-time'),
    webhook_id: config.webhookId,
    webhook_event: event,
  };
  if (!body.auth_algo || !body.cert_url || !body.transmission_id || !body.transmission_sig || !body.transmission_time || !event) return false;
  const result = await paypalRequest('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    requestId: crypto.randomUUID(),
    body: JSON.stringify(body),
    fetcher,
  });
  return result?.verification_status === 'SUCCESS';
}

// Legacy one-time Orders v2 helpers are retained for compatibility, but the
// customer checkout no longer uses them. They also require BILLING_ENABLED, so
// old code cannot accidentally create a charge merely because credentials exist.
export async function createPayPalOrder({ accountId = null, fetcher = globalThis.fetch } = {}) {
  const config = paypalConfig();
  if (!config.billingSwitch || !config.credentialsConfigured || !config.legacyPrice) throw Object.assign(new Error('One-time PayPal checkout is disabled.'), { code: 'BILLING_DISABLED' });
  return paypalRequest('/v2/checkout/orders', {
    method: 'POST',
    requestId: crypto.randomUUID(),
    fetcher,
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        description: config.productName,
        ...(accountId ? { custom_id: text(accountId).slice(0, 255) } : {}),
        amount: { currency_code: config.currency, value: config.legacyPrice },
      }],
      application_context: {
        brand_name: text(process.env.PAYPAL_BRAND_NAME || 'Oblige Props').slice(0, 127),
        user_action: 'PAY_NOW',
        shipping_preference: 'NO_SHIPPING',
      },
    }),
  });
}

export async function capturePayPalOrder(orderId, { fetcher = globalThis.fetch } = {}) {
  const config = paypalConfig();
  if (!config.billingSwitch) throw Object.assign(new Error('Billing is disabled.'), { code: 'BILLING_DISABLED' });
  const id = text(orderId);
  if (!/^[A-Z0-9-]{8,40}$/i.test(id)) throw Object.assign(new Error('Invalid PayPal order ID.'), { code: 'PAYPAL_ORDER_ID_INVALID' });
  return paypalRequest(`/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {
    method: 'POST',
    requestId: crypto.randomUUID(),
    body: '{}',
    fetcher,
  });
}

export function resetPayPalPlanCache() {
  planCache = null;
}
