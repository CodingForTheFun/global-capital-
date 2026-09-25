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
  /** Team result, score and starter flag, when the stats source records them. */
  gameResult?: 'W' | 'L' | 'T' | null;
  scoreFor?: number | null;
  scoreAgainst?: number | null;
  started?: boolean | null;
  opponentName?: string | null;
  /** Tennis, from a verified set score: the player's sets, the opponent's, and the format. */
  setsWon?: number | null;
  setsLost?: number | null;
  setsPlayed?: number | null;
  matchFormat?: 'BO3' | 'BO5' | null;
  /** Tennis match-level total games and this player's games won. */
  matchTotalGames?: number | null;
  gamesWon?: number | null;
  /** Tennis: the other player's value of this same statistic (PropLine opp_* mirror). */
  opponentValue?: number | null;
  /**
   * Client-side tags joined from separate verified sources before filtering.
   * Each stays null when its source cannot answer for that exact game.
   */
  opponentDefenseTier?: DefenseTier | null;
  /** Pre-match no-vig win probability (0-100) from the closing moneyline. */
  winProbability?: number | null;
  /** Tennis: the opponent's current singles ranking, playing hand and the court. */
  opponentRank?: number | null;
  opponentHand?: 'L' | 'R' | null;
  surface?: 'Hard' | 'Clay' | 'Grass' | 'Carpet' | null;
  indoor?: boolean | null;
};

export type TennisMatchContext = {
  opponentRank?: number | null;
  opponentHand?: 'L' | 'R' | null;
  surface?: 'Hard' | 'Clay' | 'Grass' | 'Carpet' | null;
  indoor?: boolean | null;
  paired?: boolean;
};

export type TennisContextResponse = {
  ok?: boolean;
  available?: boolean;
  message?: string;
  complete?: boolean;
  rankingsAsOf?: string | null;
  player?: { rank?: number | null; tour?: string | null };
  upcoming?: TennisMatchContext | null;
  matches?: Record<string, TennisMatchContext>;
};

export type MoneylineResponse = {
  ok?: boolean;
  available?: boolean;
  message?: string;
  events?: Record<string, { available?: boolean; winProbability?: number; books?: number; stale?: boolean; retryable?: boolean }>;
};

export type DefenseTier = 'soft' | 'average' | 'tough';

/** One team's allowance to one position for one stat, from `/api/apex/research-defense-position`. */
export type DefensePositionRow = {
  teamId?: string;
  position?: string;
  metric?: string;
  average?: number;
  games?: number;
  /** 1 = fewest allowed. Null until every team has enough games. */
  rank?: number | null;
  leagueSize?: number;
};

export type DefensePositionResponse = {
  ok?: boolean;
  available?: boolean;
  message?: string | null;
  sport?: string;
  positions?: string[];
  teams?: Array<{ id?: string; abbreviation?: string; name?: string }>;
  rows?: DefensePositionRow[];
  windowDays?: number;
  retrievedAt?: string;
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
  /** The raw statistic the game log's `value` holds, e.g. total_games or games_w. */
  statKind?: string | null;
  /** Verified provider context; only the fields the UI reads are typed. */
  context?: {
    sportradar?: { position?: string | null; primaryPosition?: string | null } | null;
    [key: string]: unknown;
  } | null;
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

export type BoardSavedFilters = {
  sort?: 'hit' | 'line' | 'name';
  hitWindow?: 'l5' | 'l10' | 'l15' | 'h2h' | 'streak';
  market?: string;
  team?: string;
  opponent?: string;
  book?: string;
  game?: string;
  date?: string;
  modifier?: string;
};

export type AccountPreferences = {
  boardFilters?: {
    activeSport?: string;
    bySport?: Record<string, BoardSavedFilters>;
  };
};

export type Account = { id: string; email?: string; csrfToken?: string } | null;

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
