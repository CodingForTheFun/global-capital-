/** Pure adapters: no I/O, credentials, mutation of input, or fabricated odds.
 * The Odds API prices must be requested with oddsFormat=american.
 * updatedAt is Unix milliseconds; 0 means the source timestamp is unavailable.
 * Empty team/opponent strings mean unknown. IDs are provider-scoped, not a
 * cross-provider player matching service. Only regular full-game offers pass.
 */
export interface StandardizedProp {
  id: string;
  playerId: string;
  playerName: string;
  team: string;
  opponent: string;
  sport: 'nba' | 'mlb' | 'nfl' | 'nhl';
  market: 'points' | 'rebounds' | 'assists' | 'threes' | 'pra' | string;
  line: number;
  overOdds?: number;
  underOdds?: number;
  bookmaker: 'fanduel' | 'draftkings' | 'prizepicks' | 'underdog' | string;
  updatedAt: number;
}

type Row = Record<string, unknown>;
type Sport = StandardizedProp['sport'];
const object = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : [];
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const firstText = (...values: unknown[]): string => values.map(text).find(Boolean) || '';
const identifier = (value: unknown): string => text(value) || (typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : '');
const key = (value: unknown): string => text(value).toLowerCase().replace(/\+/g, '_').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const id = (...parts: (string | number)[]): string => JSON.stringify(parts);
const truthy = (value: unknown): boolean => value === true || value === 1 || value === 'true' || value === '1';
const falsy = (value: unknown): boolean => value === false || value === 0 || value === 'false' || value === '0';

function number(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()))) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? (Object.is(parsed, -0) ? 0 : parsed) : undefined;
}

function timestamp(...values: unknown[]): number {
  for (const value of values) {
    const numeric = number(value);
    if (numeric !== undefined) {
      const ms = numeric < 100_000_000_000 ? numeric * 1000 : numeric;
      if (ms > 0 && ms <= 8_640_000_000_000_000) return Math.trunc(ms);
    } else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
      const ms = Date.parse(value);
      if (Number.isFinite(ms) && ms > 0) return ms;
    }
  }
  return 0;
}

export const MARKET_NAME_MAP: Readonly<Record<string, string>> = Object.freeze({
  player_points:'points', points:'points', pts:'points',
  player_rebounds:'rebounds', rebounds:'rebounds', rebs:'rebounds', reb:'rebounds',
  player_assists:'assists', assists:'assists', ast:'assists', asts:'assists',
  player_threes:'threes', threes:'threes', three_pointers_made:'threes',
  '3_pointers_made':'threes', '3_pt_made':'threes', '3ptm':'threes', '3pm':'threes',
  player_points_rebounds_assists:'pra', points_rebounds_assists:'pra', pts_rebs_asts:'pra', pra:'pra',
  player_points_rebounds:'points_rebounds', pts_rebs:'points_rebounds',
  player_points_assists:'points_assists', pts_asts:'points_assists',
  player_rebounds_assists:'rebounds_assists', rebs_asts:'rebounds_assists',
  player_blocks:'blocks', blks:'blocks', player_steals:'steals', stls:'steals',
  player_turnovers:'turnovers', turnovers:'turnovers',
  player_pass_yds:'passing_yards', pass_yds:'passing_yards', passing_yards:'passing_yards',
  player_rush_yds:'rushing_yards', rush_yds:'rushing_yards', rushing_yards:'rushing_yards',
  player_reception_yds:'receiving_yards', rec_yds:'receiving_yards', receiving_yards:'receiving_yards',
  player_receptions:'receptions', receptions:'receptions',
  pitcher_strikeouts:'pitcher_strikeouts', pitching_strikeouts:'pitcher_strikeouts',
  batter_hits:'hits', hits:'hits', batter_total_bases:'total_bases', total_bases:'total_bases',
  batter_home_runs:'home_runs', home_runs:'home_runs',
  player_shots_on_goal:'shots_on_goal', shots_on_goal:'shots_on_goal', sog:'shots_on_goal',
  player_goals:'goals', goals:'goals', player_saves:'saves', goalie_saves:'saves',
});

/** Unknown markets retain their normalized name instead of being guessed. */
export function harmonizeMarketName(value: unknown): string {
  const normalized = key(value);
  return Object.prototype.hasOwnProperty.call(MARKET_NAME_MAP, normalized) ? MARKET_NAME_MAP[normalized]! : normalized;
}

function sportOf(...values: unknown[]): Sport | undefined {
  const sports: Record<string, Sport> = {nba:'nba', basketball_nba:'nba', mlb:'mlb', baseball_mlb:'mlb', nfl:'nfl', americanfootball_nfl:'nfl', nhl:'nhl', icehockey_nhl:'nhl'};
  for (const value of values) if (Object.prototype.hasOwnProperty.call(sports, key(value))) return sports[key(value)];
  return undefined;
}

