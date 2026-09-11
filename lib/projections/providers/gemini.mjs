// Gemini provider for player-prop projections.
//
// The model here is a swappable part. It supplies judgement only — a number, a
// probability, a confidence and some prose — while the arithmetic, the
// calibration against the player's own log, and every displayed figure are
// computed in code. That is what makes swapping the provider a contained
// change rather than a rewrite of the product.
//
// Plain fetch against the REST endpoint rather than a new SDK dependency: this
// repo has no build step and a deliberately small dependency list, and one
// POST does not justify adding a package to the supply chain.
//
// Verified against the current Gemini API docs (interactions endpoint,
// x-goog-api-key header, system_instruction + input + response_format, result
// at output_text) rather than written from memory — the Anthropic path had
// three settings wrong for exactly that reason.

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
// The featured stable model. GEMINI_MODEL overrides it — the pro preview is
// stronger on reasoning-heavy work and is a one-variable change.
const DEFAULT_MODEL = 'gemini-3.8-flash';

export const name = 'gemini';

export function apiKey(env = process.env) {
  return String(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '').trim();
}

export function configured(env = process.env) {
  return Boolean(apiKey(env));
}

export function model(env = process.env) {
  return String(env.GEMINI_MODEL || '').trim() || DEFAULT_MODEL;
}

/**
 * Gemini's response schema is an OpenAPI subset. It documents support for the
 * keywords this schema uses, but not for every JSON Schema keyword, so unknown
 * ones are stripped rather than sent and risked. Nothing semantic is lost: the
 * fields, their types, and which are required all survive.
 */
export function toResponseSchema(schema) {
  const ALLOWED = new Set([
    'type', 'properties', 'required', 'description', 'title', 'enum',
    'format', 'items', 'minimum', 'maximum', 'minItems', 'maxItems',
    'anyOf', 'additionalProperties', 'nullable',
  ]);
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (!ALLOWED.has(key)) continue;
      out[key] = key === 'properties'
        ? Object.fromEntries(Object.entries(value).map(([name, child]) => [name, walk(child)]))
        : walk(value);
    }
    return out;
  };
  return walk(schema);
}

/**
 * Pull the model's JSON out of the response.
 *
 * `output_text` is the documented path. The fallbacks exist because a blocked
 * or empty response is a real outcome and must be distinguishable from a
 * parsing mistake on our side — they look for text anywhere plausible, and
 * failing that we report the response as unusable rather than guessing at it.
 */
export function extractJson(body) {
  if (!body || typeof body !== 'object') return null;
  // The documented path first.
  const direct = parseCandidate(body.output_text);
  if (direct) return direct;

  // Then anywhere else it might be. The live response nests the answer under
  // `steps` — a shape the docs did not show — so rather than hard-coding one
  // more path and being wrong again, this walks the body for a string that
  // parses into the object we actually asked for. It is bounded in depth and
  // in how many strings it will try, and it accepts a result only if it
  // carries the fields this caller requires, so it cannot latch onto some
  // unrelated JSON that happens to be in the payload.
  return deepFindJson(body);
}

const ANSWER_KEYS = ['projection', 'probability_over'];
const MAX_DEPTH = 8;
const MAX_STRINGS = 200;

