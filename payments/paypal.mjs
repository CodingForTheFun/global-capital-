import crypto from 'node:crypto';

const LIVE_API = 'https://api-m.paypal.com';
const SANDBOX_API = 'https://api-m.sandbox.paypal.com';

function paypalApiBase() {
  return String(process.env.PAYPAL_ENV || 'sandbox').toLowerCase() === 'live' ? LIVE_API : SANDBOX_API;
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : null;
}

export function paypalConfig() {
  const clientId = String(process.env.PAYPAL_CLIENT_ID || '').trim();
  const secret = String(process.env.PAYPAL_CLIENT_SECRET || '').trim();
  const price = money(process.env.PAYPAL_PRICE_USD);
  const currency = String(process.env.PAYPAL_CURRENCY || 'USD').trim().toUpperCase();
  const productName = String(process.env.PAYPAL_PRODUCT_NAME || 'ObligePay Edge Access').trim();
  const environment = String(process.env.PAYPAL_ENV || 'sandbox').toLowerCase() === 'live' ? 'live' : 'sandbox';
  return {
    enabled: Boolean(clientId && secret && price),
    clientId: clientId || null,
    price,
    currency,
    productName,
    environment,
    cardFieldsRequested: String(process.env.PAYPAL_ENABLE_CARD_FIELDS ?? 'true').toLowerCase() !== 'false',
  };
}

async function accessToken() {
  const clientId = String(process.env.PAYPAL_CLIENT_ID || '').trim();
  const secret = String(process.env.PAYPAL_CLIENT_SECRET || '').trim();
  if (!clientId || !secret) throw new Error('PayPal checkout is not configured.');
  const response = await fetch(`${paypalApiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || 'PayPal authorization failed.');
  return data.access_token;
}

async function paypalRequest(pathname, options = {}) {
  const token = await accessToken();
  const response = await fetch(`${paypalApiBase()}${pathname}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'paypal-request-id': options.requestId || crypto.randomUUID(),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.details?.[0]?.description || data?.message || `PayPal request failed (${response.status}).`;
    throw new Error(detail);
  }
  return data;
}

export async function createPayPalOrder() {
  const config = paypalConfig();
  if (!config.enabled) throw new Error('PayPal checkout is not configured.');
  return paypalRequest('/v2/checkout/orders', {
    method: 'POST',
    requestId: crypto.randomUUID(),
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        description: config.productName,
        amount: { currency_code: config.currency, value: config.price },
      }],
      application_context: {
        brand_name: String(process.env.PAYPAL_BRAND_NAME || 'ObligePay Edge').slice(0, 127),
        user_action: 'PAY_NOW',
        shipping_preference: 'NO_SHIPPING',
      },
    }),
  });
}

export async function capturePayPalOrder(orderId) {
  const id = String(orderId || '').trim();
  if (!/^[A-Z0-9-]{8,40}$/i.test(id)) throw new Error('Invalid PayPal order ID.');
  return paypalRequest(`/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {
    method: 'POST',
    requestId: crypto.randomUUID(),
    body: '{}',
  });
}
