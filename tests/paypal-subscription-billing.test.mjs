import assert from 'node:assert/strict';
import test from 'node:test';
import {
  paypalConfig,
  summarizePayPalPlan,
  fetchPayPalPlan,
  createPayPalSubscription,
  approvalUrlForSubscription,
  verifyPayPalWebhook,
  resetPayPalPlanCache,
} from '../payments/paypal.mjs';
import { createPayPalBillingHandler } from '../lib/billing/paypal-routes.mjs';

const PLAN_ID = `P-${'A'.repeat(24)}`;
const WEBHOOK_ID = 'WEBHOOK123456';

function response(body, status = 200) {
  const raw = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => raw,
  };
}

async function withBillingEnv(values, fn) {
  const keys = ['BILLING_ENABLED','PAYPAL_ENV','PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET','PAYPAL_PLAN_ID','PAYPAL_WEBHOOK_ID','PAYPAL_PRODUCT_NAME','PAYPAL_BRAND_NAME'];
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, values);
    resetPayPalPlanCache();
    return await fn();
  } finally {
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
    resetPayPalPlanCache();
  }
}

function activePlan() {
  return {
    id: PLAN_ID,
    name: 'Oblige Props Founding Pro',
    status: 'ACTIVE',
    billing_cycles: [{
      tenure_type: 'REGULAR',
      pricing_scheme: { fixed_price: { value: '19.99', currency_code: 'USD' } },
      frequency: { interval_unit: 'MONTH', interval_count: 1 },
    }],
  };
}

test('billing is fail-closed until the explicit switch, plan and webhook are configured', async () => {
  await withBillingEnv({
    PAYPAL_CLIENT_ID: 'client', PAYPAL_CLIENT_SECRET: 'secret', PAYPAL_PLAN_ID: PLAN_ID, PAYPAL_WEBHOOK_ID: WEBHOOK_ID,
  }, async () => {
    assert.equal(paypalConfig().enabled, false);
    process.env.BILLING_ENABLED = 'true';
    assert.equal(paypalConfig().enabled, true);
    delete process.env.PAYPAL_WEBHOOK_ID;
    assert.equal(paypalConfig().enabled, false);
  });
});

test('active recurring plan pricing is derived from PayPal rather than trusted from the browser', () => {
  assert.deepEqual(summarizePayPalPlan(activePlan()), {
    id: PLAN_ID,
    name: 'Oblige Props Founding Pro',
    status: 'ACTIVE',
    price: '19.99',
    currency: 'USD',
    intervalUnit: 'MONTH',
    intervalCount: 1,
  });
  assert.throws(() => summarizePayPalPlan({ ...activePlan(), status: 'INACTIVE' }), /not active/i);
});

test('subscription creation binds the signed-in account id and uses a server-verified active plan', async () => {
  await withBillingEnv({
    BILLING_ENABLED: 'true', PAYPAL_ENV: 'sandbox', PAYPAL_CLIENT_ID: 'client', PAYPAL_CLIENT_SECRET: 'secret',
    PAYPAL_PLAN_ID: PLAN_ID, PAYPAL_WEBHOOK_ID: WEBHOOK_ID, PAYPAL_BRAND_NAME: 'Oblige Props',
  }, async () => {
    const calls = [];
    const fetcher = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith('/v1/oauth2/token')) return response({ access_token: 'token' });
      if (String(url).includes(`/v1/billing/plans/${PLAN_ID}`)) return response(activePlan());
      if (String(url).endsWith('/v1/billing/subscriptions')) return response({
        id: 'I-SUBSCRIPTION123', status: 'APPROVAL_PENDING',
        links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/checkoutnow?token=I-SUBSCRIPTION123' }],
      });
      return response({}, 404);
    };
    const created = await createPayPalSubscription({
      accountId: 'user-123', email: 'member@example.com',
      returnUrl: 'https://example.com/checkout?billing=return',
      cancelUrl: 'https://example.com/checkout?billing=cancel', fetcher,
    });
    assert.equal(created.id, 'I-SUBSCRIPTION123');
    assert.match(approvalUrlForSubscription(created), /^https:\/\/www\.sandbox\.paypal\.com\//);
    const createCall = calls.find((row) => row.url.endsWith('/v1/billing/subscriptions'));
    const body = JSON.parse(createCall.options.body);
    assert.equal(body.plan_id, PLAN_ID);
    assert.equal(body.custom_id, 'user-123');
    assert.equal(body.subscriber.email_address, 'member@example.com');
    assert.equal(body.application_context.brand_name, 'Oblige Props');
  });
});

test('webhook verification sends PayPal transmission headers and the configured webhook id to PayPal', async () => {
  await withBillingEnv({
    BILLING_ENABLED: 'false', PAYPAL_ENV: 'sandbox', PAYPAL_CLIENT_ID: 'client', PAYPAL_CLIENT_SECRET: 'secret',
    PAYPAL_PLAN_ID: PLAN_ID, PAYPAL_WEBHOOK_ID: WEBHOOK_ID,
  }, async () => {
    let verificationBody = null;
    const fetcher = async (url, options = {}) => {
      if (String(url).endsWith('/v1/oauth2/token')) return response({ access_token: 'token' });
      if (String(url).endsWith('/v1/notifications/verify-webhook-signature')) {
        verificationBody = JSON.parse(options.body);
        return response({ verification_status: 'SUCCESS' });
      }
      return response({}, 404);
    };
    const event = { id: 'WH-1', event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: { id: 'I-1' } };
    const verified = await verifyPayPalWebhook({
      fetcher,
      headers: {
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-cert-url': 'https://api-m.sandbox.paypal.com/certs/cert.pem',
        'paypal-transmission-id': 'abc-123',
        'paypal-transmission-sig': 'signature',
        'paypal-transmission-time': '2026-09-13T20:00:00Z',
      },
      event,
    });
    assert.equal(verified, true);
    assert.equal(verificationBody.webhook_id, WEBHOOK_ID);
    assert.deepEqual(verificationBody.webhook_event, event);
  });
});

test('public billing config fails closed if the configured PayPal plan cannot be verified', async () => {
  const handler = createPayPalBillingHandler({
    paypal: {
      paypalConfig: () => ({ enabled: true, billingSwitch: true, subscriptionConfigured: true, productName: 'Oblige Props Founding Pro', environment: 'live', planId: PLAN_ID }),
      fetchPayPalPlan: async () => { throw Object.assign(new Error('down'), { code: 'PAYPAL_PLAN_UNVERIFIED' }); },
    },
  });
  const out = {};
  const req = { method: 'GET', headers: {} };
  const res = {};
  const json = (_res, status, body) => { out.status = status; out.body = body; };
  const handled = await handler(req, res, new URL('https://example.com/api/payments/config'), { sessions: {}, json, secret: 'secret', log: { error() {} } });
  assert.equal(handled, true);
  assert.equal(out.status, 200);
  assert.equal(out.body.enabled, false);
  assert.equal(out.body.reason, 'PLAN_UNVERIFIED');
});
