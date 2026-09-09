// SportsDataIO stats-provider adapter.
//
// Endpoints, auth and response fields below were taken from SportsDataIO's
// published OpenAPI specs (v3), not inferred:
//   base    https://azure-api.sportsdata.io/v3/{sport}/{scope}
//   auth    Ocp-Apim-Subscription-Key request header
//   NBA/MLB/NHL  /projections/json/PlayerGameProjectionStatsByDate/{date}
//   NFL          /projections/json/PlayerGameProjectionStatsByWeek/{season}/{week}
//   dates   YYYY-MMM-DD, e.g. 2026-SEP-09
//
// Coverage limits, reported honestly rather than worked around:
//   - SportsDataIO publishes no WNBA feed at all.
//   - NCAAF (cfb) and NCAAB (cbb) have scores/stats but NO projections.
//   Props in those leagues are returned un-enriched.
//
// The API key is read from the environment only. It is never logged, never
// returned in a status payload, and never sent to the browser.

import { enrichmentKey } from './contract.mjs';
import { toNumberOrNull } from '../props/model.mjs';

const BASE = 'https://azure-api.sportsdata.io/v3';
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Leagues with a projections feed, and how that feed is addressed. */
const LEAGUES = Object.freeze({
  NBA: { path: 'nba', by: 'date' },
  MLB: { path: 'mlb', by: 'date' },
  NHL: { path: 'nhl', by: 'date' },
  NFL: { path: 'nfl', by: 'week' },
});

/** Leagues Scout Pro scans that SportsDataIO cannot project. */
export const SUPPORTED_LEAGUES = Object.freeze(Object.keys(LEAGUES));

/** Leagues Scout Pro scans that SportsDataIO cannot project. */
export const UNSUPPORTED_LEAGUES = Object.freeze(['WNBA', 'NCAAF', 'CFB', 'NCAAB', 'CBB']);

// PickFinder market -> projected stat field(s). Summed when a market is a
// combo. A market absent from this table yields no projection rather than a
// guess, so an unmapped prop is simply left un-enriched.
const MARKETS = Object.freeze({
  NBA: {
    'points': ['Points'],
    'rebounds': ['Rebounds'],
    'assists': ['Assists'],
    'steals': ['Steals'],
    'blocks': ['BlockedShots'],
    'blocked shots': ['BlockedShots'],
    '3-pt made': ['ThreePointersMade'],
    'three pointers': ['ThreePointersMade'],
    'threes': ['ThreePointersMade'],
    'pts+reb+ast': ['Points', 'Rebounds', 'Assists'],
    'points + rebounds + assists': ['Points', 'Rebounds', 'Assists'],
    'pra': ['Points', 'Rebounds', 'Assists'],
    'points + rebounds': ['Points', 'Rebounds'],
    'pts+reb': ['Points', 'Rebounds'],
    'points + assists': ['Points', 'Assists'],
    'pts+ast': ['Points', 'Assists'],
    'rebounds + assists': ['Rebounds', 'Assists'],
    'reb+ast': ['Rebounds', 'Assists'],
    'steals + blocks': ['Steals', 'BlockedShots'],
  },
  NFL: {
    'passing yards': ['PassingYards'],
    'pass yards': ['PassingYards'],
    'passing tds': ['PassingTouchdowns'],
    'passing touchdowns': ['PassingTouchdowns'],
    'rushing yards': ['RushingYards'],
    'rush yards': ['RushingYards'],
    'receiving yards': ['ReceivingYards'],
    'rec yards': ['ReceivingYards'],
    'receptions': ['Receptions'],
    'rush+rec yards': ['RushingYards', 'ReceivingYards'],
    'pass+rush yards': ['PassingYards', 'RushingYards'],
  },
  MLB: {
    'hits': ['Hits'],
    'runs': ['Runs'],
    'rbis': ['RunsBattedIn'],
    'runs batted in': ['RunsBattedIn'],
    'hits+runs+rbis': ['Hits', 'Runs', 'RunsBattedIn'],
    'hits + runs + rbi': ['Hits', 'Runs', 'RunsBattedIn'],
    'total bases': ['TotalBases'],
    'strikeouts': ['Strikeouts'],
    'singles': ['Singles'],
    'doubles': ['Doubles'],
  },
  NHL: {
    'shots on goal': ['ShotsOnGoal'],
    'shots': ['ShotsOnGoal'],
    'goals': ['Goals'],
    'assists': ['Assists'],
    'points': ['Goals', 'Assists'],
    'hits': ['Hits'],
    'saves': ['Saves'],
  },
});

