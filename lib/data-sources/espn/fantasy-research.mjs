import { backfillH2H } from './h2h-backfill.mjs';
import { fetchPublicResearch, PUBLIC_LEAGUES } from './research.mjs';
import { canonicalSport } from './stat-contract.mjs';
import { fantasyScoringMeta, fantasyScoringSupported, fantasySpec, scoreFantasyRow } from '../../props/fantasy-scoring.mjs';

const TTL_MS = 2 * 60 * 60_000;
const cache = new Map();
const pending = new Map();

const text = value => String(value ?? '').trim();
const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value
  : typeof value === 'string' && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim()) ? Number(value) : null;

function athleteId(history, sport) {
  const raw = text(history?.player?.providerPlayerId);
  const prefix = `history:${sport}:`;
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : null;
}

async function rawRequest(path, fetchImpl, now) {
  const hit = cache.get(path);
  if (hit && hit.expires > now()) return hit.value;
  if (pending.has(path)) return pending.get(path);
  const work = (async () => {
    try {
      const response = await fetchImpl(path, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
      if (!response.ok) return null;
      const value = await response.json();
      cache.set(path, { value, expires: now() + TTL_MS });
      while (cache.size > 1600) cache.delete(cache.keys().next().value);
      return value;
    } catch {
      return null;
    }
  })().finally(() => pending.delete(path));
  pending.set(path, work);
  return work;
}

function rawRows(payload) {
  const names = Array.isArray(payload?.names) ? payload.names : [];
  if (!names.length || new Set(names).size !== names.length) return new Map();
  const rows = new Map();
  for (const group of payload?.seasonTypes || []) {
    for (const category of group?.categories || []) {
      if (category?.type !== 'event') continue;
      for (const event of category?.events || []) {
        if (!event?.eventId || !Array.isArray(event.stats) || event.stats.length !== names.length) continue;
        rows.set(String(event.eventId), Object.fromEntries(names.map((name, index) => [name, event.stats[index]])));
      }
    }
  }
  return rows;
}

async function loadRawSeasons(history, spec, params, options) {
  const sport = canonicalSport(params.sport);
  const [family, league] = PUBLIC_LEAGUES[sport] || [];
  const id = athleteId(history, sport);
  if (!family || !id) return new Map();
  const fetchImpl = options.fetchImpl || ((...args) => fetch(...args));
  const now = options.now || (() => Date.now());
  const pathLeague = league || 'all';
  const seasons = [...new Set((history.gameLog || []).map(row => String(row?.season || '')).filter(Boolean))];
  const output = new Map();
  for (const season of seasons) {
    const query = new URLSearchParams({ season });
    if (spec.category) query.set('category', spec.category);
    const path = `https://site.web.api.espn.com/apis/common/v3/sports/${family}/${pathLeague}/athletes/${encodeURIComponent(id)}/gamelog?${query}`;
    const payload = await rawRequest(path, fetchImpl, now);
    for (const [eventId, values] of rawRows(payload)) output.set(`${sport.toLowerCase()}:${eventId}`, values);
  }
  return output;
}

function categoryFor(teamBox, name) {
  return (teamBox?.statistics || []).find(category => category?.name === name) || null;
}

function categoryValues(teamBox, name, id) {
  const category = categoryFor(teamBox, name);
  if (!category || !Array.isArray(category.keys)) return null;
  const athlete = (category.athletes || []).find(row => String(row?.athlete?.id || '') === String(id));
  if (!athlete) return Object.fromEntries(category.keys.map(key => [key, 0]));
  if (!Array.isArray(athlete.stats) || athlete.stats.length !== category.keys.length) return null;
  return Object.fromEntries(category.keys.map((key, index) => [key, athlete.stats[index]]));
}

function count(values, key) {
  if (!values || !Object.hasOwn(values, key)) return null;
  const value = values[key];
  if (String(value ?? '').trim() === '-') return 0;
  return numeric(value);
}

function allPlays(payload) {
  const values = [];
  if (Array.isArray(payload?.scoringPlays)) values.push(...payload.scoringPlays);
  for (const drive of payload?.drives?.previous || []) values.push(...(drive?.plays || []));
  if (payload?.drives?.current) values.push(...(payload.drives.current.plays || []));
  const unique = new Map();
  for (const play of values) unique.set(String(play?.id || `${play?.text || ''}|${play?.clock?.displayValue || ''}`), play);
  return [...unique.values()];
}

function offenseTeamId(play) {
  const participant = (play?.teamParticipants || []).find(row => row?.type === 'offense');
  return String(participant?.team?.id || play?.start?.team?.id || '');
}

function hasUnattributedRareScore(payload, teamId) {
  for (const play of allPlays(payload)) {
    const value = text(play?.text || play?.description).toLowerCase();
    if (!value) continue;
    // A field-goal return TD can be credited to the return team while the play's
    // possession metadata still names the kicking team, so any such play makes
    // the event unsafe to reconstruct from the box score alone.
    if (/field\s*goal.*(?:return|returned).*(?:touchdown|\btd\b)/i.test(value)) return true;
    if (offenseTeamId(play) !== String(teamId)) continue;
    if (/(?:two[- ]?point|2[- ]?(?:pt|point))\s+conversion/i.test(value)) return true;
    if (/fumble.*(?:recover|recovery).*(?:touchdown|\btd\b)/i.test(value)) return true;
  }
  return false;
}

function pair(value) {
  const match = String(value ?? '').trim().match(/^(\d+)\s*[\/-]\s*(\d+)$/);
  return match ? { made: Number(match[1]), attempts: Number(match[2]) } : null;
}

function madeFieldGoalDistances(payload, teamId) {
  const distances = [];
  for (const play of allPlays(payload)) {
    if (offenseTeamId(play) !== String(teamId) || play?.scoringPlay !== true) continue;
    const value = text(play?.text || play?.description);
    if (!/field\s*goal/i.test(value) || /miss|no\s+good|blocked/i.test(value)) continue;
    const match = value.match(/(\d{1,2})\s*(?:yard|yd)\b/i);
    if (match) distances.push(Number(match[1]));
  }
  return distances;
}

/**
 * Score one NFL/CFB summary for one exact ESPN athlete. Standard box-score
 * categories prove zeros when the athlete is absent from that category. Rare
 * scoring types that the box score does not attribute are fail-closed.
 */
export function scoreFootballSummaryForAthlete(payload, id, spec) {
  if (!payload?.boxscore?.players || !id || !spec) return null;
  if (spec.id === 'nfl_kicker') {
    for (const teamBox of payload.boxscore.players) {
      const kicking = categoryFor(teamBox, 'kicking');
      const athlete = (kicking?.athletes || []).find(row => String(row?.athlete?.id || '') === String(id));
      if (!athlete || !Array.isArray(kicking?.keys) || !Array.isArray(athlete.stats) || athlete.stats.length !== kicking.keys.length) continue;
      const values = Object.fromEntries(kicking.keys.map((key, index) => [key, athlete.stats[index]]));
      const fieldGoals = pair(values['fieldGoalsMade/fieldGoalAttempts']);
      const pats = pair(values['extraPointsMade/extraPointAttempts']);
      if (!fieldGoals || !pats) return null;
      const distances = madeFieldGoalDistances(payload, teamBox?.team?.id);
      if (distances.length !== fieldGoals.made) return null;
      const raw = {
        fieldGoal0to39: distances.filter(value => value <= 39).length,
        fieldGoal40to49: distances.filter(value => value >= 40 && value <= 49).length,
        fieldGoal50plus: distances.filter(value => value >= 50).length,
        patMade: pats.made,
        missedFieldGoal: fieldGoals.attempts - fieldGoals.made,
        missedPat: pats.attempts - pats.made,
      };
      if (raw.missedFieldGoal < 0 || raw.missedPat < 0) return null;
      return scoreFantasyRow({ started: true }, spec, raw);
    }
    return null;
  }

  for (const teamBox of payload.boxscore.players) {
    const names = ['passing','rushing','receiving','fumbles','kickReturns','puntReturns'];
    if (names.some(name => !categoryFor(teamBox, name))) continue;
    const categories = Object.fromEntries(names.map(name => [name, categoryValues(teamBox, name, id)]));
    if (Object.values(categories).some(value => value === null)) continue;
    const appears = names.some(name => (categoryFor(teamBox, name)?.athletes || []).some(row => String(row?.athlete?.id || '') === String(id)));
    if (!appears) continue;
    if (hasUnattributedRareScore(payload, teamBox?.team?.id)) return null;
    const raw = {
      passingYards: count(categories.passing, 'passingYards'),
      passingTouchdowns: count(categories.passing, 'passingTouchdowns'),
      interceptions: count(categories.passing, 'interceptions'),
      rushingYards: count(categories.rushing, 'rushingYards'),
      rushingTouchdowns: count(categories.rushing, 'rushingTouchdowns'),
      receptions: count(categories.receiving, 'receptions'),
      receivingYards: count(categories.receiving, 'receivingYards'),
      receivingTouchdowns: count(categories.receiving, 'receivingTouchdowns'),
      fumblesLost: count(categories.fumbles, 'fumblesLost'),
      returnTouchdowns: (count(categories.kickReturns, 'kickReturnTouchdowns') ?? 0) + (count(categories.puntReturns, 'puntReturnTouchdowns') ?? 0),
      twoPointConversions: 0,
      offensiveFumbleRecoveryTouchdowns: 0,
    };
    if (Object.values(raw).some(value => value === null)) return null;
    return scoreFantasyRow({ started: true }, spec, raw);
  }
  return null;
}

async function loadFootballSummaryScores(history, spec, params, options) {
  const sport = canonicalSport(params.sport);
  const [family, league] = PUBLIC_LEAGUES[sport] || [];
  const id = athleteId(history, sport);
  if (family !== 'football' || !league || !id) return new Map();
  const fetchImpl = options.fetchImpl || ((...args) => fetch(...args));
  const now = options.now || (() => Date.now());
  const rows = Array.isArray(history.gameLog) ? history.gameLog : [];
  const output = new Map();
  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      const eventId = String(row?.gameId || '').split(':').at(-1);
      if (!eventId) continue;
      const path = `https://site.api.espn.com/apis/site/v2/sports/${family}/${league}/summary?event=${encodeURIComponent(eventId)}`;
      const payload = await rawRequest(path, fetchImpl, now);
      const value = scoreFootballSummaryForAthlete(payload, id, spec);
      if (value !== null) output.set(row.gameId, value);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, rows.length || 1) }, worker));
  return output;
}

