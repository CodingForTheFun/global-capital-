// A player profile is the research card for a player with no prop posted.
// It reuses the card's filters and verified history, with no posted line and
// no prices: the target line starts at the player's own recent median and is
// the customer's to move. Nothing here invents a line, a price or a stat.
import type { GameLogRow, PropGroup } from './types';
import { sameTeamLabel } from './opponent-options';

export type ProfileIdentity = {
  sport: string;
  name: string;
  /** ESPN athlete id, when the player came from search. */
  espnId?: string | null;
  team?: string | null;
  position?: string | null;
  nextGame?: {
    eventId?: string | null;
    startsAt?: string | null;
    status?: string | null;
    homeTeam?: string | null;
    awayTeam?: string | null;
    opponent?: string | null;
    isHome?: boolean | null;
  } | null;
};

const BASKETBALL = ['player_points', 'player_rebounds', 'player_assists', 'player_threes', 'player_points_rebounds_assists', 'player_points_rebounds', 'player_points_assists', 'player_rebounds_assists', 'player_steals', 'player_blocks', 'player_turnovers'];
const FOOTBALL = {
  QB: ['player_pass_yds', 'player_pass_tds', 'player_pass_completions', 'player_pass_attempts', 'player_pass_interceptions', 'player_rush_yds', 'player_rush_attempts', 'player_pass_rush_yds'],
  RB: ['player_rush_yds', 'player_rush_attempts', 'player_reception_yds', 'player_receptions', 'player_rush_reception_yds'],
  REC: ['player_reception_yds', 'player_receptions', 'player_reception_tds', 'player_rush_reception_yds'],
};
const BATTER = ['batter_hits', 'batter_total_bases', 'batter_home_runs', 'batter_rbis', 'batter_runs', 'batter_hits_runs_rbis', 'batter_walks', 'batter_strikeouts', 'batter_singles', 'batter_stolen_bases'];
const PITCHER = ['pitcher_strikeouts', 'pitcher_outs', 'pitcher_hits_allowed', 'pitcher_earned_runs'];
const SKATER = ['player_shots_on_goal', 'player_points', 'player_goals', 'player_assists', 'player_power_play_points'];
const SOCCER = ['player_shots', 'player_shots_on_target', 'player_goals', 'player_assists'];

/** The markets a profile offers, in board order, for the player's role. */
export function profileMarkets(sport: string, position?: string | null): string[] {
  const s = String(sport || '').toUpperCase();
  const p = String(position || '').toUpperCase();
  if (s === 'NBA' || s === 'WNBA' || s === 'NCAAB') return BASKETBALL;
  if (s === 'NFL' || s === 'NCAAF') {
    if (p === 'QB') return FOOTBALL.QB;
    if (p === 'RB' || p === 'FB') return FOOTBALL.RB;
    if (p === 'WR' || p === 'TE') return FOOTBALL.REC;
    return [...new Set([...FOOTBALL.QB, ...FOOTBALL.RB, ...FOOTBALL.REC])];
  }
  if (s === 'MLB') return p === 'SP' || p === 'RP' || p === 'P' ? PITCHER : BATTER;
  if (s === 'NHL') return p === 'G' ? ['player_total_saves'] : SKATER;
  if (s === 'MLS' || s === 'EPL' || s === 'UCL' || s === 'SOCCER') return SOCCER;
  return [];
}

/** Sports whose history the card can read with no posted prop. */
export function profileSupported(sport: string) {
  return profileMarkets(sport).length > 0;
}

/**
 * The starting target line: the median of the last ten verified games,
 * moved to the half point just above so a game cannot push. Null when there
 * is no verified game to start from.
 */
export function seedLine(games: GameLogRow[] | null | undefined): number | null {
  const values = [...(games || [])]
    .filter((game) => typeof game.value === 'number' && Number.isFinite(game.value))
    .sort((a, b) => (Date.parse(b.date || '') || 0) - (Date.parse(a.date || '') || 0))
    .slice(0, 10)
    .map((game) => game.value as number)
    .sort((a, b) => a - b);
  if (!values.length) return null;
  const mid = values.length / 2;
  const median = values.length % 2 ? values[Math.floor(mid)] : (values[mid - 1] + values[mid]) / 2;
  return Math.max(0.5, Math.floor(median) + 0.5);
}

// Accents and punctuation only. Suffixes stay: "Kenneth Walker" and "Kenneth
// Walker III" can be different people, and a borrowed prop is worse than none.
const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[.'’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Same person's name as a feed spells it ("Luka Doncic" = "Luka Dončić", "Jr." = "Jr"). */
export function samePlayerName(a: string | null | undefined, b: string | null | undefined) {
  const x = fold(String(a || '')), y = fold(String(b || ''));
  return Boolean(x) && x === y;
}

/** Every word of the query starts a word of the name ("jal bru" finds Jalen Brunson). */
export function nameMatchesQuery(name: string | null | undefined, query: string) {
  const words = fold(String(name || '')).split(' ');
  const terms = fold(query).split(' ').filter(Boolean);
  return terms.length > 0 && terms.every((term) => words.some((word) => word.startsWith(term)));
}

/**
 * A player's live props from the board. Once the searched player's team is
 * known (any of its labels), only props for that team count: several players
 * share a name, and another player's prop is never borrowed. With no team
 * known, every prop posted under the exact name counts.
 */
export function playerProps<T extends Pick<PropGroup, 'player' | 'team'>>(groups: T[], name: string, teams: Array<string | null | undefined> = []): T[] {
  const named = groups.filter((group) => samePlayerName(group.player, name));
  const labels = teams.filter((team): team is string => Boolean(team && team.trim()));
  if (!labels.length) return named;
  return named.filter((group) => labels.some((label) => sameTeamLabel(group.team, label)));
}

export function profileKey(identity: ProfileIdentity, market: string) {
  return ['profile', identity.sport.toUpperCase(), identity.espnId || identity.name, market].join(':');
}

/** A profile group: one market of a player's history with no posted prop. */
export function isProfileGroup(group: Pick<PropGroup, 'key'> | null | undefined) {
  return Boolean(group?.key?.startsWith('profile:'));
}

/** A research-card group for one market with no posted line and no quotes. */
export function profileGroup(identity: ProfileIdentity, market: string, line: number | null): PropGroup {
  const game = identity.nextGame || null;
  const home = game?.homeTeam || null, away = game?.awayTeam || null;
  return {
    key: profileKey(identity, market),
    propId: null,
    player: identity.name,
    // ESPN's athlete id in the form research already verifies: the history
    // lookup then accepts only this athlete, never a same-name player.
    providerPlayerId: identity.espnId && /^\d{1,12}$/.test(identity.espnId) ? 'history:' + identity.sport.toUpperCase() + ':' + identity.espnId : null,
    sportsGameOddsPlayerId: null,
    sportsGameOddsEventId: null,
    sportsGameOddsLeagueId: null,
    sportsGameOddsStatId: null,
    market,
    marketId: market,
    line: line ?? 0,
    sport: identity.sport.toUpperCase(),
    period: 'game',
    team: identity.team || null,
    position: identity.position || null,
    opponent: game?.opponent || null,
    homeTeam: home,
    awayTeam: away,
    matchup: home && away ? away + ' @ ' + home : identity.name,
    startsAt: game?.startsAt || null,
    live: game?.status === 'in',
    quotes: [],
    bestOver: null,
    bestUnder: null,
  };
}
