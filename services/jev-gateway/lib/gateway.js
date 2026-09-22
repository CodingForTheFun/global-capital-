// Jev gateway core. Holds the TypeSafe key on Vercel (injected by the TypeSafe
// integration as TYPESAFE_API_KEY) so the Railway service never carries it.
//
// The gateway is deliberately thin: it authenticates the caller with a shared
// secret, validates the request shape, forwards it to the TypeSafe System One
// endpoint and retries only on 429/529. It never echoes upstream error bodies
// or the key back to the caller.
//
// Kept framework-free (plain values in, { status, body } out) so it can be
// unit-tested from the main repo without a Vercel runtime.

import { timingSafeEqual } from 'node:crypto';

export const TYPESAFE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const DEFAULT_MODEL = 'jev-latest';
export const MAX_QUESTIONS = 32;
export const MAX_BODY_BYTES = 256 * 1024;
const QUESTION_TYPES = new Set(['noul', 'choice', 'score']);
const RETRY_STATUSES = new Set([429, 529]);

function secretsMatch(provided, expected) {
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(String(expected || ''));
  if (!b.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function bearer(headers) {
  const raw = headers?.authorization || headers?.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(String(raw).trim());
  return match ? match[1] : '';
}

export function validateRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Body must be a JSON object.';
  if (body.state === undefined || body.state === null || body.state === '') return '`state` is required.';
  if (body.model !== undefined && typeof body.model !== 'string') return '`model` must be a string.';
  const { questions } = body;
  if (!questions || typeof questions !== 'object' || Array.isArray(questions)) return '`questions` must be an object map.';
  const ids = Object.keys(questions);
  if (!ids.length) return '`questions` must not be empty.';
  if (ids.length > MAX_QUESTIONS) return `At most ${MAX_QUESTIONS} questions per request.`;
  for (const id of ids) {
    const q = questions[id];
    if (!q || typeof q !== 'object') return `Question \`${id}\` must be an object.`;
    if (!QUESTION_TYPES.has(q.type)) return `Question \`${id}\` has unsupported type.`;
    if (q.instructions === undefined || q.instructions === null || q.instructions === '') return `Question \`${id}\` needs instructions.`;
    if (q.type !== 'noul' && !q.criteria) return `Question \`${id}\` needs criteria.`;
  }
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function handleEvaluate(
  { method, headers, body },
  { env = process.env, fetchImpl = fetch, retries = 3, baseDelayMs = 400 } = {},
) {
  if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed.' } };
  if (!env.JEV_GATEWAY_SECRET) return { status: 503, body: { error: 'Gateway secret not configured.' } };
  if (!secretsMatch(bearer(headers), env.JEV_GATEWAY_SECRET)) return { status: 401, body: { error: 'Unauthorized.' } };
  if (!env.TYPESAFE_API_KEY) return { status: 503, body: { error: 'TypeSafe key not configured.' } };

  let parsed = body;
  if (typeof body === 'string') {
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) return { status: 413, body: { error: 'Request too large.' } };
    try { parsed = JSON.parse(body); } catch { return { status: 400, body: { error: 'Invalid JSON.' } }; }
  } else if (Buffer.byteLength(JSON.stringify(body ?? null)) > MAX_BODY_BYTES) {
    return { status: 413, body: { error: 'Request too large.' } };
  }
  const invalid = validateRequest(parsed);
  if (invalid) return { status: 422, body: { error: invalid } };

  const payload = JSON.stringify({
    state: parsed.state,
    model: parsed.model || DEFAULT_MODEL,
    questions: parsed.questions,
  });

  for (let attempt = 0; ; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(TYPESAFE_ENDPOINT, {
        method: 'POST',
        headers: { authorization: `Bearer ${env.TYPESAFE_API_KEY}`, 'content-type': 'application/json' },
        body: payload,
      });
    } catch {
      if (attempt < retries) { await sleep(baseDelayMs * 2 ** attempt); continue; }
      return { status: 502, body: { error: 'TypeSafe unreachable.' } };
    }
    if (RETRY_STATUSES.has(response.status) && attempt < retries) {
      await sleep(baseDelayMs * 2 ** attempt);
      continue;
    }
    if (!response.ok) {
      // Pass 422 validation detail through (it describes the caller's request,
      // not our credentials); collapse everything else.
      if (response.status === 422) {
        const detail = await response.json().catch(() => null);
        return { status: 422, body: { error: 'TypeSafe rejected the request.', detail } };
      }
      const status = RETRY_STATUSES.has(response.status) ? 503 : 502;
      return { status, body: { error: `TypeSafe returned ${response.status}.` } };
    }
    const data = await response.json().catch(() => null);
    if (!data || typeof data.answers !== 'object') return { status: 502, body: { error: 'TypeSafe returned an unreadable response.' } };
    return { status: 200, body: { model: data.model, answers: data.answers, usage: data.usage } };
  }
}

export function handleHealth({ env = process.env } = {}) {
  return {
    status: 200,
    body: {
      ok: true,
      service: 'jev-gateway',
      typesafeKeyConfigured: Boolean(env.TYPESAFE_API_KEY),
      gatewaySecretConfigured: Boolean(env.JEV_GATEWAY_SECRET),
    },
  };
}
