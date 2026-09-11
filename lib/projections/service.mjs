// Player-prop projection service.
//
// Sends one game-context payload to Claude and returns a structured projection.
// Three things this deliberately does NOT do:
//
//   • It does not run without ANTHROPIC_API_KEY. No key means the feature is
//     dormant and every call reports it as unavailable — it never degrades into
//     a guess, and it never starts spending money because a key appeared by
//     accident somewhere else in the environment.
//   • It does not write into the measured research payload. A projection is a
//     model estimate and is labelled as one everywhere it surfaces, because the
//     project's contract is that a displayed statistic was actually observed.
//   • It does not do its own arithmetic. Edge, expected value and the pick
//     label are derived in `schema.mjs` from the model's probability and the
//     real price, so they are reproducible.

import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { PROJECTION_OUTPUT_SCHEMA, deriveProjection } from './schema.mjs';
import { projectionSystemPrompt, projectionPromptSource } from './system-prompt.mjs';

const MODEL = process.env.PROJECTION_MODEL || 'claude-opus-5';
const MAX_TOKENS = 4096;
const CACHE_TTL_MS = 10 * 60_000;
const MAX_CACHE_ENTRIES = 500;
const REQUEST_TIMEOUT_MS = 45_000;

const cache = new Map();
const inflight = new Map();
let client = null;

export function projectionsConfigured() {
  return Boolean(String(process.env.ANTHROPIC_API_KEY || '').trim());
}

export function projectionHealth() {
  return {
    configured: projectionsConfigured(),
    model: MODEL,
    promptSource: projectionPromptSource(),
    cached: cache.size,
  };
}

function getClient() {
  if (!client) {
    client = new Anthropic({ maxRetries: 1, timeout: REQUEST_TIMEOUT_MS });
  }
  return client;
}

const unavailable = (code, message) => ({
  ok: true, available: false, code,
  message: message || 'A modelled projection is unavailable for this prop.',
});

function cacheKey(input) {
  return JSON.stringify([
    input.sport, input.playerName, input.market, input.line,
    input.opponent || null, input.overPrice ?? null, input.underPrice ?? null,
  ]);
}

/**
 * Strip the payload down to what the model should see.
 *
 * Bounded on every axis: a caller cannot push an unbounded game log, a novel
 * field, or free text of arbitrary length into a paid request. Anything not
 * named here does not reach the model.
 */
export function buildModelPayload(input = {}) {
  const text = (value, max) => {
    const out = String(value ?? '').trim();
    return out ? out.slice(0, max) : null;
  };
  const number = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const games = Array.isArray(input.gameLog) ? input.gameLog.slice(0, 25).map((row) => ({
    date: text(row?.date, 32),
    opponent: text(row?.opponent, 40),
    isHome: typeof row?.isHome === 'boolean' ? row.isHome : null,
    value: number(row?.value),
    minutes: number(row?.minutes),
  })).filter((row) => row.value !== null) : [];

  const windows = {};
  for (const id of ['l5', 'l10', 'l15', 'l20', 'season']) {
    const w = input.windows?.[id];
    if (!w) continue;
    const average = number(w.average);
    if (average === null) continue;
    windows[id] = { average, games: number(w.games), hitRate: number(w.hitRate) };
  }

  return {
    sport: text(input.sport, 12),
    player: text(input.playerName, 90),
    team: text(input.team, 40),
    position: text(input.position, 12),
    market: text(input.market, 100),
    line: number(input.line),
    prices: { over: number(input.overPrice), under: number(input.underPrice) },
    books: Array.isArray(input.books) ? input.books.slice(0, 12).map((book) => ({
      book: text(book?.sportsbook || book?.key, 40),
      line: number(book?.line),
      overPrice: number(book?.overPrice),
      underPrice: number(book?.underPrice),
    })).filter((book) => book.book) : [],
    matchup: {
      opponent: text(input.opponent, 60),
      homeTeam: text(input.homeTeam, 60),
      awayTeam: text(input.awayTeam, 60),
      startTime: text(input.gameStartTime, 40),
      isHome: typeof input.isHome === 'boolean' ? input.isHome : null,
    },
    windows,
    gameLog: games,
    // Optional context. Absent keys stay absent: the prompt forbids filling
    // them in, and an empty object is an honest description of what we have.
    context: {
      injuryStatus: text(input.injuryStatus, 80),
      restDays: number(input.restDays),
      gamesInLastSevenDays: number(input.gamesInLastSevenDays),
      isBackToBack: typeof input.isBackToBack === 'boolean' ? input.isBackToBack : null,
      opponentDefenseRank: number(input.opponentDefenseRank),
      opponentPaceRank: number(input.opponentPaceRank),
      teamMoneyline: number(input.teamMoneyline),
      gameTotal: number(input.gameTotal),
      notes: text(input.notes, 400),
    },
  };
}

