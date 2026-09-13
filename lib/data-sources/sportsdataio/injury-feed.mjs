// Injury report and depth chart, for the scenario sandbox.
//
// SportsDataIO is switched off globally: `AUTOSCOUT_DISABLE_SPORTSDATAIO` is
// set at the frontdoor and `client.mjs` refuses every request. That kill switch
// exists because the prop-board path through this provider was retired, and
// nothing here revives it — this module reads the roster endpoints only:
//
//   teams        (scores tier)      — resolve provider-native team IDs
//   depthCharts  (scores / MLB projections tier)      — who a player's team-mates actually are
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
import { samePublicTeam } from '../espn/identity.mjs';

const INJURY_TTL_MS = 15 * 60_000;
const DEPTH_TTL_MS = 6 * 60 * 60_000;
const REQUEST_TIMEOUT_MS = 9_000;

const cache = new Map();
const inflight = new Map();

const text = (value) => String(value ?? '').trim();
const teamKey = (value) => text(value).replace(/^(?:nfl|nba|wnba|mlb|nhl|ncaaf|ncaab)_/i,'').toUpperCase().replace(/[^A-Z0-9]/g, '');
const numeric = value => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;

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

function depthRows(rows, league, teams) {
  const out = [];
  for (const row of rows) {
    const groups = ['Offense','Defense','SpecialTeams','DepthCharts'].filter(key => Array.isArray(row?.[key]));
    const entries = groups.length ? groups.flatMap(key => row[key]) : [row];
    for (const entry of entries) {
      const name = text(entry?.Name);
      if (!name || entry?.Active === false) continue;
      const teamId = numeric(entry?.TeamID ?? row?.TeamID);
      const mapped = teams.find(team => numeric(team.TeamID) === teamId);
      const team = teamId !== null ? teamKey(mapped?.Key) : teamKey(entry?.Team || row?.Team);
      if (!team) continue;
      out.push({playerId:text(entry?.PlayerID)||null,playerName:name,team,teamId,
        position:text(entry?.Position || entry?.PositionCategory)||null,depthOrder:numeric(entry?.DepthOrder),league});
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

  const selectedSport = String(sport).toUpperCase();
  const wantTeam = teamKey(team);
  if (!wantTeam) return { available:false,reason:'TEAM_UNKNOWN',teammates:[],injuryReport:false };
  // Native depth charts identify teams by TeamID, not abbreviation. MLB also
  // serves DepthCharts under projections, unlike NFL/NBA's scores endpoint.
  const [teamsFeed,depth] = await Promise.all([
    readFeed(`${league.path}/scores/json/Teams`,24*60*60_000,options),
    readFeed(`${league.path}/${selectedSport==='MLB'?'projections':'scores'}/json/DepthCharts`,DEPTH_TTL_MS,options),
  ]);
  if (!depth.ok || !teamsFeed.ok) return {available:false,reason:[depth.status,teamsFeed.status].some(s=>s===401||s===403)?'ROSTER_ACCESS_DENIED':'DEPTH_CHART_UNAVAILABLE',teammates:[],injuryReport:false};
  const teams = teamsFeed.rows.filter(t=>samePublicTeam(t.Key,team,selectedSport)||samePublicTeam([t.City,t.Name].filter(Boolean).join(' '),team,selectedSport));
  if (teams.length!==1) return {available:false,reason:'TEAM_UNKNOWN',teammates:[],injuryReport:false};
  const selectedTeam = teams[0], selectedId = numeric(selectedTeam.TeamID);
  if (selectedId===null) return {available:false,reason:'TEAM_UNKNOWN',teammates:[],injuryReport:false};
  const injuries = league.projections ? await readFeed(`${league.path}/projections/json/InjuredPlayers`,INJURY_TTL_MS,options) : {ok:false,rows:[]};
  const self = normalizePlayerName(playerName), seen = new Set();
  const teammates = depthRows(depth.rows,selectedSport,teamsFeed.rows)
    .filter(row=>(row.teamId!==null?row.teamId===selectedId:row.team===teamKey(selectedTeam.Key))&&normalizePlayerName(row.playerName)!==self)
    .filter(row=>{const key=row.playerId||normalizePlayerName(row.playerName);if(!key||seen.has(key))return false;seen.add(key);return true;})
    .map(row=>{
      const matches=injuries.rows.filter(injury=>{
        if (row.playerId&&text(injury.PlayerID)) return text(injury.PlayerID)===row.playerId;
        return (numeric(injury.TeamID)===selectedId||samePublicTeam(injury.Team,selectedTeam.Key,selectedSport))&&normalizePlayerName(injury.Name)===normalizePlayerName(row.playerName);
      });
      const injury=matches.length===1?matches[0]:null;
      return {...row,injuryStatus:text(injury?.InjuryStatus)||null,injuryBodyPart:text(injury?.InjuryBodyPart)||null};
    })
    .sort((a,b)=>(a.depthOrder??99)-(b.depthOrder??99)||a.playerName.localeCompare(b.playerName));

  return {
    available: true,
    teammates,
    // False when the plan does not carry the projections tier: the roster is
    // real, the health of it is simply unknown.
    injuryReport: injuries.ok,
    cached: Boolean(teamsFeed.cached && depth.cached && (!league.projections || injuries.cached)),
  };
}
