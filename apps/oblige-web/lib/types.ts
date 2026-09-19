/**
 * Shapes as the existing Oblige backend actually returns them.
 *
 * Every field is optional on purpose: /api/apex/props is a union of several
 * providers and the payload is sanitised on the way out, so the client must
 * degrade rather than assume. Nothing here changes a backend contract — these
 * are read-only descriptions of what already ships.
 */

export type Side = 'OVER' | 'UNDER';

/** One quote: a single book's price for one side of one player's line. */
export type PropRow = {
  id?: string;
  propId?: string;
  playerName?: string;
  providerPlayerId?: string;
  market?: string;
  marketId?: string;
  line?: number | string;
  side?: string;
  price?: number | string;
  sportsbook?: string;
  sportsbookKey?: string;
  team?: string;
  position?: string;
  opponent?: string;
  homeTeam?: string;
  awayTeam?: string;
  gameStartTime?: string;
  eventId?: string;
  live?: boolean;
  period?: string;
  entityType?: string;
  payoutType?: string;
  isAlternate?: boolean;
  stale?: boolean;
  suspended?: boolean;
  started?: boolean;
  completed?: boolean;
  requiresParlay?: boolean;
  lastSeenAt?: string;
  ingestedAt?: string;
  providerUpdatedAt?: string;
  updatedAt?: string;
};

export type BoardMeta = {
  provider?: string;
  warning?: string;
  sportsbookCount?: number;
  lineCount?: number;
  stale?: boolean;
  cacheHit?: boolean;
  fetchedAt?: string;
};

export type BoardResponse = {
  ok?: boolean;
  props?: PropRow[];
  meta?: BoardMeta;
  supportedSports?: string[];
  message?: string;
  code?: string;
};

/** Every quote for one player + market + line, which is what a card shows. */
export type PropGroup = {
  key: string;
  propId: string | null;
  player: string;
  providerPlayerId: string | null;
  market: string;
  marketId: string | null;
  line: number;
  sport: string;
  team: string | null;
  position: string | null;
  opponent: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  matchup: string;
  startsAt: string | null;
  live: boolean;
  quotes: PropRow[];
  bestOver: PropRow | null;
  bestUnder: PropRow | null;
};

/** One window of history — last 5, last 10, the season. */
export type ResearchWindow = {
  label?: string;
  games?: number | null;
  sampleSize?: number | null;
  average?: number | null;
  median?: number | null;
  volatility?: number | null;
  hits?: number | null;
  misses?: number | null;
  pushes?: number | null;
  hitRate?: number | null;
  available?: boolean;
  partial?: boolean;
  reason?: string;
};

export type GameLogRow = {
  gameId?: string;
  date?: string;
  opponent?: string;
  isHome?: boolean | null;
  value?: number | null;
  minutes?: number | null;
  season?: number | string | null;
  seasonType?: number | null;
  /** null means the game pushed, or that there is no line to compare against. */
  hit?: boolean | null;
  push?: boolean | null;
};

export type ResearchResponse = {
  ok?: boolean;
  available?: boolean;
  code?: string;
  message?: string;
  source?: string;
  fetchedAt?: string;
  cached?: boolean;
  player?: { playerName?: string; providerPlayerId?: string; team?: string | null };
  matchup?: {
    opponent?: string | null;
    isHome?: boolean | null;
    homeTeam?: string | null;
    awayTeam?: string | null;
  };
  market?: string;
  line?: number | null;
  side?: Side;
  season?: number | string | null;
  windows?: Record<string, ResearchWindow>;
  splits?: Record<string, ResearchWindow>;
  h2h?: ResearchWindow;
  streak?: { count?: number | null; type?: string | null } | number | null;
  diff?: number | null;
  gameLog?: GameLogRow[];
  coverage?: Record<string, unknown>;
};

export type LineHistoryPoint = {
  recordedAt?: string;
  capturedAt?: string;
  line?: number | null;
  price?: number | null;
  bookmakerKey?: string;
  side?: string;
};

export type LineHistoryResponse = {
  ok?: boolean;
  code?: string;
  message?: string;
  history?: LineHistoryPoint[];
  points?: LineHistoryPoint[];
};

export type Account = { id: string; email?: string } | null;