function inactive(...values: Row[]): boolean {
  const blocked = new Set(['suspended','paused','locked','closed','inactive','disabled','unavailable','removed','cancelled','canceled','settled','final','completed']);
  return values.some(value =>
    ['suspended','is_suspended','isSuspended','paused','is_paused','isPaused','is_locked'].some(field => truthy(value[field])) ||
    ['active','is_active','isActive','available','is_available'].some(field => falsy(value[field])) ||
    ['status','state','status_display'].some(field => blocked.has(key(value[field]))));
}

function specialOffer(...values: Row[]): boolean {
  return values.some(value =>
    ['isPromo','isPromotional','isBoosted','isDiscounted','isAlternate','isTaco','is_promo','is_promotional','is_boosted','is_discounted','is_alternate','is_goblin','is_demon'].some(field => truthy(value[field])) ||
    ['odds_type','line_type','promotion_type','offer_type'].some(field => /(?:^|_)(?:goblin|demon|boosted|discounted|alternate|taco|promo)(?:_|$)/.test(key(value[field]))) ||
    Boolean(text(object(value.promotion).type)));
}

function fullGame(value: Row, market: string): boolean {
  const period = key(value.period);
  return (!period || ['game','full_game','full','match'].includes(period)) &&
    !/(?:^|_)(?:alternate|alternates|q[1-4]|h[12]|p[1-3]|1h|2h|1q|2q|3q|4q|first_half|second_half|first_quarter|second_quarter|third_quarter|fourth_quarter|first_period|second_period|third_period|1st_half|2nd_half|1st_quarter|2nd_quarter|3rd_quarter|4th_quarter)(?:_|$)/.test(market);
}

function bookmakerOf(value: unknown): string {
  const name = key(value);
  const aliases: Record<string,string> = {fan_duel:'fanduel', draft_kings:'draftkings', prize_picks:'prizepicks', underdog_fantasy:'underdog'};
  return Object.prototype.hasOwnProperty.call(aliases, name) ? aliases[name]! : name;
}

function teamName(value: unknown): string {
  const row = object(value), attributes = object(row.attributes);
  return firstText(value, row.abbreviation, attributes.abbreviation, row.name, attributes.name);
}

function opponentOf(team: string, home: string, away: string, explicit: unknown): string {
  const supplied = teamName(explicit);
  if (supplied && key(supplied) !== key(team)) return supplied;
  if (!team || !home || !away || key(home) === key(away)) return '';
  return key(team) === key(home) ? away : key(team) === key(away) ? home : '';
}

/** Native event object, event array, or {data: event|event[]} envelope.
 * Missing Odds API player IDs get explicitly synthetic event-scoped IDs.
 * These must never be treated as verified cross-provider player identities.
 */
export function normalizeTheOddsApi(rawPayload: any): StandardizedProp[] {
  const payload: unknown = rawPayload;
  const envelope = object(payload);
  const data = envelope.data ?? payload;
  const events = Array.isArray(data) ? rows(data) : [object(data)];
  const output = new Map<string, StandardizedProp>();
  for (const event of events) {
    const sport = sportOf(event.sport_key, event.sport, envelope.sport_key, envelope.sport);
    const eventId = identifier(event.id);
    if (!sport || !eventId || inactive(event)) continue;
    for (const book of rows(event.bookmakers)) {
      const bookmaker = bookmakerOf(firstText(book.key, book.title));
      if (!bookmaker || inactive(book)) continue;
      for (const market of rows(book.markets)) {
        const nativeMarket = key(market.key);
        const normalizedMarket = harmonizeMarketName(market.key);
        if (!normalizedMarket || inactive(market) || specialOffer(market) || !fullGame(market, nativeMarket)) continue;
        // Team moneylines, spreads and totals cannot become player props.
        if (!/^(?:player|batter|pitcher)_/.test(nativeMarket) && !Object.prototype.hasOwnProperty.call(MARKET_NAME_MAP, nativeMarket)) continue;
        const grouped = new Map<string, StandardizedProp>();
        for (const outcome of rows(market.outcomes)) {
          const side = key(outcome.name);
          const line = number(outcome.point);
          const player = object(outcome.player);
          const playerName = firstText(outcome.description, outcome.player_name, player.name);
          if ((side !== 'over' && side !== 'under') || line === undefined || !playerName || inactive(outcome) || specialOffer(outcome)) continue;
          if ([event.home_team, event.away_team].some(team => key(team) && key(team) === key(playerName))) continue;
          const team = teamName(outcome.team) || teamName(outcome.player_team) || teamName(player.team);
          const nativePlayerId = identifier(outcome.player_id) || identifier(player.id);
          const playerId = nativePlayerId ? id('the-odds-api', sport, nativePlayerId) : id('the-odds-api', 'unresolved', sport, eventId, playerName.normalize('NFC').toLowerCase());
          const propId = id('the-odds-api', sport, eventId, bookmaker, nativeMarket, playerId, line);
          const updatedAt = timestamp(outcome.last_update, market.last_update, book.last_update, event.last_update, envelope.timestamp);
          const prop = grouped.get(propId) || {
            id:propId, playerId, playerName, team,
            opponent:opponentOf(team, teamName(event.home_team), teamName(event.away_team), outcome.opponent),
            sport, market:normalizedMarket, line, bookmaker, updatedAt,
          };
          // Use the oldest known timestamp when sides differ; never imply both
          // prices are as fresh as only the most recently updated side.
          prop.updatedAt = Math.min(prop.updatedAt, updatedAt);
          if (!prop.team && team) {
            prop.team = team;
            prop.opponent = opponentOf(team, teamName(event.home_team), teamName(event.away_team), outcome.opponent);
          }
          const price = number(outcome.price);
          // American odds cannot have magnitude below 100. Missing/invalid odds
          // remain absent rather than manufacturing a payout for DFS platforms.
          if (price !== undefined && Number.isInteger(price) && Math.abs(price) >= 100) prop[side === 'over' ? 'overOdds' : 'underOdds'] = price;
          grouped.set(propId, prop);
        }
        // Duplicate snapshots replace as a whole, never mixing older sides.
        for (const [propId, prop] of grouped) {
          const previous = output.get(propId);
          if (!previous || prop.updatedAt >= previous.updatedAt) output.set(propId, prop);
        }
      }
    }
  }
  return [...output.values()];
}

