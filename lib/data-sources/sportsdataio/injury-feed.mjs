// Injury report and depth chart, for the scenario sandbox.
//
// SportsDataIO is switched off globally: `AUTOSCOUT_DISABLE_SPORTSDATAIO` is
// set at the frontdoor and `client.mjs` refuses every request. That kill switch
// exists because the prop-board path through this provider was retired, and
// nothing here revives it — this module reads two endpoints and no others:
//
//   depthCharts  (scores tier)      — who a player's team-mates actually are
//   injuries     (projections tier) — which of them are hurt, and how badly
//
// It is off by default and opens only when AUTOSCOUT_INJURY_FEED=true and a key
// is present, so re-enabling the roster data is one environment variable and
// does not switch the retired board back on or spend on any other feed.
//
// `injuries` needs the projections entitlement. If the configured plan does not
// carry it, the request fails and this reports the teammates it does have with
// `injuryReport: false`, rather than pretending everyone is healthy.

import { BASE, LEAGUES } from './endpoints.mjs';
import { normalizePlayerName } from '../contract.mjs';

const INJURY_TTL_MS = 15 * 60_000;
const DEPTH_TTL_MS = 6 * 60 * 60_000;
const REQUEST_TIMEOUT_MS = 9_000;

const cache = new Map();
const inflight = new Map();

const text = (value) => String(value ?? '').trim();
const teamKey = (value) => text(value).toUpperCase().replace(/[^A-Z0-9]/g, '');

export function injuryFeedConfigured() {
  return process.env.AUTOSCOUT_INJURY_FEED === 'true' && Boolean(text(process.env.SPORTSDATAIO_API_KEY));
}

export function injuryFeedHealth() {
  return {
    enabled: process.env.AUTOSCOUT_INJURY_FEED === 'true',
    keyPresent: Boolean(text(process.env.SPORTSDATAIO_API_KEY)),
    configured: injuryFeedConfigured(),
    cached: cache.size,
  };
}

async function readFeed(path, ttl, { fetchImpl = (...args) => fetch(...args), now = () => Date.now() } = {}) {
  const hit = cache.get(path);
  if (hit && hit.expires > now()) return { ...hit.value, cached: true };
  if (inflight.has(path)) return inflight.get(path);

  const work = (async () => {
    let value = { ok: false, rows: [], status: 0 };
    try {
      const response = await fetchImpl(`${BASE}/${path}`, {
        headers: { 'Ocp-Apim-Subscription-Key': text(process.env.SPORTSDATAIO_API_KEY), accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const rows = response.ok ? await response.json().catch(() => null) : null;
      value = { ok: response.ok && Array.isArray(rows), rows: Array.isArray(rows) ? rows : [], status: response.status };
    } catch {
      // Generic absence only; no provider error text reaches a caller.
      value = { ok: false, rows: [], status: 0 };
    }
    // A failed read is held briefly so one outage does not become a request loop.
    cache.set(path, { value, expires: now() + (value.ok ? ttl : 5 * 60_000) });
    while (cache.size > 60) cache.delete(cache.keys().next().value);
    return value;
  })().finally(() => inflight.delete(path));

  inflight.set(path, work);
  return work;
}

function depthRows(rows, league) {
  // Depth charts arrive either flat or grouped by team depending on league.
  const out = [];
  for (const row of rows) {
    const entries = Array.isArray(row?.Offense) || Array.isArray(row?.Defense)
      ? [...(row.Offense || []), ...(row.Defense || [])]
      : [row];
    for (const entry of entries) {
      const name = text(entry?.Name || entry?.ShortName);
      if (!name) continue;
      out.push({
        playerName: name,
        team: teamKey(entry?.Team || row?.Team),
        position: text(entry?.Position || entry?.PositionCategory) || null,
        depthOrder: Number.isFinite(Number(entry?.DepthOrder)) ? Number(entry.DepthOrder) : null,
        league,
      });
    }
  }
  return out;
}

/**
 * Team-mates of one player, with injury status where the plan serves it.
 *
 * Returns `available: false` rather than an empty roster when the feed is off
 * or unreachable — an empty team-mate list and an unavailable feed are
 * different answers and the sandbox must not treat them the same.
 */
export async function teammatesFor({ sport, team, playerName } = {}, options = {}) {
  const league = LEAGUES[String(sport || '').toUpperCase()];
  if (!league) return { available: false, reason: 'UNSUPPORTED_LEAGUE', teammates: [], injuryReport: false };
  if (!injuryFeedConfigured()) return { available: false, reason: 'INJURY_FEED_DISABLED', teammates: [], injuryReport: false };

  const wantTeam = teamKey(team);
  if (!wantTeam) return { available: false, reason: 'TEAM_UNKNOWN', teammates: [], injuryReport: false };

  const depth = await readFeed(`${league.path}/scores/json/DepthCharts`, DEPTH_TTL_MS, options);
  if (!depth.ok) return { available: false, reason: 'DEPTH_CHART_UNAVAILABLE', teammates: [], injuryReport: false };

  const injuries = await readFeed(`${league.path}/projections/json/InjuredPlayers`, INJURY_TTL_MS, options);
  const injuryByName = new Map();
  for (const row of injuries.rows) {
    const name = normalizePlayerName(text(row?.Name));
    if (!name) continue;
    injuryByName.set(name, {
      status: text(row?.InjuryStatus) || null,
      bodyPart: text(row?.InjuryBodyPart) || null,
    });
  }

  const self = normalizePlayerName(playerName);
  const seen = new Set();
  const teammates = depthRows(depth.rows, String(sport).toUpperCase())
    .filter((row) => row.team === wantTeam && normalizePlayerName(row.playerName) !== self)
    .filter((row) => {
      const key = normalizePlayerName(row.playerName);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((row) => {
      const injury = injuryByName.get(normalizePlayerName(row.playerName)) || null;
      return { ...row, injuryStatus: injury?.status ?? null, injuryBodyPart: injury?.bodyPart ?? null };
    })
    .sort((a, b) => (a.depthOrder ?? 99) - (b.depthOrder ?? 99) || a.playerName.localeCompare(b.playerName))
    .slice(0, 24);

  return {
    available: true,
    teammates,
    // False when the plan does not carry the projections tier: the roster is
    // real, the health of it is simply unknown.
    injuryReport: injuries.ok,
    cached: Boolean(depth.cached && injuries.cached),
  };
}