export function formatDate(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}-${MONTHS[d.getUTCMonth()]}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Per-sport key overrides, because SportsDataIO often issues a key per feed. */
function keyFor(sport) {
  return process.env[`SPORTSDATAIO_KEY_${String(sport).toUpperCase()}`]
    || process.env.SPORTSDATAIO_API_KEY
    || '';
}

function projectionFor(sport, market, row) {
  const table = MARKETS[sport];
  if (!table) return null;
  const fields = table[String(market || '').toLowerCase().trim()];
  if (!fields) return null;
  let total = 0;
  for (const field of fields) {
    // toNumberOrNull, not Number(): a null component would otherwise coerce to
    // 0 and a partial combo would be published as a complete projection.
    const value = toNumberOrNull(row?.[field]);
    if (value === null) return null;
    total += value;
  }
  return Number(total.toFixed(2));
}

function liveStatusFor(row) {
  if (row?.IsGameOver === true) return 'FINAL';
  const start = Date.parse(row?.DateTime || '');
  if (!Number.isFinite(start)) return null;
  return start <= Date.now() ? 'LIVE' : 'SCHEDULED';
}

function injuryStatusFor(row) {
  const value = String(row?.InjuryStatus || '').toUpperCase().trim();
  if (!value || value === 'SCRATCHED') return null;
  if (value.startsWith('OUT')) return 'OUT';
  if (value.startsWith('DOUBTFUL')) return 'DOUBTFUL';
  if (value.startsWith('QUESTIONABLE') || value.startsWith('GTD')) return 'QUESTIONABLE';
  if (value.startsWith('PROBABLE') || value.startsWith('ACTIVE') || value === 'HEALTHY') return 'ACTIVE';
  return null;
}

