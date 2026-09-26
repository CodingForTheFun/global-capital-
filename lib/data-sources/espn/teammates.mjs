// Who played and who sat, per game, for a player's own team: the evidence
// behind with/without splits. Read from ESPN's completed box scores, which in
// basketball list every rostered player with an explicit did-not-play flag and
// reason. Football and hockey box scores leave inactive players out entirely,
// so "absent" cannot be told from "recorded no stat" there; those sports are
// not offered rather than guessed.
//
// Game-log rows usually come from another archive with its own event ids, so
// each row is found in the team's ESPN schedule. A row joins only when all of
// these hold, and is otherwise left out and counted:
//   - exactly one completed schedule game starts within 3 hours of the row,
//   - that game's other team is the row's opponent,
//   - its box score lists the team once and the player as having played
//     (a row with a recorded stat requires it).
import { PUBLIC_LEAGUES, canonicalSport } from './stat-contract.mjs';
import { matchesTeamRecord } from './identity.mjs';

export const TEAMMATE_SPORTS = new Set(['NBA', 'WNBA', 'NCAAB']);
export const MAX_TEAMMATE_GAMES = 40;
const HOUR = 3600_000;
const START_TOLERANCE_MS = 3 * HOUR;
const list = (value) => (Array.isArray(value) ? value : []);
const clean = (value, max = 80) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const fold = (value) => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const absent = (message) => ({ ok: true, available: false, message, games: [], unmatched: 0 });

function minutesOf(athlete, keys) {
  const index = list(keys).indexOf('minutes');
  if (index < 0) return null;
  const value = Number(list(athlete?.stats)[index]);
  return Number.isFinite(value) ? value : null;
}

/**
 * One game's participation for the named team, or null when the box score is
 * not complete, is for another game, or does not include that team exactly once.
 */
export function teamParticipation(summary, eventId, team, sport) {
  if (String(summary?.header?.id) !== String(eventId)) return null;
  const competition = summary.header?.competitions?.[0];
  if (competition?.status?.type?.completed !== true) return null;
  const boxes = list(summary.boxscore?.players).filter((box) => matchesTeamRecord(team, box.team, sport));
  if (boxes.length !== 1) return null;
  const group = list(boxes[0].statistics)[0];
  const athletes = list(group?.athletes)
    .map((row) => {
      const id = String(row.athlete?.id || '');
      if (!/^\d{1,12}$/.test(id)) return null;
      const played = row.didNotPlay === true ? false : list(row.stats).length > 0 ? true : null;
      if (played === null) return null;
      return {
        id,
        name: clean(row.athlete?.displayName),
        played,
        reason: played ? null : clean(row.reason, 60) || null,
        minutes: played ? minutesOf(row, group.keys) : 0,
      };
    })
    .filter(Boolean);
  if (!athletes.length) return null;
  return { eventId: String(eventId), date: clean(competition.date, 40) || null, athletes };
}

/** The one completed schedule game for a row, or null when none or several fit. */
export function scheduleMatch(events, row, team, sport) {
  const at = Date.parse(row.date || '');
  if (!Number.isFinite(at) || !row.opponent) return null;
  const fits = list(events).filter((event) => {
    const competition = list(event?.competitions)[0];
    if (!competition || competition.status?.type?.completed !== true) return false;
    if (Math.abs(Date.parse(event.date || competition.date || '') - at) > START_TOLERANCE_MS) return false;
    const sides = list(competition.competitors);
    const own = sides.filter((side) => matchesTeamRecord(team, side.team, sport));
    if (sides.length !== 2 || own.length !== 1) return false;
    const other = sides.find((side) => side !== own[0]);
    return matchesTeamRecord(row.opponent, other?.team, sport);
  });
  return fits.length === 1 ? String(fits[0].id) : null;
}

function playedIn(game, player) {
  const id = player?.id && /^\d{1,12}$/.test(player.id) ? player.id : null;
  const name = fold(player?.name);
  const rows = game.athletes.filter((athlete) => (id ? athlete.id === id : name && fold(athlete.name) === name));
  return rows.length === 1 && rows[0].played === true;
}

/** Season labels a date can fall under (basketball seasons that cross New Year carry the later year). */
function seasonsFor(dates, sport) {
  const out = new Set();
  for (const value of dates) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) continue;
    const year = date.getUTCFullYear();
    out.add(year);
    if (sport !== 'WNBA') out.add(year + 1);
  }
  return [...out].sort((a, b) => b - a).slice(0, 4);
}

export function createTeammates({ request, teamDirectory }) {
  return async (input) => {
    const sport = canonicalSport(input?.sport);
    if (!TEAMMATE_SPORTS.has(sport)) return absent('With/without splits need box scores that list players who did not play; this sport\'s do not.');
    const team = clean(input?.team, 60);
    const rows = list(input?.games)
      .map((row) => ({ key: clean(row?.key, 60), date: clean(row?.date, 40), opponent: clean(row?.opponent, 60), espnId: /^\d{1,12}$/.test(String(row?.espnId || '')) ? String(row.espnId) : null }))
      .filter((row) => row.key)
      .slice(0, MAX_TEAMMATE_GAMES);
    if (!team || !rows.length) return absent('A team and completed games are required.');
    const [family, league] = PUBLIC_LEAGUES[sport];
    const prefix = `/site/v2/sports/${family}/${league}`;

    // The team's schedule, for rows that do not already carry an ESPN id.
    let events = [];
    if (rows.some((row) => !row.espnId)) {
      const teams = typeof teamDirectory === 'function' ? await teamDirectory(sport) : [];
      const matches = list(teams).filter((record) => matchesTeamRecord(team, record, sport));
      if (matches.length !== 1) return absent('The team could not be matched to one ESPN team.');
      const teamId = String(matches[0].id);
      const seasons = seasonsFor(rows.map((row) => row.date), sport);
      const pages = await Promise.all(seasons.flatMap((season) => [2, 3].map((type) =>
        request(`${prefix}/teams/${teamId}/schedule?season=${season}&seasontype=${type}`, 12 * HOUR))));
      const seen = new Set();
      for (const page of pages) for (const event of list(page?.data?.events)) {
        if (!event?.id || seen.has(String(event.id))) continue;
        seen.add(String(event.id));
        events.push(event);
      }
    }

    const wanted = rows.map((row) => ({ ...row, eventId: row.espnId || scheduleMatch(events, row, team, sport) }));
    const queue = wanted.filter((row) => row.eventId);
    const games = [];
    async function worker() {
      while (queue.length) {
        const row = queue.shift();
        // Completed box scores do not change; a week-long cache keeps this cheap.
        const summary = await request(`${prefix}/summary?event=${row.eventId}`, 7 * 24 * HOUR);
        const game = summary?.data ? teamParticipation(summary.data, row.eventId, team, sport) : null;
        if (game && playedIn(game, input?.player)) games.push({ key: row.key, ...game });
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker));
    const unmatched = rows.length - games.length;
    if (!games.length) return { ...absent('None of these games could be matched to an ESPN box score.'), unmatched };
    return { ok: true, available: true, sport, team, source: 'ESPN box scores', requested: rows.length, unmatched, games };
  };
}
