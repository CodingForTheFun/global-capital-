// Railway-side client for the Jev gateway on Vercel (services/jev-gateway).
//
// The TypeSafe key lives only on Vercel. This service holds the gateway URL and
// a shared secret. Jev is an enhancement, never a dependency: when the gateway
// is not configured, slow or failing, callers get { ok: false } and must fall
// back to their existing deterministic behaviour. This function never throws.

const DEFAULT_TIMEOUT_MS = 8000;

export function jevGatewayConfigured(env = process.env) {
  return Boolean(env.JEV_GATEWAY_URL && env.JEV_GATEWAY_SECRET);
}

export async function evaluateJudgments(
  { state, questions, model } = {},
  { env = process.env, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!jevGatewayConfigured(env)) return { ok: false, reason: 'not_configured' };
  const url = `${String(env.JEV_GATEWAY_URL).replace(/\/+$/, '')}/api/evaluate`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.JEV_GATEWAY_SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({ state, questions, ...(model ? { model } : {}) }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.answers) {
      return { ok: false, reason: 'gateway_error', status: response.status, error: data?.error || null };
    }
    return { ok: true, model: data.model, answers: data.answers, usage: data.usage };
  } catch (error) {
    return { ok: false, reason: error?.name === 'AbortError' ? 'timeout' : 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}