async function request(url, apiKey, { fetchImpl = fetch, timeoutMs = 8000, raw = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { 'Ocp-Apim-Subscription-Key': apiKey, accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      // Status only. The URL carries no key (it is a header), but the message
      // is still kept free of anything provider-identifying beyond the code.
      throw Object.assign(new Error(`SportsDataIO responded ${response.status}`), {
        code: response.status === 401 || response.status === 403 ? 'PROVIDER_UNAUTHORIZED' : 'PROVIDER_HTTP_ERROR',
        status: response.status,
      });
    }
    const body = await response.json();
    if (raw) return body;              // scalar feeds like CurrentSeason
    return Array.isArray(body) ? body : [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the current NFL season and week from the scores feed, so NFL does not
 * need hand-maintained config. Returns null when the feed is unavailable, in
 * which case NFL is skipped rather than called with a wrong week.
 */
export async function resolveNflTimeframe(apiKey, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  if (!apiKey) return null;
  try {
    const [season, week] = await Promise.all([
      request(`${BASE}/nfl/scores/json/CurrentSeason`, apiKey, { fetchImpl, timeoutMs, raw: true }),
      request(`${BASE}/nfl/scores/json/CurrentWeek`, apiKey, { fetchImpl, timeoutMs, raw: true }),
    ]);
    if (season === null || season === undefined || week === null || week === undefined) return null;
    return { season, week };
  } catch {
    return null;
  }
}

/**
 * @param {object} options
 *   nflSeason / nflWeek  optional; resolved from the scores feed when omitted.
 *   fetchImpl            injected in tests.
 */
export function createSportsDataIoAdapter({ fetchImpl = fetch, timeoutMs = 8000, now = () => new Date(), nflSeason = null, nflWeek = null } = {}) {
  return {
    id: 'sportsdataio',
    name: 'SportsDataIO',
    capabilities: [
      'projection', 'projectionSource', 'team', 'gameStartTime',
      'injuryStatus', 'isStarter', 'expectedMinutes', 'opponentRank', 'liveStatus',
    ],

    isConfigured() {
      return Boolean(process.env.SPORTSDATAIO_API_KEY || Object.keys(process.env).some((key) => key.startsWith('SPORTSDATAIO_KEY_')));
    },

    /** Leagues in this population that this provider genuinely cannot serve. */
    unsupportedFor(props = []) {
      return [...new Set(props
        .map((prop) => String(prop.sport || '').toUpperCase())
        .filter((sport) => sport && !LEAGUES[sport]))];
    },

    async fetchEnrichment({ props = [] } = {}) {
      const out = new Map();
      const bySport = new Map();
      for (const prop of props) {
        const sport = String(prop.sport || '').toUpperCase();
        if (!LEAGUES[sport]) continue; // unsupported league: left un-enriched
        if (!bySport.has(sport)) bySport.set(sport, []);
        bySport.get(sport).push(prop);
      }
      if (!bySport.size) return out;

      const date = formatDate(now());
      const failures = [];

      for (const [sport, sportProps] of bySport) {
        const apiKey = keyFor(sport);
        if (!apiKey) continue;
        const league = LEAGUES[sport];
        let url;
        if (league.by === 'week') {
          // NFL is addressed by season and week, not by date. Resolve them from
          // the scores feed when the caller did not supply them; skip NFL
          // entirely rather than guess a week.
          let season = nflSeason;
          let week = nflWeek;
          if (!season || !week) {
            const timeframe = await resolveNflTimeframe(apiKey, { fetchImpl, timeoutMs });
            if (!timeframe) continue;
            season = timeframe.season;
            week = timeframe.week;
          }
          url = `${BASE}/${league.path}/projections/json/PlayerGameProjectionStatsByWeek/${encodeURIComponent(season)}/${encodeURIComponent(week)}`;
        } else {
          url = `${BASE}/${league.path}/projections/json/PlayerGameProjectionStatsByDate/${encodeURIComponent(date)}`;
        }

        let rows;
        try {
          rows = await request(url, apiKey, { fetchImpl, timeoutMs });
        } catch (error) {
          // One league failing must not lose the others.
          failures.push({ sport, code: error?.code || null, status: error?.status || null });
          continue;
        }

        const marketsBySportProp = new Map();
        for (const prop of sportProps) marketsBySportProp.set(enrichmentKey(prop), prop.market);

        for (const row of rows) {
          const key = enrichmentKey({ sport, playerName: row?.Name });
          if (!marketsBySportProp.has(key)) continue;
          const projection = projectionFor(sport, marketsBySportProp.get(key), row);
          const enrichment = {
            team: row?.Team || null,
            gameStartTime: row?.DateTime || null,
            injuryStatus: injuryStatusFor(row),
            isStarter: typeof row?.Started === 'number' ? row.Started > 0 : (row?.Started ?? null),
            expectedMinutes: toNumberOrNull(row?.Minutes),
            opponentRank: toNumberOrNull(row?.OpponentRank),
            liveStatus: liveStatusFor(row),
            // Used by enrich.mjs to reject a same-name player in another game.
            __opponent: row?.Opponent || null,
          };
          if (projection !== null) {
            enrichment.projection = projection;
            enrichment.projectionSource = 'SportsDataIO';
          }
          out.set(key, enrichment);
        }
      }

      if (failures.length && failures.length === bySport.size) {
        // Every league failed: surface it so the registry marks the provider
        // unavailable rather than silently reporting "connected, no data".
        throw Object.assign(new Error('SportsDataIO returned no usable feed'), {
          code: failures[0].code || 'PROVIDER_HTTP_ERROR',
        });
      }
      return out;
    },
  };
}
