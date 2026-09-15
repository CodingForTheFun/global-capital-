import { researchOpponentMatches } from '../../analytics/research.mjs';
import { inspectGameLog, PUBLIC_LEAGUES } from './research.mjs';
import { canonicalSport, LEAGUE_AGNOSTIC, marketContract } from './stat-contract.mjs';

const TTL_MS = 2 * 60 * 60_000;
const MAX_PRIOR_SEASONS = 4;
const cache = new Map();
const pending = new Map();

const text = value => String(value ?? '').trim();

function athleteId(history, sport) {
  const raw = text(history?.player?.providerPlayerId);
  const prefix = `history:${sport}:`;
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : null;
}

async function load(path, fetchImpl, now) {
  const hit = cache.get(path);
  if (hit && hit.expires > now()) return hit.value;
  if (pending.has(path)) return pending.get(path);
  const work = (async () => {
    try {
      const response = await fetchImpl(path, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
      if (!response.ok) return null;
      const value = await response.json();
      cache.set(path, { value, expires: now() + TTL_MS });
      while (cache.size > 1200) cache.delete(cache.keys().next().value);
      return value;
    } catch {
      return null;
    }
  })().finally(() => pending.delete(path));
  pending.set(path, work);
  return work;
}

function hasMeeting(rows, matchup) {
  return (Array.isArray(rows) ? rows : []).some(row => researchOpponentMatches(row, matchup));
}

/**
 * Extend an already verified ESPN history only when H2H is genuinely missing.
 *
 * The normal research fetch keeps the current season plus at most one prior
 * season because that is enough for L5/L10/L20. NFL opponents can go four
 * seasons between meetings, so that optimization made real H2H history look
 * like N/A. This helper walks prior seasons in order, validates each response
 * through the same inspectGameLog contract, and stops as soon as a verified
 * meeting is present. No guessed opponent or synthetic game is ever added.
 */
export async function backfillH2H(history, params = {}, options = {}) {
  if (!history?.available || !Array.isArray(history.gameLog) || !history.gameLog.length) return history;
  const sport = canonicalSport(params.sport);
  const league = PUBLIC_LEAGUES[sport];
  const matchup = { opponent: history.opponent || params.opponent || null, opponentId: history.opponentId || null };
  if (!league || LEAGUE_AGNOSTIC.has(sport) || (!matchup.opponent && !matchup.opponentId)) return history;
  if (hasMeeting(history.gameLog, matchup)) return history;

  const id = athleteId(history, sport);
  const currentSeason = Number(history.season);
  const contract = marketContract({ ...params, sport });
  if (!id || !Number.isInteger(currentSeason) || currentSeason < 1900 || !contract) return history;

  const [family, leaguePath] = league;
  if (!family || !leaguePath) return history;
  const fetchImpl = options.fetchImpl || ((...args) => fetch(...args));
  const now = options.now || (() => Date.now());
  const seenSeasons = new Set(history.gameLog.map(row => Number(row?.season)).filter(Number.isInteger));
  let rows = history.gameLog.slice();
  let fetched = 0;

  for (let offset = 1; offset <= MAX_PRIOR_SEASONS && !hasMeeting(rows, matchup); offset++) {
    const season = currentSeason - offset;
    if (seenSeasons.has(season)) continue;
    const query = new URLSearchParams({ season: String(season) });
    if (contract.category) query.set('category', contract.category);
    const path = `https://site.web.api.espn.com/apis/common/v3/sports/${family}/${leaguePath}/athletes/${encodeURIComponent(id)}/gamelog?${query}`;
    const payload = await load(path, fetchImpl, now);
    if (!payload) continue;
    const inspected = inspectGameLog(payload, { ...params, sport, now: now() });
    if (String(inspected.season) !== String(season) || inspected.foreignLeagueEvents > 0) continue;
    const regular = inspected.rows.filter(row => Number(row.seasonType) === 2);
    if (!regular.length) continue;
    fetched += 1;
    seenSeasons.add(season);
    rows = [...rows, ...regular];
  }

  if (!fetched) return history;
  rows = [...new Map(rows.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0)).map(row => [row.gameId, row])).values()];
  const h2hGames = rows.filter(row => researchOpponentMatches(row, matchup)).length;
  return {
    ...history,
    gameLog: rows,
    coverage: { ...(history.coverage || {}), h2hHistoryBackfilled: h2hGames > 0, h2hBackfillSeasons: fetched },
  };
}
