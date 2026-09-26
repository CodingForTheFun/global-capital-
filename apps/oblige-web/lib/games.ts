// The Games tab: one row per game from the live scoreboard, opened into the
// game's verified context, its posted props and the news that names a team.
// Nothing here invents a game fact: a prop, a report or an article joins a
// game only when it names both teams (props, with the start time) or one
// team's full name (news); anything less is left out rather than guessed.
import type { PropGroup } from './types';
import { sameTeamLabel } from './opponent-options';

export type LiveGame = {
  id: string;
  gameId: string;
  sport: string;
  league: string | null;
  homeTeam: string;
  awayTeam: string;
  homeName: string;
  awayName: string;
  homeScore: number | string | null;
  awayScore: number | string | null;
  status: 'LIVE' | 'FINAL' | 'SCHEDULED';
  providerStatus: string | null;
  startTime: string | null;
  broadcast: string | null;
  venue: string | null;
  source: string | null;
};

/** Sports on the Games tab, in tab order, with the scoreboard key each reads. */
export const GAME_SPORTS: Array<{ id: string; label: string }> = [
  { id: 'NFL', label: 'NFL' },
  { id: 'NCAAF', label: 'CFB' },
  { id: 'NBA', label: 'NBA' },
  { id: 'WNBA', label: 'WNBA' },
  { id: 'NCAAB', label: 'CBB' },
  { id: 'MLB', label: 'MLB' },
  { id: 'NHL', label: 'NHL' },
  { id: 'SOCCER', label: 'Soccer' },
];

const SOCCER_LEAGUES = new Set(['MLS', 'EPL', 'UCL']);
const text = (value: unknown) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '');
const score = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = text(value);
  if (!raw) return null;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : raw;
};

/** One scoreboard row, or null when it lacks a game id, a sport or both teams. */
export function liveGame(raw: unknown): LiveGame | null {
  const game = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const sport = text(game.sport).toUpperCase();
  const gameId = text(game.gameId);
  const homeTeam = text(game.homeTeam), awayTeam = text(game.awayTeam);
  if (!sport || !gameId || !homeTeam || !awayTeam) return null;
  const status = text(game.status).toUpperCase();
  return {
    id: text(game.id) || sport + ':' + gameId,
    gameId,
    sport,
    league: text(game.league) || null,
    homeTeam,
    awayTeam,
    homeName: text(game.homeName) || homeTeam,
    awayName: text(game.awayName) || awayTeam,
    homeScore: score(game.homeScore),
    awayScore: score(game.awayScore),
    status: status === 'LIVE' || status === 'FINAL' ? status : 'SCHEDULED',
    providerStatus: text(game.providerStatus) || null,
    startTime: text(game.startTime) || null,
    broadcast: text(game.broadcast) || null,
    venue: text(game.venue) || null,
    source: text(game.source) || null,
  };
}

/**
 * The sport key the game-context route reads. Soccer needs its competition;
 * a game from a fallback feed (not ESPN) cannot be resolved to an ESPN game,
 * so it has none.
 */
export function contextSport(game: Pick<LiveGame, 'sport' | 'league' | 'source'>): string | null {
  if (game.source && game.source !== 'espn-public') return null;
  if (game.sport === 'SOCCER') return game.league && SOCCER_LEAGUES.has(game.league) ? game.league : null;
  return GAME_SPORTS.some((row) => row.id === game.sport) ? game.sport : null;
}

const START_TOLERANCE_MS = 30 * 60_000;

/**
 * The board props posted for this game: both teams must match, home and away
 * the same way round, and the prop's start within 30 minutes of the game's.
 * Two meetings of the same teams (a series, a doubleheader) stay apart by
 * start time; a prop with no start time is left out.
 */
export function propsForGame<T extends Pick<PropGroup, 'homeTeam' | 'awayTeam' | 'startsAt'>>(groups: T[], game: Pick<LiveGame, 'homeTeam' | 'awayTeam' | 'homeName' | 'awayName' | 'startTime'>): T[] {
  const start = Date.parse(game.startTime || '');
  if (!Number.isFinite(start)) return [];
  const same = (label: string | null | undefined, abbreviation: string, name: string) =>
    Boolean(label) && (sameTeamLabel(label, abbreviation) || sameTeamLabel(label, name));
  return groups.filter((group) => {
    const at = Date.parse(group.startsAt || '');
    return Number.isFinite(at) && Math.abs(at - start) <= START_TOLERANCE_MS
      && same(group.homeTeam, game.homeTeam, game.homeName)
      && same(group.awayTeam, game.awayTeam, game.awayName);
  });
}

export type GameArticle = { id: string; headline: string; description: string | null };

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Articles that name either team in full ("Buffalo Bills", not "Bills"): a
 * nickname alone can belong to another club or mean something else, and a
 * story about the wrong team is worse than no story.
 */
export function newsForGame<T extends GameArticle>(articles: T[], game: Pick<LiveGame, 'homeName' | 'awayName' | 'homeTeam' | 'awayTeam'>): T[] {
  const names = [game.homeName, game.awayName]
    .filter((name) => name && name !== game.homeTeam && name !== game.awayTeam && name.trim().split(/\s+/).length >= 2)
    .map((name) => new RegExp('(^|[^a-z0-9])' + escape(fold(name.trim())) + '([^a-z0-9]|$)'));
  if (!names.length) return [];
  return articles.filter((article) => {
    const body = fold(article.headline + ' ' + (article.description || ''));
    return names.some((pattern) => pattern.test(body));
  });
}

/** Live first, then upcoming by start, then finals newest first. */
export function orderGames(games: LiveGame[]): LiveGame[] {
  const rank = { LIVE: 0, SCHEDULED: 1, FINAL: 2 } as const;
  const time = (game: LiveGame) => Date.parse(game.startTime || '') || 0;
  return [...games].sort((a, b) => rank[a.status] - rank[b.status]
    || (a.status === 'FINAL' ? time(b) - time(a) : time(a) - time(b)));
}
