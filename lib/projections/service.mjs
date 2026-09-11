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

import { PROJECTION_OUTPUT_SCHEMA, deriveProjection } from './schema.mjs';
import { activeProvider, configured as providerConfigured, providerHealth } from './providers/index.mjs';
import { projectionSystemPrompt, projectionPromptSource } from './system-prompt.mjs';
import { projectionBaseline } from './baseline.mjs';
import { calibrateProjection } from './calibrate.mjs';

// Per-request budget shared by every provider. Generous on purpose: a
// high-effort turn that also writes four sections is not a short request, and
// an abort costs the whole call — the money is spent either way.
const REQUEST_TIMEOUT_MS = 150_000;
const CACHE_TTL_MS = 10 * 60_000;
const MAX_CACHE_ENTRIES = 500;

const cache = new Map();
const inflight = new Map();
let client = null;

export function projectionsConfigured() {
  return providerConfigured();
}

export function projectionHealth() {
  return {
    configured: projectionsConfigured(),
    ...providerHealth(),
    promptSource: projectionPromptSource(),
    cached: cache.size,
  };
}

const unavailable = (code, message) => ({
  ok: true, available: false, code,
  message: message || 'A modelled projection is unavailable for this prop.',
});

/**
 * Prices move a cent at a time on every board refresh. Keying the cache on the
 * exact price meant a trivial tick invalidated a projection that had not
 * meaningfully changed, and every refresh bought the same answer again at full
 * price. Bucketing to the nearest ten points of American odds keeps the
 * distinction that matters — -110 versus -140 is a different bet, -110 versus
 * -112 is not — and turns most repeat views into cache hits.
 */
const PRICE_BUCKET = 10;
function bucketPrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price)) return null;
  return Math.round(price / PRICE_BUCKET) * PRICE_BUCKET;
}

function cacheKey(input) {
  return JSON.stringify([
    input.sport, input.playerName, input.market, input.line,
    input.opponent || null, bucketPrice(input.overPrice), bucketPrice(input.underPrice),
    // A different provider or model is a different answer to the same
    // question, so a cached entry must not outlive a switch between them.
    providerHealth().provider, providerHealth().model,
    // A scenario is a different question about the same prop, so it needs its
    // own entry or toggling a team-mate out would return the baseline run.
    (Array.isArray(input.teammatesOut) ? input.teammatesOut : [])
      .map((row) => String(row?.playerName ?? row)).sort(),
  ]);
}

/**
 * Strip the payload down to what the model should see.
 *
 * Bounded on every axis: a caller cannot push an unbounded game log, a novel
 * field, or free text of arbitrary length into a paid request. Anything not
 * named here does not reach the model.
 */
/**
 * Rest and recent schedule load, read off the game log.
 *
 * Measured against the upcoming game's start time when the caller supplies one,
 * and against the most recent logged game otherwise. Returns nulls rather than
 * guesses when the dates are not there.
 */
export function scheduleContext(games = [], gameStartTime = null) {
  const dates = games
    .map((row) => Date.parse(row?.date || ''))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a);
  if (!dates.length) return { restDays: null, gamesInLastSevenDays: null, isBackToBack: null };

  const kickoff = Date.parse(gameStartTime || '');
  const reference = Number.isFinite(kickoff) ? kickoff : dates[0];
  const previous = dates.find((value) => value < reference);
  const restDays = previous === undefined ? null : Math.round((reference - previous) / 86_400_000);
  const gamesInLastSevenDays = dates.filter((value) => value < reference && reference - value <= 7 * 86_400_000).length;

  return {
    restDays,
    gamesInLastSevenDays,
    // One day or less between games. Meaningful in basketball and hockey and
    // effectively never true in football, which is the honest answer there.
    isBackToBack: restDays === null ? null : restDays <= 1,
  };
}

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

  // Rest and schedule load are not missing data — they are in the game log,
  // one subtraction away. Deriving them here removes two entries from every
  // data_gaps list and gives the model context it was being told it lacked.
  const schedule = scheduleContext(games, input.gameStartTime);

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
    // A recency-weighted read of the log above, computed here rather than left
    // for the model to infer. It anchors the estimate on what the player
    // actually does, and it is the same figure the response is reconciled
    // against afterwards — so the model is shown the standard it will be held
    // to instead of being surprised by it.
    baseline: projectionBaseline({ gameLog: games, line: number(input.line) }),
    // Optional context. Absent keys stay absent: the prompt forbids filling
    // them in, and an empty object is an honest description of what we have.
    context: {
      injuryStatus: text(input.injuryStatus, 80),
      // Supplied values win; otherwise these come from the log itself. Null
      // when the log cannot support them — never a league-median stand-in,
      // which would read as measured and is not.
      restDays: number(input.restDays) ?? schedule.restDays,
      gamesInLastSevenDays: number(input.gamesInLastSevenDays) ?? schedule.gamesInLastSevenDays,
      isBackToBack: typeof input.isBackToBack === 'boolean' ? input.isBackToBack : schedule.isBackToBack,
      // Scenario sandbox: team-mates the user has marked out for this game.
      // Real names from the depth chart, never a synthetic roster, and the
      // model is asked to reason about the absence rather than the caller
      // applying a fixed usage bump.
      teammatesOut: Array.isArray(input.teammatesOut)
        ? input.teammatesOut.slice(0, 6).map((row) => ({
            player: text(row?.playerName ?? row, 90),
            position: text(row?.position, 12),
            injuryStatus: text(row?.injuryStatus, 40),
          })).filter((row) => row.player)
        : [],
      opponentDefenseRank: number(input.opponentDefenseRank),
      opponentPaceRank: number(input.opponentPaceRank),
      teamMoneyline: number(input.teamMoneyline),
      gameTotal: number(input.gameTotal),
      notes: text(input.notes, 400),
    },
  };
}

async function requestProjection(input) {
  const provider = activeProvider();
  if (!provider) return unavailable('PROJECTION_NOT_CONFIGURED', 'Modelled projections are not enabled.');

  const payload = buildModelPayload(input);
  const result = await provider.generate({
    system: projectionSystemPrompt(),
    payload,
    schema: PROJECTION_OUTPUT_SCHEMA,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  if (!result.ok) {
    // A rejected key reads as "not enabled" to a customer, which is true from
    // where they sit; the operator gets the real reason in the log.
    const MESSAGES = {
      PROJECTION_RATE_LIMITED: 'Projections are busy. Try again shortly.',
      PROJECTION_NOT_CONFIGURED: 'Modelled projections are not enabled.',
    };
    return unavailable(result.code, MESSAGES[result.code]);
  }
  const parsed = result.parsed;

  // Reconcile against the log before any arithmetic, so edge, EV and the pick
  // label are all computed from the calibrated figures rather than from a raw
  // estimate the log does not support.
  const calibrated = calibrateProjection(parsed, { gameLog: payload.gameLog, line: payload.line });
  if (!calibrated) return unavailable('PROJECTION_INCOMPLETE');

  const derived = deriveProjection({
    ...parsed,
    projection: calibrated.projection,
    probability_over: calibrated.probabilityOver,
    confidence: calibrated.confidence,
  }, {
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
    scenario: payload.context.teammatesOut.length
      ? { teammatesOut: payload.context.teammatesOut.map((row) => row.player) }
      : null,
    ...derived,
    calibration: calibrated.calibration,
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
