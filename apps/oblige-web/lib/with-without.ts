// With/without splits: the player's verified games divided by whether a
// teammate played, from the box score of each exact game. A game joins only
// when its ESPN id matches a box score and the teammate is listed in it
// (a teammate traded in or out mid-season is simply not in those games);
// everything else is left out rather than guessed.
import type { GameLogRow } from './types';

export const WITH_WITHOUT_SPORTS = new Set(['NBA', 'WNBA', 'NCAAB']);

export type TeammateGame = {
  /** The game-log row's own id this box score was matched to. */
  key: string;
  eventId: string;
  athletes: Array<{ id: string; name: string; played: boolean; reason: string | null; minutes: number | null }>;
};

export type TeammateOption = { id: string; name: string; played: number; missed: number; minutes: number | null };

export type SplitSide = { games: number; average: number | null; hits: number; pushes: number };

/** The ESPN event id in a game-log row's own id ("wnba:401857217"), or null for another source. */
export function espnEventId(gameId: string | null | undefined, sport: string): string | null {
  const [prefix, id] = String(gameId || '').split(':');
  return prefix === String(sport).toLowerCase() && /^\d{1,12}$/.test(id || '') ? id : null;
}

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Teammates worth splitting on: listed in these games, and both played and
 * missed at least one. The player is excluded by ESPN id when known, else by
 * exact name. Heaviest minutes first, so the teammates who matter lead.
 */
export function teammateOptions(games: TeammateGame[], self: { id?: string | null; name?: string | null }): TeammateOption[] {
  const selfName = fold(self.name || '');
  const byId = new Map<string, { name: string; played: number; missed: number; minutes: number[] }>();
  for (const game of games) {
    for (const athlete of game.athletes) {
      if ((self.id && athlete.id === self.id) || (!self.id && selfName && fold(athlete.name) === selfName)) continue;
      const row = byId.get(athlete.id) || { name: athlete.name, played: 0, missed: 0, minutes: [] };
      if (athlete.played) {
        row.played += 1;
        if (typeof athlete.minutes === 'number') row.minutes.push(athlete.minutes);
      } else row.missed += 1;
      byId.set(athlete.id, row);
    }
  }
  return [...byId.entries()]
    .filter(([, row]) => row.played > 0 && row.missed > 0)
    .map(([id, row]) => ({
      id,
      name: row.name,
      played: row.played,
      missed: row.missed,
      minutes: row.minutes.length ? Math.round(row.minutes.reduce((a, b) => a + b, 0) / row.minutes.length) : null,
    }))
    .sort((a, b) => (b.minutes ?? -1) - (a.minutes ?? -1) || b.missed - a.missed);
}

function side(values: number[], line: number, over: boolean): SplitSide {
  const hits = values.filter((value) => (over ? value > line : value < line)).length;
  return {
    games: values.length,
    average: values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null,
    hits,
    pushes: values.filter((value) => value === line).length,
  };
}

/** The player's results in games the teammate played and games the teammate missed, joined by game-log id. */
export function withWithoutSplit(
  playerGames: Array<Pick<GameLogRow, 'gameId' | 'value'>>,
  games: TeammateGame[],
  teammateId: string,
  sport: string,
  line: number,
  over = true,
): { with: SplitSide; without: SplitSide; noBoxScore: number; notListed: number } {
  const byKey = new Map(games.map((game) => [game.key, game]));
  const withValues: number[] = [];
  const withoutValues: number[] = [];
  // A game with no matched box score, and one where the teammate is not on
  // the team's list (before a trade or signing, or after), are counted apart.
  let noBoxScore = 0;
  let notListed = 0;
  for (const game of playerGames) {
    const value = typeof game.value === 'number' && Number.isFinite(game.value) ? game.value : null;
    const box = game.gameId ? byKey.get(game.gameId) : undefined;
    const teammate = box?.athletes.find((athlete) => athlete.id === teammateId);
    if (value === null || !box) { noBoxScore += 1; continue; }
    if (!teammate) { notListed += 1; continue; }
    (teammate.played ? withValues : withoutValues).push(value);
  }
  return { with: side(withValues, line, over), without: side(withoutValues, line, over), noBoxScore, notListed };
}
