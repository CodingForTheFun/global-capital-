// Anthropic provider for player-prop projections.
//
// The request shape here is verified against @anthropic-ai/sdk 0.125.0:
// messages.parse for structured output, effort nested inside output_config,
// no temperature and no thinking budget (both rejected on this model family),
// and an exact model id with no date suffix.

import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';

const DEFAULT_MODEL = 'claude-opus-5';
// Thinking tokens count against this and adaptive thinking is on by default,
// so it has to leave room for four written sections as well as the numbers.
const MAX_TOKENS = 16000;

export const name = 'anthropic';

let client = null;

export function configured(env = process.env) {
  return Boolean(String(env.ANTHROPIC_API_KEY || '').trim());
}

export function model(env = process.env) {
  return String(env.PROJECTION_MODEL || '').trim() || DEFAULT_MODEL;
}

export function effort(env = process.env) {
  const requested = String(env.PROJECTION_EFFORT || '').trim();
  return ['low', 'medium', 'high', 'xhigh', 'max'].includes(requested) ? requested : 'high';
}

function getClient(timeoutMs) {
  if (!client) client = new Anthropic({ maxRetries: 1, timeout: timeoutMs });
  return client;
}

/** Test seam: drop the memoised client so a new timeout or key is picked up. */
export function resetClient() { client = null; }

/**
 * @returns {Promise<{ok: true, parsed: object} | {ok: false, code: string}>}
 */
export async function generate({ system, payload, schema, timeoutMs = 150_000 } = {}) {
  let response;
  try {
    response = await getClient(timeoutMs).messages.parse({
      model: model(),
      max_tokens: MAX_TOKENS,
      // The prompt is identical on every request and is the largest stable
      // block, so caching it turns most of the input cost into a cache read.
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: effort(), format: jsonSchemaOutputFormat(schema) },
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    });
  } catch (error) {
    // Typed, most specific first. Nothing from the provider reaches a customer.
    if (error instanceof Anthropic.AuthenticationError) {
      console.error('[projections] authentication rejected');
      return { ok: false, code: 'PROJECTION_NOT_CONFIGURED' };
    }
    if (error instanceof Anthropic.RateLimitError) {
      console.error('[projections] rate limited by the provider');
      return { ok: false, code: 'PROJECTION_RATE_LIMITED' };
    }
    if (error instanceof Anthropic.APIError) {
      console.error('[projections] provider error', String(error.status || '').slice(0, 8));
      return { ok: false, code: 'PROJECTION_PROVIDER_ERROR' };
    }
    console.error('[projections] request failed', String(error?.message || 'unknown').slice(0, 120));
    return { ok: false, code: 'PROJECTION_PROVIDER_ERROR' };
  }

  // A safety decline is a real outcome on this model family and arrives as a
  // 200. Check it before reading content.
  if (response?.stop_reason === 'refusal') {
    console.error('[projections] request declined', String(response?.stop_details?.category || 'unspecified').slice(0, 40));
    return { ok: false, code: 'PROJECTION_DECLINED' };
  }
  if (response?.stop_reason === 'max_tokens') return { ok: false, code: 'PROJECTION_TRUNCATED' };

  const parsed = response?.parsed_output;
  if (!parsed) return { ok: false, code: 'PROJECTION_UNPARSEABLE' };
  return { ok: true, parsed };
}
