/**
 * Additive, on-demand PropLine research surface. Not an ingestion worker.
 * Canonical sport keys are data, not the legacy board's eleven-sport enum.
 * Reads use the existing shared client (cache, reserve, in-flight dedupe and
 * Retry-After); nothing here adds polling, storage, credentials or subscriptions.
 */
const txt = (v) => String(v ?? '').trim();
const rows = (v) => Array.isArray(v) ? v : [];
const present = (v) => v !== null && v !== undefined && v !== '';
const invalid = (message) => Object.assign(new Error(message), { code: 'INVALID_EXPLORER_REQUEST', status: 400 });
const rule = (id, label, group, scope, suffix, params = '', ttl = 60, note = '') => Object.freeze({ id, label, group, scope, suffix, params: params.split(' ').filter(Boolean), ttl, note });

export const EXPLORER_CAPABILITIES = Object.freeze([
  rule('sports', 'Sports', 'Discovery', 'global', '/v1/sports', '', 3600),
  rule('events', 'Events', 'Discovery', 'sport', '/events', '', 120),
  rule('markets', 'Market directory', 'Markets', 'event', '/markets', '', 300, 'Discovery lists full-game market keys. A period-only key can also be entered explicitly.'),
  rule('odds', 'All market lines', 'Markets', 'event', '/odds', 'markets bookmakers period', 30, 'All returned books and alternate lines are retained. Period and team totals remain distinct. These are timestamped snapshots, not a promise that a quote is still takeable.'),
  rule('game-lines', 'Game lines', 'Markets', 'sport', '/odds', 'markets bookmakers period', 60),
  rule('scores', 'Scores', 'Games', 'sport', '/scores', 'days_from', 90),
  rule('stats', 'Box scores', 'Games', 'event', '/stats', 'stat_type', 90, 'In-progress statistics are partial; only final games are complete box scores.'),
  rule('context', 'Game context', 'Games', 'event', '/context', '', 300, 'Venue, weather and lineup context depend on source coverage. No context is not a zero-weather reading.'),
  rule('ev', 'Expected value', 'Value', 'event', '/ev', 'markets bookmakers devig', 60, 'Market-derived estimates, not guarantees. Read the fair-source book for each line. DFS synthetic prices are not single-pick payout odds.'),
  rule('best-line', 'Line shopping', 'Value', 'event', '/best-line', 'markets bookmakers', 60, 'Compare the same player, market, side and line. Check quote age and exchange liquidity. Full-game only.'),
  rule('projections', 'Market projections', 'Value', 'event', '/projections', 'markets', 60, 'Market-implied values from sportsbook prices, not a trained forecasting model.'),
  rule('ev-calc', 'Price calculator', 'Value', 'event', '/ev/calc', 'market name point description price', 60, 'Full-game only. Your quoted price is compared with a no-vig market anchor; no wager is placed.'),
  rule('movement', 'Movement & steam', 'Movement', 'event', '/movement', 'markets bookmakers period', 90, 'A movement signal is not proof of sharp money or a guaranteed edge.'),
  rule('history', 'Line history', 'Movement', 'event', '/odds/history', 'markets bookmakers period relative_from relative_to interval changes_only', 300, 'Default: the three hours before scheduled start, sampled once per minute. Recorded-at is observation time, not the book-published time.'),
  rule('closing', 'Opening & closing', 'Movement', 'event', '/odds/closing', 'markets bookmakers period', 300, 'The opening is first observed, not necessarily the book’s true open. A pre-start close is not final.'),
  rule('results', 'Graded outcomes', 'Players', 'event', '/results', 'markets', 600, 'Won, lost, push and void are distinct. Missing or ungraded results remain unavailable.'),
  rule('games', 'Game logs & H2H', 'Players', 'player', '/games', 'limit opponent stat_type', 900, 'Raw-stat archive, not posted-line hit rates. H2H applies before the limit. A 100-game response is not automatically a complete season.'),
  rule('player-history', 'Posted-line history', 'Players', 'player', '/history', 'market bookmaker limit', 900, 'One entry per event and bookmaker; multiple books are not multiple games.'),
  rule('trends', 'Posted-line trends', 'Players', 'player', '/trends', 'market dfs_odds_type', 900, 'Rates use each historical posted line, not your current line. Pushes are excluded from over percentage.'),
  rule('futures', 'Futures', 'Season', 'sport', '/futures', 'bookmakers', 3600, 'Unsettled outcomes stay ungraded. Season outrights are research, not predictions of certainty.'),
  rule('grand-salami', 'MLB daily runs', 'Season', 'fixed', '/v1/sports/baseball_mlb/grand-salami', 'date', 300, 'Synthetic daily total across MLB games, not a single offered sportsbook market. Date is UTC.'),
  rule('daily-goals', 'NHL daily goals', 'Season', 'fixed', '/v1/sports/hockey_nhl/daily-goals-total', 'date', 300, 'Synthetic daily total across NHL games, not a single offered sportsbook market. Date is UTC.'),
  rule('dfs-payouts', 'DFS payout math', 'DFS', 'global', '/v1/dfs/payouts', 'platform leg_win_prob', 3600, 'Standard published payouts only. Independent-leg mathematics does not price correlated entries or Goblin/Demon modifiers.'),
  rule('hit-rates', 'Market baselines', 'Coverage', 'global', '/v1/markets/hit-rates', 'days bookmaker', 600, 'Aggregate historical Over counts are calibration data, not a player forecast.'),
  rule('resolution-summary', 'Grading coverage', 'Coverage', 'global', '/v1/markets/resolution-summary', 'days', 3600, 'Coverage volume is not a profitability claim.'),
  rule('freshness', 'Book freshness', 'Coverage', 'global', '/v1/freshness', '', 30, 'Compare props and game-line freshness separately. One fresh market does not prove the entire book is fresh.'),
]);
const RULES = new Map(EXPLORER_CAPABILITIES.map((entry) => [entry.id, entry]));
const PERIOD = /^(full|all|q[1-4]|h[12]|p[1-3]|i[1-9]|f[357]|map[1-7]|s[1-5]|g[1-7])$/;
const CSV = new Set(['markets', 'bookmakers', 'stat_type']);
const SLUG = new Set(['market', 'bookmaker']);
const TEXT = new Set(['name', 'description', 'opponent']);
const PRIVATE_FIELD = /^(api_?keys?|secrets?|signing_?secret|authorization|password|customer_?token|access_?token|refresh_?token|token|upgrade_?url|docs_?url)$/i;

