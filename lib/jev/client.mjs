// TypeSafe Jev client. Calls the System One endpoint directly with the
// server-held TYPESAFE_API_KEY (set on the Railway autoprop-live service).
//
// Jev is an enhancement, never a dependency: when the key is absent, the call
// is slow, or TypeSafe fails, callers get { ok: false } and must keep their
// existing behaviour. This function never throws, and never logs or returns
// the key or upstream error bodies.

export const TYPESAFE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const DEFAULT_MODEL = 'jev-latest';
const DEFAULT_TIMEOUT_MS = 4000;
const RETRY_STATUSES = new Set([429, 529]);

export function jevConfigured(env = process.env) {
  return Boolean(String(env.TYPESAFE_API_KEY || '').trim());
}

export async function evaluateJudgments(
  { state, questions, model } = {},
  { env = process.env, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, retries = 1, retryDelayMs = 250 } = {},
) {
  if (!jevConfigured(env)) return { ok: false, reason: 'not_configured' };
  const body = JSON.stringify({ state, model: model || DEFAULT_MODEL, questions });
  // One deadline covers every attempt, so a retry can never stretch the
  // caller's wait past timeoutMs.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await attemptEvaluate({ env, fetchImpl, body, signal: controller.signal, retries, retryDelayMs });
  } finally {
    clearTimeout(timer);
  }
}

async function attemptEvaluate({ env, fetchImpl, body, signal, retries, retryDelayMs }) {
  for (let attempt = 0; ; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(TYPESAFE_ENDPOINT, {
        method: 'POST',
        headers: { authorization: `Bearer ${String(env.TYPESAFE_API_KEY).trim()}`, 'content-type': 'application/json' },
        body,
        signal,
      });
    } catch (error) {
      const timedOut = signal.aborted || error?.name === 'AbortError';
      return { ok: false, reason: timedOut ? 'timeout' : 'unreachable' };
    }
    if (RETRY_STATUSES.has(response.status) && attempt < retries && !signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      continue;
    }
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.answers || typeof data.answers !== 'object') {
      return { ok: false, reason: 'provider_error', status: response.status };
    }
    return { ok: true, model: data.model, answers: data.answers, usage: data.usage };
  }
}
