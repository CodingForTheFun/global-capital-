// MLB box-score facts for the global model: each batter's spot in the order
// and the throwing hand of the opposing starter, per game, from ESPN's
// completed box scores. Resolved-props games carry PropLine event ids, so
// each is found in the home team's ESPN schedule: exactly one completed game
// within three hours with the same opponent (the with/without join). A game
// that does not match is recorded as unmatched and never guessed.
//
// Season splits from ESPN are totals as of today and would leak later games
// into training rows, so they are not used; the model builds its own splits
// from these per-game facts, one game at a time.
import { scheduleMatch } from '../../data-sources/espn/teammates.mjs';
import { matchesTeamRecord } from '../../data-sources/espn/identity.mjs';
import { nameKey } from './observations.mjs';

const HOUR = 3600_000;
const list = (value) => (Array.isArray(value) ? value : []);
// Box scores say "RHP"; pre-game probables say { abbreviation: 'R', type: 'RIGHT' }.
const hand = (value) => {
  const raw = String((value && typeof value === 'object' ? value.abbreviation || value.type : value) || '');
  return /^L/i.test(raw) ? 'L' : /^R/i.test(raw) ? 'R' : null;
};

/** Lineup spots and starter hands from one completed box score, keyed by the PropLine team names. */
export function gameFacts(summary, home, away) {
  const competition = summary?.header?.competitions?.[0];
  if (competition?.status?.type?.completed !== true) return null;
  const facts = { starters: {}, lineup: {} };
  for (const [label, key] of [[home, nameKey(home)], [away, nameKey(away)]]) {
    const boxes = list(summary.boxscore?.players).filter((box) => matchesTeamRecord(label, box.team, 'MLB'));
    if (boxes.length !== 1) return null;
    for (const group of list(boxes[0].statistics)) {
      const kind = group.type || group.name;
      for (const row of list(group.athletes)) {
        const name = nameKey(row.athlete?.displayName);
        if (!name) continue;
        if (kind === 'pitching' && row.starter === true) facts.starters[key] = hand(row.athlete?.throws);
        if (kind === 'batting' && row.starter === true && Number.isInteger(row.batOrder) && row.batOrder >= 1 && row.batOrder <= 9) {
          facts.lineup[name] = { team: key, spot: row.batOrder };
        }
      }
    }
  }
  return Object.keys(facts.lineup).length ? facts : null;
}

export function createMlbEnricher({ request, teamDirectory }) {
  const prefix = '/site/v2/sports/baseball/mlb';
  async function schedule(teamId, season) {
    const pages = await Promise.all([2, 3].map((type) => request(`${prefix}/teams/${teamId}/schedule?season=${season}&seasontype=${type}`, 12 * HOUR)));
    return pages.flatMap((page) => list(page?.data?.events));
  }

  /** Facts for one resolved game { e, t, h, v }, or null when it cannot be matched exactly. */
  async function enrich(game) {
    if (!game?.h || !game?.v || !Number.isFinite(game.t)) return null;
    const teams = list(await teamDirectory('MLB')).filter((record) => matchesTeamRecord(game.h, record, 'MLB'));
    if (teams.length !== 1) return null;
    const events = await schedule(String(teams[0].id), new Date(game.t).getUTCFullYear());
    const id = scheduleMatch(events, { date: new Date(game.t).toISOString(), opponent: game.v }, game.h, 'MLB');
    if (!id) return null;
    const summary = await request(`${prefix}/summary?event=${id}`, 7 * 24 * HOUR);
    if (String(summary?.data?.header?.id) !== id) return null;
    return gameFacts(summary.data, game.h, game.v);
  }

  /**
   * The throwing hand of the probable starter facing `team` in its game near
   * `t`, from that game's ESPN summary. Null unless exactly one game on the
   * day's scoreboard has both teams within three hours of `t`.
   */
  async function opposingStarterHand({ team, opponent, t }) {
    if (!team || !opponent || !Number.isFinite(t)) return null;
    const day = new Date(t).toISOString().slice(0, 10).replaceAll('-', '');
    const board = await request(`${prefix}/scoreboard?dates=${day}`, 30 * 60_000);
    const fits = list(board?.data?.events).filter((event) => {
      const sides = list(list(event.competitions)[0]?.competitors);
      return sides.length === 2 && Math.abs(Date.parse(event.date || '') - t) <= 3 * HOUR
        && sides.some((side) => matchesTeamRecord(team, side.team, 'MLB')) && sides.some((side) => matchesTeamRecord(opponent, side.team, 'MLB'));
    });
    if (fits.length !== 1) return null;
    const summary = await request(`${prefix}/summary?event=${fits[0].id}`, 30 * 60_000);
    const sides = list(summary?.data?.header?.competitions?.[0]?.competitors);
    const theirs = sides.filter((side) => matchesTeamRecord(opponent, side.team, 'MLB'));
    if (theirs.length !== 1) return null;
    return hand(list(theirs[0].probables)[0]?.athlete?.throws);
  }

  return { enrich, opposingStarterHand };
}
