// Player search and profile identity, from ESPN's public directory.
//
// Search answers "who is this?" for any player in a league the research card
// can read, so a customer can open a player who has no prop posted. It returns
// identity only - name, league, team and ESPN's athlete id - never a stat.
//
// The profile adds the fields the research card needs to frame a matchup:
// position, team abbreviation, and the next scheduled game with both teams
// and home/away, all as ESPN publishes them. Nothing is inferred; a field
// ESPN leaves out stays null.
import {PUBLIC_LEAGUES} from './stat-contract.mjs';

const SEARCH_TTL = 10 * 60_000;
const PROFILE_TTL = 10 * 60_000;
const MAX_ENTRIES = 500;

/** ESPN league slug -> this product's sport. Tennis tours map to TENNIS. */
const LEAGUE_SPORT = Object.freeze({
  nfl: 'NFL', 'college-football': 'NCAAF',
  nba: 'NBA', wnba: 'WNBA', 'mens-college-basketball': 'NCAAB',
  mlb: 'MLB', nhl: 'NHL',
  'usa.1': 'MLS', 'eng.1': 'EPL', 'uefa.champions': 'UCL',
  atp: 'TENNIS', wta: 'TENNIS',
});

export function sportForLeague(slug, family) {
  const key = String(slug || '').toLowerCase();
  if (LEAGUE_SPORT[key]) return LEAGUE_SPORT[key];
  // Other club competitions share the league-agnostic soccer board.
  return String(family || '').toLowerCase() === 'soccer' && key ? 'SOCCER' : null;
}

export function cleanQuery(value) {
  const q = String(value || '').normalize('NFKC').replace(/[^\p{L}\p{N}\s.'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return q.length >= 2 ? q : '';
}

const athleteId = uid => (String(uid || '').match(/~a:(\d{1,12})$/) || [])[1] || null;
const text = (value, max = 90) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);

/** Search payload -> players this product can research, in ESPN's order. */
export function playersFromSearch(payload, limit = 20) {
  const out = [], seen = new Set();
  for (const group of payload?.results || []) {
    if (group?.type !== 'player') continue;
    for (const c of group.contents || []) {
      const sport = sportForLeague(c?.defaultLeagueSlug, c?.sport);
      const id = athleteId(c?.uid);
      const name = text(c?.displayName);
      if (!sport || !id || !name) continue;
      const key = sport + ':' + id;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id, name, sport, league: String(c.defaultLeagueSlug).toLowerCase(), team: text(c.subtitle) });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** The next (or current) game from an athlete overview, as published. */
export function nextGameFrom(overview, teamAbbreviation) {
  const event = overview?.nextGame?.league?.events?.[0];
  if (!event) return null;
  const competitors = (event.competitors || []).filter(c => c && c.abbreviation);
  const home = competitors.find(c => c.homeAway === 'home'), away = competitors.find(c => c.homeAway === 'away');
  if (!home || !away) return null;
  const mine = [home, away].find(c => teamAbbreviation && c.abbreviation === teamAbbreviation) || null;
  const other = mine ? (mine === home ? away : home) : null;
  const startsAt = Number.isFinite(Date.parse(event.date)) ? new Date(event.date).toISOString() : null;
  return {
    eventId: /^\d{1,12}$/.test(String(event.id || '')) ? String(event.id) : null,
    startsAt,
    status: text(event.fullStatus?.type?.state || event.status, 12),
    homeTeam: home.abbreviation,
    awayTeam: away.abbreviation,
    opponent: other ? other.abbreviation : null,
    isHome: mine ? mine === home : null,
  };
}

export function createPlayerDirectory({ fetchImpl = (...args) => fetch(...args), now = () => Date.now() } = {}) {
  const cache = new Map(), pending = new Map();

  async function cached(key, ttl, load) {
    const hit = cache.get(key);
    if (hit && hit.expires > now()) return hit.value;
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      const value = await load();
      // Failures are remembered briefly so a flapping upstream is not hammered.
      cache.set(key, { value, expires: now() + (value?.ok === false ? 30_000 : ttl) });
      while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
      return value;
    })().finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  }

  async function json(url) {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(6000), headers: { accept: 'application/json' } });
    if (!r.ok) throw Error('ESPN ' + r.status);
    return r.json();
  }

  async function search(input) {
    const q = cleanQuery(input);
    if (!q) return { ok: true, available: false, code: 'QUERY_TOO_SHORT', players: [] };
    return cached('s|' + q.toLowerCase(), SEARCH_TTL, async () => {
      try {
        const payload = await json('https://site.web.api.espn.com/apis/search/v2?' + new URLSearchParams({ query: q, limit: '30', type: 'player' }));
        return { ok: true, available: true, query: q, players: playersFromSearch(payload) };
      } catch {
        return { ok: false, available: false, code: 'PLAYER_SEARCH_UNAVAILABLE', message: 'Player search could not load. Try again shortly.', players: [] };
      }
    });
  }

  async function profile(sportInput, idInput) {
    const sport = String(sportInput || '').toUpperCase(), id = String(idInput || '');
    if (!/^\d{1,12}$/.test(id) || !PUBLIC_LEAGUES[sport]?.[1]) return { ok: true, available: false, code: 'PROFILE_UNSUPPORTED' };
    const [family, league] = PUBLIC_LEAGUES[sport];
    return cached('p|' + sport + '|' + id, PROFILE_TTL, async () => {
      try {
        const base = `https://site.web.api.espn.com/apis/common/v3/sports/${family}/${league}/athletes/${id}`;
        const [bio, overview] = await Promise.all([json(base), json(base + '/overview').catch(() => null)]);
        const a = bio?.athlete;
        if (!a || String(a.id) !== id) return { ok: true, available: false, code: 'PLAYER_NOT_FOUND' };
        const team = text(a.team?.abbreviation, 12);
        return {
          ok: true, available: true, source: 'espn',
          player: {
            id, sport, name: text(a.displayName), position: text(a.position?.abbreviation, 8),
            team, teamName: text(a.team?.displayName), active: a.active !== false,
          },
          nextGame: nextGameFrom(overview, team),
        };
      } catch {
        return { ok: false, available: false, code: 'PROFILE_UNAVAILABLE', message: 'Player profile could not load. Try again shortly.' };
      }
    });
  }

  return { search, profile };
}

export const playerDirectory = createPlayerDirectory();