function identifier(value, label, max = 160) {
  const valueText = txt(value);
  if (!valueText || valueText.length > max || !/^[a-zA-Z0-9][a-zA-Z0-9_:-]*$/.test(valueText)) throw invalid(`A valid ${label} is required.`);
  return valueText;
}
function integer(value, fallback, maximum) {
  if (!present(value)) return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > maximum) throw invalid(`Use a whole number between 1 and ${maximum}.`);
  return n;
}
function parameter(name, value, kind) {
  const v = txt(value);
  if (!v) return undefined;
  if (CSV.has(name)) {
    const parts = [...new Set(v.split(',').map((x) => x.trim()))].sort();
    if (parts.length > 500 || v.length > 16000 || parts.some((x) => !/^[a-z0-9_]+$/i.test(x))) throw invalid(`Invalid ${name}.`);
    return parts.join(',');
  }
  if (SLUG.has(name)) return identifier(v, name, 120);
  if (TEXT.has(name)) {
    // Keep the shared client's legacy cache-key separator out of text values.
    // The HTTP URL itself is still encoded by URLSearchParams.
    if (v.length > 160 || /[\u0000-\u001f\u007f&=]/.test(v)) throw invalid(`Invalid ${name}.`);
    return v;
  }
  if (name === 'period') { if (!PERIOD.test(v)) throw invalid('Invalid period.'); return v === 'full' ? undefined : v; }
  if (name === 'devig') { if (!['multiplicative', 'shin'].includes(v)) throw invalid('Invalid de-vig method.'); return v; }
  if (name === 'dfs_odds_type') { if (!['standard', 'goblin', 'demon'].includes(v)) throw invalid('Invalid DFS flavor.'); return v; }
  if (name === 'platform') { if (v !== 'prizepicks') throw invalid('Payout reference is available for PrizePicks only.'); return v; }
  if (name === 'interval') { if (!['30s', '1m', '5m', '15m', '30m', '1h'].includes(v)) throw invalid('Invalid sampling interval.'); return v; }
  if (name === 'changes_only') { if (!['true', 'false'].includes(v)) throw invalid('Invalid change filter.'); return v; }
  if (name === 'relative_from' || name === 'relative_to') {
    const match = /^(-?\d+)([hms]?)$/.exec(v);
    if (!match || (!match[2] && match[1] !== '0')) throw invalid('Use offsets such as -3h, -30m or 0.');
    const seconds = Number(match[1]) * ({ h: 3600, m: 60, s: 1, '': 1 }[match[2]]);
    if (!Number.isSafeInteger(seconds) || Math.abs(seconds) > 14 * 86400) throw invalid('History offsets must be within fourteen days of start.');
    return v;
  }
  if (name === 'date') {
    const parsed = new Date(`${v}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== v) throw invalid('Use a valid UTC date.');
    return v;
  }
  if (name === 'limit') return integer(v, 20, 100);
  if (name === 'days') return integer(v, kind === 'hit-rates' ? 28 : 30, kind === 'hit-rates' ? 60 : 90);
  if (name === 'days_from') return integer(v, 3, 7);
  const number = Number(v);
  if (!Number.isFinite(number)) throw invalid(`Invalid ${name}.`);
  if (name === 'leg_win_prob' && (number <= 0 || number >= 1)) throw invalid('Win probability must be between 0 and 1, excluding the endpoints.');
  if (name === 'price' && (!Number.isInteger(number) || Math.abs(number) < 100 || Math.abs(number) > 1000000)) throw invalid('Use valid American odds, such as -110 or +125.');
  if (name === 'point' && Math.abs(number) > 100000) throw invalid('Invalid line.');
  return number;
}

export function explorerCatalog() {
  return EXPLORER_CAPABILITIES.filter((r) => !['sports', 'events'].includes(r.id)).map(({ suffix, ttl, ...r }) => r);
}

export function buildExplorerRequest(kind, input = {}) {
  const r = RULES.get(txt(kind));
  if (!r) throw invalid('Unknown research view.');
  let path = r.suffix;
  if (['sport', 'event', 'player'].includes(r.scope)) {
    const sport = identifier(input.sport, 'canonical sport key', 96);
    if (sport !== sport.toLowerCase()) throw invalid('Select a canonical sport key from the sports catalog.');
    path = `/v1/sports/${sport}`;
    if (r.scope === 'event') path += `/events/${identifier(input.eventId, 'event id')}`;
    if (r.scope === 'player') {
      const player = txt(input.playerName);
      if (!player || player.length > 160 || /[\u0000-\u001f\u007f/\\]/.test(player)) throw invalid('A player name is required.');
      path += `/players/${encodeURIComponent(player)}`;
    }
    path += r.suffix;
  }
  if (present(input.period) && !r.params.includes('period')) throw invalid('This view does not support a period filter.');
  const params = {};
  for (const name of r.params) {
    const value = parameter(name, input[name], r.id);
    if (value !== undefined) params[name] = value;
  }
  if (r.id === 'odds' || r.id === 'game-lines') {
    if (txt(input.period) !== 'full') params.period ??= 'all';
    params.includeLinks = true;
    params.includeBookIds = true;
  }
  if (r.id === 'game-lines') params.markets ??= 'h2h,spreads,totals';
  if (r.id === 'best-line') params.includeLinks = true;
  if (r.id === 'history') Object.assign(params, {
    relative_from: params.relative_from ?? '-3h', relative_to: params.relative_to ?? '0',
    interval: params.interval ?? '1m', changes_only: params.changes_only ?? 'true',
  });
  if (r.id === 'player-history' && !params.market) throw invalid('Select a market for posted-line history.');
  if (r.id === 'ev-calc' && (!params.market || !params.name || params.price === undefined)) throw invalid('Market, selection and American odds are required.');
  return { kind: r.id, scope: r.scope, path, params, ttlSeconds: r.ttl, note: r.note };
}

// The shared public sanitizer intentionally removes the generic property `key`.
// Preserve provider catalog/book/market identifiers as reference_key BEFORE that
// sanitizer; never weaken it or forward private provider links to customers.
export function explorerPublicData(value) {
  if (Array.isArray(value)) return value.map(explorerPublicData);
  if (value === null || typeof value !== 'object') return value;
  const out = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (PRIVATE_FIELD.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    out[key === 'key' ? 'reference_key' : key] = explorerPublicData(item);
  }
  return out;
}

export function offerState(book, market, outcome, now = Date.now()) {
  if (outcome?.redacted === true || market?.redacted === true || book?.redacted === true) return 'redacted';
  if (present(market?.suspended_at)) return 'suspended';
  if (book?.pregame_only === true) return 'pregame-only';
  if (typeof outcome?.price !== 'number' || !Number.isFinite(outcome.price) || Math.abs(outcome.price) < 100) return 'unavailable';
  const seen = Date.parse(outcome?.last_seen_at ?? ''), update = Date.parse(market?.last_update ?? '');
  if (Number.isFinite(seen) && Number.isFinite(update) && seen < update) return 'withdrawn';
  if (!Number.isFinite(seen) || !Number.isFinite(update)) return 'unverified';
  if (seen > now + 60000 || update > now + 60000) return 'unverified';
  return now - Math.min(seen, update) > 900000 ? 'stale' : 'available';
}

function annotateOdds(data, now) {
  if (Array.isArray(data)) return data.map((e) => annotateOdds(e, now));
  if (!data || typeof data !== 'object') return data;
  return { ...data, bookmakers: rows(data.bookmakers).map((b) => ({ ...b, markets: rows(b.markets).map((m) => ({
    ...m, outcomes: rows(m.outcomes).map((o) => ({ ...o,
      offer_state: data.redacted === true ? 'redacted' : offerState(b, m, o, now),
      pricing_class: b.reference_key === 'prizepicks' ? 'synthetic-dfs'
        : b.reference_key === 'underdog' ? o.payout_multiplier === 1 ? 'standard-dfs' : 'scaled-or-unverified-dfs'
        : present(o.dfs_odds_type) ? 'dfs' : 'quoted-odds',
    })),
  })) })) };
}

export function explorerError(error) {
  const raw = txt(error?.code), status = Number(error?.status) || 0;
  const state = raw === 'INVALID_EXPLORER_REQUEST' ? 'invalid'
    : status === 403 || error?.detail === 'upgrade_required' ? 'not-enabled'
    : status === 429 || /LIMIT|RESERVE/.test(raw) ? 'rate-limited'
    : status === 404 ? 'not-found'
    : raw === 'PROPLINE_NOT_CONFIGURED' ? 'unavailable' : 'unavailable';
  return {
    ok: false, state, available: false,
    message: state === 'invalid' ? error.message
      : state === 'not-enabled' ? 'This data feature is not enabled for the service. Missing values are not zero.'
      : state === 'rate-limited' ? 'Data requests are cooling down. Previously shown snapshots are not a live quote.'
      : state === 'not-found' ? 'No data was returned for this selection. An event may have moved; reselect it from the event list.'
      : 'This research view is temporarily unavailable.',
    retryAfterSeconds: Number.isFinite(error?.retryMs) ? Math.ceil(error.retryMs / 1000) : null,
  };
}

// On-demand only. Preserve the raw public report, including worst-case ages,
// suspended counts and nulls that older normalized freshness wrappers discard.
let freshnessCache = null, freshnessInflight = null;
export async function readExplorerFreshness({ fetcher = globalThis.fetch, now = Date.now } = {}) {
  if (freshnessCache && freshnessCache.until > now()) return freshnessCache.data;
  if (freshnessInflight) return freshnessInflight;
  freshnessInflight = (async () => {
    const response = await fetcher('https://api.prop-line.com/v1/freshness', {
      headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw Object.assign(new Error('Freshness report unavailable.'), { status: response.status });
    const data = await response.json();
    freshnessCache = { data, until: now() + 30000 };
    return data;
  })().finally(() => { freshnessInflight = null; });
  return freshnessInflight;
}
export function __resetExplorerFreshnessForTests() { freshnessCache = null; freshnessInflight = null; }

export async function readExplorer(kind, input = {}, { get, freshness, now = Date.now } = {}) {
  if (kind === 'capabilities') return { ok: true, data: explorerCatalog(), available: true, state: 'ready' };
  const request = buildExplorerRequest(kind, input);
  let payload;
  if (kind === 'freshness') payload = await (freshness ?? readExplorerFreshness)();
  else {
    const client = get ?? (await import('./client.mjs')).proplineGet;
    // An omitted event-odds markets parameter may select only game lines.
    // Discover the event's actual keys instead of a static sport allowlist.
    // Period-only keys are still accepted explicitly; discovery is full-game.
    if (kind === 'odds' && !request.params.markets) {
      const directory = await client(request.path.replace(/\/odds$/, '/markets'), {}, { ttlSeconds: 300 });
      const catalog = rows(Array.isArray(directory) ? directory : directory?.markets ?? directory?.data);
      const keys = [...new Set(catalog.map((m) => txt(m?.key ?? m?.market_key)).filter((k) => /^[a-z0-9_]+$/i.test(k)))].sort();
      if (keys.length) request.params.markets = keys.join(',');
      else request.params.markets = 'h2h,spreads,totals';
    }
    payload = await client(request.path, request.params, { ttlSeconds: request.ttlSeconds });
  }
  let data = explorerPublicData(payload);
  if (kind === 'odds' || kind === 'game-lines') data = annotateOdds(data, now());
  return { ok: true, kind, data, available: data !== null && data !== undefined,
    state: payload?.redacted === true ? 'limited' : data == null ? 'unavailable' : 'ready',
    note: request.note, snapshotServedAt: new Date(now()).toISOString() };
}