async function fetchProxyHistory(params, spec) {
  const candidates = spec.proxyCandidates || [{ market: spec.proxyMarket, providerMarketKey: spec.proxyMarketKey }];
  let last = null;
  for (const candidate of candidates) {
    const proxyParams = { ...params, ...candidate };
    const history = await fetchPublicResearch(proxyParams);
    last = { history, proxyParams };
    if (history?.available) return last;
  }
  return last || { history: null, proxyParams: params };
}

/**
 * Reconstruct fantasy-score history only for source + sport combinations whose
 * platform formula and required historical inputs are verified. `null` means
 * keep the normal line-only policy.
 */
export async function fetchFantasyResearch(params = {}, options = {}) {
  if (!fantasyScoringSupported(params)) return null;
  const spec = fantasySpec(params);
  const { history: initialHistory, proxyParams } = await fetchProxyHistory(params, spec);
  if (!initialHistory?.available) return { ...(initialHistory || {}), fantasyScoring: fantasyScoringMeta(spec) };

  // Do the deeper opponent walk on an ordinary measured stat first; the fantasy
  // conversion then applies only to those same verified event ids.
  const history = await backfillH2H(initialHistory, proxyParams, options);
  const football = spec.id === 'nfl_offense' || spec.id === 'ncaaf_offense' || spec.id === 'nfl_kicker';
  const values = football ? await loadFootballSummaryScores(history, spec, params, options) : await loadRawSeasons(history, spec, params, options);
  const scored = [];
  let excluded = 0;
  for (const row of history.gameLog || []) {
    const value = football ? (values.has(row.gameId) ? values.get(row.gameId) : null) : scoreFantasyRow(row, spec, values.get(row.gameId) || null);
    if (value === null) { excluded += 1; continue; }
    scored.push({ ...row, value, fantasyScore: value });
  }

  // Never relabel a shorter, silently-gapped set as L5/L10/L20. Exact fantasy
  // research is exposed only when every game in the verified source sample can
  // be reconstructed from the full platform formula.
  if (!scored.length || excluded > 0) {
    return {
      ok: true,
      available: false,
      lineOnly: true,
      retryable: false,
      code: 'FANTASY_COMPONENTS_INCOMPLETE',
      message: excluded
        ? 'Fantasy trend data is withheld because at least one historical game cannot be reconstructed from every scoring component required by this platform.'
        : 'Fantasy trend data is withheld because the exact historical scoring components were not returned.',
      gameLog: [],
      source: history.source,
      player: history.player,
      opponent: history.opponent,
      opponentId: history.opponentId,
      season: history.season,
      fantasyScoring: fantasyScoringMeta(spec),
      coverage: { ...(history.coverage || {}), fantasyGamesScored: scored.length, fantasyGamesExcluded: excluded },
    };
  }

  return {
    ...history,
    gameLog: scored,
    marketDisplayName: spec.label,
    statKind: `fantasy:${spec.id}`,
    fantasyScoring: fantasyScoringMeta(spec),
    coverage: { ...(history.coverage || {}), fantasyGamesScored: scored.length, fantasyGamesExcluded: 0 },
  };
}
