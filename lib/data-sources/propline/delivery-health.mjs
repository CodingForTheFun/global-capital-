import { PROPLINE_BASE, proplineConfigured } from './client.mjs';
import { proplineRealtimeHealth } from './realtime.mjs';

const text = (value) => String(value ?? '').trim();
const num = (value) => { const n = Number(value); return Number.isFinite(n) ? n : null; };
const API_KEY = () => text(process.env.PROPLINE_API_KEY);
const state = {
  checking: false,
  lastCheckedAt: null,
  lastSuccessAt: null,
  lastError: null,
  subscriptionId: null,
  deliveries: 0,
  successful: 0,
  failed: 0,
  maxAttempts: 0,
  lastDeliveryAt: null,
  lastStatus: null,
  lastHttpStatus: null,
};

function rowsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.deliveries)) return payload.deliveries;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}
function deliveryTime(row) { return text(row?.created_at || row?.sent_at || row?.delivered_at || row?.updated_at) || null; }
function httpStatus(row) { return num(row?.http_status ?? row?.response_status ?? row?.status_code ?? row?.http_code); }
function attempts(row) { return num(row?.attempt_count ?? row?.attempts ?? row?.try_count) || 0; }
function succeeded(row) {
  const code = httpStatus(row), status = text(row?.status).toLowerCase();
  if (code !== null) return code >= 200 && code < 300;
  return ['delivered','success','succeeded','ok'].includes(status);
}

export async function refreshProplineDeliveryHealth({ subscriptionId = null, fetcher = globalThis.fetch } = {}) {
  if (state.checking) return proplineDeliveryHealth();
  state.checking = true;
  state.lastCheckedAt = new Date().toISOString();
  try {
    if (!proplineConfigured() || !API_KEY()) throw Object.assign(new Error('PropLine is not configured.'), { code: 'PROPLINE_NOT_CONFIGURED' });
    const id = subscriptionId ?? proplineRealtimeHealth().subscriptionId;
    if (id === null || id === undefined || text(id) === '') throw Object.assign(new Error('PropLine webhook subscription is not ready.'), { code: 'PROPLINE_WEBHOOK_NOT_READY' });
    const url = `${PROPLINE_BASE}/v1/webhooks/${encodeURIComponent(id)}/deliveries?limit=50`;
    const response = await fetcher(url, {
      headers: { accept: 'application/json', 'x-api-key': API_KEY() },
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(new Error('PropLine delivery-health request failed.'), { code: `PROPLINE_DELIVERIES_HTTP_${response.status}`, status: response.status });
    const rows = rowsFrom(payload).slice(0, 50);
    const successful = rows.filter(succeeded).length;
    const last = rows[0] || null;
    state.subscriptionId = String(id);
    state.deliveries = rows.length;
    state.successful = successful;
    state.failed = rows.length - successful;
    state.maxAttempts = rows.reduce((max, row) => Math.max(max, attempts(row)), 0);
    state.lastDeliveryAt = last ? deliveryTime(last) : null;
    state.lastStatus = last ? text(last?.status) || null : null;
    state.lastHttpStatus = last ? httpStatus(last) : null;
    state.lastSuccessAt = new Date().toISOString();
    state.lastError = null;
    return proplineDeliveryHealth();
  } catch (error) {
    state.lastError = text(error?.code || error?.name || 'PROPLINE_DELIVERY_HEALTH_FAILED');
    return proplineDeliveryHealth();
  } finally {
    state.checking = false;
  }
}

export function proplineDeliveryHealth() {
  return { ...state, configured: proplineConfigured(), healthy: state.lastError === null && state.failed === 0 };
}

export function startProplineDeliveryHealthMonitor() {
  const run = () => { void refreshProplineDeliveryHealth(); };
  const first = setTimeout(run, 5_000); first.unref?.();
  const timer = setInterval(run, 5 * 60_000); timer.unref?.();
  return timer;
}

export function __resetProplineDeliveryHealth() {
  Object.assign(state, {
    checking: false, lastCheckedAt: null, lastSuccessAt: null, lastError: null,
    subscriptionId: null, deliveries: 0, successful: 0, failed: 0, maxAttempts: 0,
    lastDeliveryAt: null, lastStatus: null, lastHttpStatus: null,
  });
}
