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
  sportsGameOddsPlayerId?: string;
  sportsGameOddsEventId?: string;
  sportsGameOddsLeagueId?: string;
  statId?: string;
  market?: string;
  marketId?: string;
  line?: number | string;
  side?: string;
  price?: number | string;
  /** Market-level consensus/fair fields when the odds source supplies them. */
  impliedProbability?: number | string;
  fairOdds?: number | string;
  fairOddsAvailable?: boolean;
  fairLine?: number | string;
  fairOverUnder?: number | string;
  consensusLine?: number | string;
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
  /** PropLine DFS modifier metadata when the source exposes it. */
  specialType?: string;
  dfsOddsType?: string;
  payoutMultiplier?: number | string;
  lineGap?: number | string;
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
  sportsGameOddsPlayerId: string | null;
  sportsGameOddsEventId: string | null;
  sportsGameOddsLeagueId: string | null;
  sportsGameOddsStatId: string | null;
  market: string;
  marketId: string | null;
  line: number;
  sport: string;
  period: string | null;
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
  /** Verified public team directory for this league. Used only to populate the
   * opponent picker; it never creates history rows or changes hit rates. */
  leagueTeams?: Array<{ id?: string; abbreviation?: string; name?: string }>;
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

/** One player row in a published injury report or lineup. */
export type MatchupPlayer = {
  playerId?: string;
  playerName?: string;
  position?: string | null;
  status?: string;
  detail?: string | null;
  reportedAt?: string | null;
};

export type MatchupTeam = {
  teamId?: string;
  side?: 'home' | 'away';
  name?: string;
  abbreviation?: string;
  record?: string | null;
  rank?: number | null;
  injuries?: { available?: boolean; rows?: MatchupPlayer[] };
  lineup?: {
    available?: boolean;
    starters?: MatchupPlayer[];
    bench?: MatchupPlayer[];
    probables?: MatchupPlayer[];
  };
};

/** Game context from `/api/apex/research-matchup`. Unavailable answers carry
 * a sentence the UI prints verbatim instead of guessing. */
export type MatchupResponse = {
  ok?: boolean;
  available?: boolean;
  code?: string;
  message?: string;
  sport?: string;
  eventId?: string;
  gameStartTime?: string;
  source?: string;
  sourceUrl?: string;
  retrievedAt?: string;
  expiresAt?: string;
  pregame?: boolean;
  prediction?: {
    available?: boolean;
    homePercent?: number;
    awayPercent?: number;
    note?: string;
    message?: string;
    expiresAt?: string;
  };
  odds?: {
    available?: boolean;
    book?: string;
    homeMoneyline?: number | null;
    awayMoneyline?: number | null;
    spread?: string | null;
    total?: number | null;
    message?: string;
  };
  teams?: MatchupTeam[];
  venue?: { name?: string | null; city?: string | null; indoor?: boolean | null };
  weather?: { available?: boolean; temperature?: number; unit?: string; note?: string; message?: string };
};

export type LiveMoveType = 'line_movement' | 'steam' | 'market_suspended' | 'resolution';

/** One sanitised realtime market event from `/api/apex/live-moves`. */
export type LiveMove = {
  id?: string;
  type?: LiveMoveType | string;
  sport?: string | null;
  eventId?: string | null;
  homeTeam?: string | null;
  awayTeam?: string | null;
  bookmakerKey?: string | null;
  bookmakerTitle?: string | null;
  playerName?: string | null;
  marketKey?: string | null;
  marketDescription?: string | null;
  outcomeName?: string | null;
  dfsOddsType?: string | null;
  previous?: { price?: number | null; point?: number | null };
  current?: { price?: number | null; point?: number | null };
  priceChangePct?: number | null;
  resolution?: string | null;
  actualValue?: number | null;
  steamScore?: number | null;
  consensusDirection?: string | null;
  booksMoved?: number | null;
  booksQuoting?: number | null;
  booksAgreeing?: number | null;
  books?: string[];
  markets?: unknown[];
  occurredAt?: string | null;
  receivedAt?: string | null;
};

export type LiveMovesResponse = {
  ok?: boolean;
  events?: LiveMove[];
  summary?: {
    windowMinutes?: number;
    lineMovements?: number;
    steam?: number;
    marketSuspensions?: number;
    resolutions?: number;
  };
  trendingPlayers?: Array<{ sport?: string; playerName: string; signals: number }>;
  meta?: { connected?: boolean; lastEventAt?: string | null };
};