async function requestProjection(input) {
  const payload = buildModelPayload(input);
  let response;
  try {
    response = await getClient().messages.parse({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // The prompt is identical on every request and is the largest stable
      // block, so caching it turns most of the input cost into a cache read.
      system: [{ type: 'text', text: projectionSystemPrompt(), cache_control: { type: 'ephemeral' } }],
      // Thinking is on by default on this model family; medium effort is the
      // right trade for a single bounded estimate.
      output_config: { effort: 'medium', format: jsonSchemaOutputFormat(PROJECTION_OUTPUT_SCHEMA) },
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    });
  } catch (error) {
    // Typed, most specific first. Nothing from the provider reaches a customer.
    if (error instanceof Anthropic.AuthenticationError) {
      console.error('[projections] authentication rejected');
      return unavailable('PROJECTION_NOT_CONFIGURED');
    }
    if (error instanceof Anthropic.RateLimitError) {
      console.error('[projections] rate limited by the provider');
      return unavailable('PROJECTION_RATE_LIMITED', 'Projections are busy. Try again shortly.');
    }
    if (error instanceof Anthropic.APIError) {
      console.error('[projections] provider error', String(error.status || '').slice(0, 8));
      return unavailable('PROJECTION_PROVIDER_ERROR');
    }
    console.error('[projections] request failed', String(error?.message || 'unknown').slice(0, 120));
    return unavailable('PROJECTION_PROVIDER_ERROR');
  }

  // A safety decline is a real outcome on this model family, and arrives as a
  // 200. Check it before reading content.
  if (response?.stop_reason === 'refusal') {
    console.error('[projections] request declined', String(response?.stop_details?.category || 'unspecified').slice(0, 40));
    return unavailable('PROJECTION_DECLINED');
  }
  if (response?.stop_reason === 'max_tokens') return unavailable('PROJECTION_TRUNCATED');

  const parsed = response?.parsed_output;
  if (!parsed) return unavailable('PROJECTION_UNPARSEABLE');

  const derived = deriveProjection(parsed, {
    line: payload.line,
    overPrice: payload.prices.over,
    underPrice: payload.prices.under,
  });
  if (!derived) return unavailable('PROJECTION_INCOMPLETE');

  return {
    ok: true,
    available: true,
    source: 'Model projection',
    modelled: true,
    generatedAt: new Date().toISOString(),
    player: payload.player,
    market: payload.market,
    sport: payload.sport,
    ...derived,
  };
}

/** Projection for one prop, cached and de-duplicated across concurrent callers. */
export async function projectPlayerProp(input = {}) {
  if (!projectionsConfigured()) {
    return unavailable('PROJECTION_NOT_CONFIGURED', 'Modelled projections are not enabled.');
  }
  const key = cacheKey(input);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return { ...hit.value, cached: true };
  if (inflight.has(key)) return inflight.get(key);

  const pending = requestProjection(input).then((value) => {
    // Only a real projection is worth holding; a failure should be retryable
    // soon rather than pinned for ten minutes.
    if (value.available) {
      cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
      while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    }
    return value;
  }).finally(() => inflight.delete(key));

  inflight.set(key, pending);
  return pending;
}