/** JSON:API projections with type+id relationship resolution. Missing or
 * ambiguous player relationships are skipped instead of inventing identities.
 * PrizePicks multipliers are not sportsbook odds and are never mapped to odds.
 */
export function normalizePrizePicks(rawPayload: any): StandardizedProp[] {
  const payload = object(rawPayload);
  const projections = Array.isArray(payload.data) ? rows(payload.data) : [object(payload.data)];
  const index = new Map<string, Row | null>();
  for (const entity of [...rows(payload.included), ...projections]) {
    const type = text(entity.type), entityId = identifier(entity.id);
    if (!type || !entityId) continue;
    const identity = id(type, entityId);
    index.set(identity, index.has(identity) ? null : entity);
  }
  function related(entity: Row, ...names: string[]): Row {
    const relationships = object(entity.relationships);
    for (const name of names) {
      const reference = object(object(relationships[name]).data);
      const resolved = index.get(id(text(reference.type), identifier(reference.id)));
      if (resolved) return resolved;
    }
    return {};
  }
  const output = new Map<string, StandardizedProp>();
  for (const projection of projections) {
    if (!['projection','projections'].includes(key(projection.type))) continue;
    const projectionId = identifier(projection.id), attributes = object(projection.attributes);
    const player = related(projection, 'new_player', 'player');
    if (!['new_player','player','players'].includes(key(player.type))) continue;
    const playerAttributes = object(player.attributes), playerNativeId = identifier(player.id);
    const league = object(related(projection, 'league').attributes);
    const playerLeague = object(related(player, 'league').attributes);
    const sport = sportOf(league.name, league.abbreviation, playerLeague.name, playerLeague.abbreviation, attributes.league, attributes.sport, playerAttributes.league, playerAttributes.sport);
    const line = number(attributes.line_score);
    const playerName = firstText(playerAttributes.name, playerAttributes.display_name);
    const rawMarket = firstText(attributes.stat_type, object(related(projection, 'stat_type').attributes).name);
    const market = harmonizeMarketName(rawMarket);
    if (!projectionId || !playerNativeId || !sport || !playerName || line === undefined || !market) continue;
    const game = related(projection, 'game'), gameAttributes = object(game.attributes);
    if (inactive(projection, attributes, playerAttributes, gameAttributes) || specialOffer(projection, attributes) || !fullGame(attributes, key(rawMarket))) continue;
    const team = teamName(playerAttributes.team) || teamName(related(player, 'team'));
    const explicitOpponent = teamName(attributes.opponent) || teamName(playerAttributes.opponent) || teamName(related(projection, 'opponent'));
    const home = teamName(gameAttributes.home_team) || teamName(related(game, 'home_team'));
    const away = teamName(gameAttributes.away_team) || teamName(related(game, 'away_team'));
    const prop: StandardizedProp = {
      id:id('prizepicks', projectionId), playerId:id('prizepicks', sport, playerNativeId),
      playerName, team, opponent:opponentOf(team, home, away, explicitOpponent), sport, market, line,
      bookmaker:'prizepicks', updatedAt:timestamp(attributes.updated_at, attributes.updatedAt, object(payload.meta).updated_at),
    };
    const previous = output.get(prop.id);
    if (!previous || prop.updatedAt >= previous.updatedAt) output.set(prop.id, prop);
  }
  return [...output.values()];
}
