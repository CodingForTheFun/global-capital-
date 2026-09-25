import type { GameLogRow, Side } from './types';

/**
 * "Other players vs <opponent>": the opponent's own verified matches, read from
 * the other side of the net. Only statistics that can be recovered exactly from
 * the opponent's row are offered. The source's own mirror of the other player's
 * value (opponentValue) is used when present; otherwise a match total is shared,
 * games won is the match total minus the opponent's games, and sets come from
 * the verified set score. When both exist and disagree the match is skipped.
 * Serve statistics (aces, double faults, break points) have no derivation, so
 * they appear only for matches where the source returned the mirror.
 */

export type FieldRow = {
  gameId: string;
  date: string | null;
  player: string;
  value: number;
  /** Result from the other player's side. */
  result: 'W' | 'L' | null;
  setScore: string | null;
  hit: boolean | null;
  push: boolean;
};

export type FieldSummary = {
  rows: FieldRow[];
  hits: number;
  decided: number;
  averageDiff: number | null;
  averageDiffPct: number | null;
};

const finite = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const clean = (value: unknown) =>
  String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Stat kinds whose other-side value can be recovered exactly. */
export const DERIVABLE_STATS = new Set(['total_games', 'games_w', 'sets_won']);

function derivedOtherSide(statKind: string | null | undefined, game: GameLogRow, value: number): number | null {
  if (statKind === 'total_games') return value;
  if (statKind === 'games_w') {
    const total = finite(game.matchTotalGames);
    return total !== null && total >= value ? total - value : null;
  }
  if (statKind === 'sets_won') {
    const lost = finite(game.setsLost);
    return lost !== null && finite(game.setsWon) === value ? lost : null;
  }
  return null;
}

export function otherSideValue(statKind: string | null | undefined, game: GameLogRow): number | null {
  const value = finite(game.value);
  if (value === null) return null;
  const mirror = finite(game.opponentValue);
  const derived = derivedOtherSide(statKind, game, value);
  if (mirror !== null && derived !== null && mirror !== derived) return null;
  return mirror ?? derived;
}

export function opponentField(
  games: GameLogRow[],
  statKind: string | null | undefined,
  player: string,
  line: number,
  side: Side,
): FieldSummary | null {
  if (!DERIVABLE_STATS.has(String(statKind || '')) && !games.some((game) => finite(game.opponentValue) !== null)) return null;
  const me = clean(player);
  const rows: FieldRow[] = [];
  for (const game of games) {
    const other = String(game.opponent ?? '').trim();
    // A match without a named other player, or against this player (that is
    // head-to-head, shown separately), is not part of the field.
    if (!other || clean(other) === me) continue;
    const value = otherSideValue(statKind, game);
    if (value === null) continue;
    const push = value === line;
    const hit = push ? null : side === 'UNDER' ? value < line : value > line;
    const result = game.gameResult === 'W' ? 'L' : game.gameResult === 'L' ? 'W' : null;
    const setScore = finite(game.setsWon) !== null && finite(game.setsLost) !== null ? `${game.setsLost}-${game.setsWon}` : null;
    rows.push({ gameId: String(game.gameId || rows.length), date: game.date || null, player: other, value, result, setScore, hit, push });
  }
  rows.sort((a, b) => (Date.parse(b.date || '') || 0) - (Date.parse(a.date || '') || 0));
  const decided = rows.filter((row) => row.hit !== null).length;
  const hits = rows.filter((row) => row.hit === true).length;
  const diffs = rows.map((row) => row.value - line);
  const averageDiff = diffs.length ? Math.round((diffs.reduce((a, b) => a + b, 0) / diffs.length) * 10) / 10 : null;
  const averageDiffPct = averageDiff !== null && line > 0 ? Math.round((averageDiff / line) * 1000) / 10 : null;
  return { rows, hits, decided, averageDiff, averageDiffPct };
}