function parseCandidate(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > 200_000) return null;
  // Some responses fence the JSON even when asked not to.
  const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (!unfenced.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(unfenced);
    if (!parsed || typeof parsed !== 'object') return null;
    return ANSWER_KEYS.some((key) => key in parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function deepFindJson(node, depth = 0, budget = { left: MAX_STRINGS }) {
  if (depth > MAX_DEPTH || budget.left <= 0) return null;
  if (typeof node === 'string') {
    budget.left -= 1;
    return parseCandidate(node);
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = deepFindJson(item, depth + 1, budget);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== 'object') return null;
  for (const value of Object.values(node)) {
    const found = deepFindJson(value, depth + 1, budget);
    if (found) return found;
  }
  return null;
}

/**
 * The machine-readable reason and Google's own description of an error.
 *
 * Google wraps errors as `{error: {...}}`, sometimes inside an array. The
 * details array is never read — it can quote the request back.
 */
export async function errorDetail(response) {
  const body = await response.json().catch(() => null);
  const error = (Array.isArray(body) ? body[0] : body)?.error;
  if (!error) return { reason: null, message: null };
  const detail = (error.details || []).find((row) => typeof row?.reason === 'string');
  return {
    reason: detail?.reason || error.status || null,
    message: typeof error.message === 'string' ? error.message.slice(0, 160) : null,
  };
}

/** Is this the provider being busy rather than the request being wrong? */
export function busy(status, message) {
  if (status === 503) return true;
  return status >= 500 && /high demand|overloaded|try again later|temporarily/i.test(String(message || ''));
}

export async function generate({ system, payload, schema, timeoutMs = 150_000, fetchImpl = (...args) => fetch(...args) } = {}) {
  const key = apiKey();
  if (!key) return { ok: false, code: 'PROJECTION_NOT_CONFIGURED' };

  // Schema-constrained first. If the provider cannot serve that, fall back to
  // asking for JSON and letting the prompt carry the field contract — the
  // output is validated in code either way (deriveProjection rejects a
  // response without a usable projection and probability), so the fallback
  // loosens how the answer is requested, never whether it is checked.
  const attempt = await request({ key, system, payload, schema, timeoutMs, fetchImpl });
  if (attempt.ok || !attempt.retryWithoutSchema) return attempt.result;

  console.error('[projections] gemini retrying without the response schema');
  const loose = await request({ key, system, payload, schema: null, timeoutMs, fetchImpl });
  return loose.result;
}

async function request({ key, system, payload, schema, timeoutMs, fetchImpl }) {
  const body = {
    model: model(),
    system_instruction: system,
    input: JSON.stringify(payload),
    response_format: schema
      ? { type: 'text', mime_type: 'application/json', schema: toResponseSchema(schema) }
      : { type: 'text', mime_type: 'application/json' },
  };

  let response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    console.error('[projections] gemini request failed', String(error?.name || error?.message || 'unknown').slice(0, 60));
    return { ok: false, retryWithoutSchema: false, result: { ok: false, code: 'PROJECTION_PROVIDER_ERROR' } };
  }

  if (!response.ok) {
    const { reason, message } = await errorDetail(response);
    if (response.status === 401 || response.status === 403 || reason === 'API_KEY_INVALID') {
      console.error('[projections] gemini rejected the key');
      return { ok: false, retryWithoutSchema: false, result: { ok: false, code: 'PROJECTION_NOT_CONFIGURED' } };
    }
    if (response.status === 429 || reason === 'RATE_LIMIT_EXCEEDED') {
      console.error('[projections] gemini rate limited');
      return { ok: false, retryWithoutSchema: false, result: { ok: false, code: 'PROJECTION_RATE_LIMITED' } };
    }
    console.error('[projections] gemini error', String(response.status).slice(0, 4), String(reason || '-'), String(message || '-'));
    // Google answers "this model is experiencing high demand" with a 500. That
    // is capacity, not a fault in the request — it means try again shortly,
    // which is what a rate limit means, so it gets the same honest message
    // rather than a generic failure the user cannot act on.
    if (busy(response.status, message)) {
      return { ok: false, retryWithoutSchema: false, result: { ok: false, code: 'PROJECTION_RATE_LIMITED' } };
    }
    // Only a rejected request is worth re-asking without the schema. A 5xx is
    // the server failing, not the schema — retrying it there just spends a
    // second call, and quota is the scarce thing when the provider is busy.
    return {
      ok: false,
      retryWithoutSchema: Boolean(schema) && response.status >= 400 && response.status < 500,
      result: { ok: false, code: 'PROJECTION_PROVIDER_ERROR' },
    };
  }

  const parsedBody = await response.json().catch(() => null);
  const parsed = extractJson(parsedBody);
  if (!parsed) {
    // A 200 whose body we cannot read is our bug, not the provider's, and the
    // only way to fix it is to know the shape that came back. Structure only:
    // the top-level keys and a short head of the serialised body, capped. The
    // content is a projection about a public sports line, but there is no
    // reason to spill more of it into a log than it takes to see the shape.
    console.error('[projections] gemini returned no usable JSON; keys=' +
      Object.keys(parsedBody || {}).join(',').slice(0, 120) +
      ' head=' + JSON.stringify(parsedBody || null).slice(0, 400));
    return {
      ok: false,
      retryWithoutSchema: Boolean(schema),
      result: { ok: false, code: 'PROJECTION_DECLINED' },
    };
  }
  return { ok: true, retryWithoutSchema: false, result: { ok: true, parsed } };
}
