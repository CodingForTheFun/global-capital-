import {
  normalizedEvent,
  normalizedPlayer,
  normalizedProp,
  normalizedBookmakerLine,
  numberOrNull,
  stableId,
} from '../../autoscout/models.mjs';
import { bookId, bookInfo } from '../../constants/books.mjs';

const text = (value) => String(value ?? '').trim();
const list = (value) => Array.isArray(value) ? value : [];
const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const iso = (value) => {
  const ms = Date.parse(text(value));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};
const slug = (value) => text(value).toLowerCase().replace(/[^a-z0-9]+/g, '');

const LEAGUE_TO_SPORT = Object.freeze({
  NFL: 'NFL',
  NBA: 'NBA',
  WNBA: 'WNBA',
  MLB: 'MLB',
  NHL: 'NHL',
  NCAAF: 'NCAAF',
  NCAAB: 'NCAAB',
  MLS: 'MLS',
  EPL: 'EPL',
  UEFA_CHAMPIONS_LEAGUE: 'UCL',
  ATP: 'TENNIS',
  WTA: 'TENNIS',
  ITF: 'TENNIS',
});

const MARKET_ALIASES = Object.freeze({
  // Basketball
  points: 'player_points',
  rebounds: 'player_rebounds',
  offensiverebounds: 'player_offensive_rebounds',
  defensiverebounds: 'player_defensive_rebounds',
  assists: 'player_assists',
  steals: 'player_steals',
  blocks: 'player_blocks',
  turnovers: 'player_turnovers',
  threepointersmade: 'player_threes',
  threepointersattempted: 'player_three_pointers_attempted',
  fieldgoalsmade: 'player_field_goals_made',
  fieldgoalsattempted: 'player_field_goals_attempted',
  freethrowsmade: 'player_free_throws_made',
  freethrowsattempted: 'player_free_throws_attempted',
  pointsreboundsassists: 'player_points_rebounds_assists',
  pointsrebounds: 'player_points_rebounds',
  pointsassists: 'player_points_assists',
  reboundsassists: 'player_rebounds_assists',
  blockssteals: 'player_blocks_steals',
  fantasyscore: 'player_fantasy_points',

  // Football
  passingyards: 'player_pass_yds',
  passingtouchdowns: 'player_pass_tds',
  passingattempts: 'player_pass_attempts',
  passingcompletions: 'player_pass_completions',
  passinginterceptions: 'player_pass_interceptions',
  completionpercentage: 'player_completion_percentage',
  passinglongestcompletion: 'player_longest_completion',
  rushingyards: 'player_rush_yds',
  rushingattempts: 'player_rush_attempts',
  rushingtouchdowns: 'player_rush_tds',
  rushinglongest: 'player_longest_rush',
  receivingyards: 'player_reception_yds',
  receivingreceptions: 'player_receptions',
  receptions: 'player_receptions',
  receivingtargets: 'player_targets',
  targets: 'player_targets',
  receivingtouchdowns: 'player_reception_tds',
  rushingreceivingyards: 'player_rush_reception_yds',
  passingrushingyards: 'player_pass_rush_yds',
  defensesacks: 'player_sacks',
  defensecombinedtackles: 'player_tackles_assists',
  defensesolotackles: 'player_solo_tackles',
  defenseassistedtackles: 'player_tackles_assists',
  kickingtotalpoints: 'player_kicking_points',
  puntingnumpunts: 'player_punts',
  puntingpuntsinside20: 'player_punts_inside_20',

  // Baseball
  battinghits: 'batter_hits',
  battingruns: 'batter_runs',
  battingrbi: 'batter_rbis',
  battingrunsbattedin: 'batter_rbis',
  battingtotalbases: 'batter_total_bases',
  battinghomeruns: 'batter_home_runs',
  battingdoubles: 'batter_doubles',
  battingsingles: 'batter_singles',
  battingtriples: 'batter_triples',
  battingstolenbases: 'batter_stolen_bases',
  battingbasesonballs: 'batter_walks',
  battingwalks: 'batter_walks',
  battingstrikeouts: 'batter_strikeouts',
  pitchingstrikeouts: 'pitcher_strikeouts',
  pitchinghits: 'pitcher_hits_allowed',
  pitchinghitsallowed: 'pitcher_hits_allowed',
  pitchingearnedruns: 'pitcher_earned_runs',
  pitchingbasesonballs: 'pitcher_walks',
  pitchingouts: 'pitcher_outs',
  pitchinginningspitched: 'pitcher_innings_pitched',
  pitchingpitchesthrown: 'pitcher_pitches',
  pitchingbattersfaced: 'pitcher_batters_faced',

  // Hockey
  shotsongoal: 'player_shots_on_goal',
  goals: 'player_goals',
  hockeyassists: 'player_assists',
  goaliesaves: 'player_saves',
  saves: 'player_saves',
  goaliegoalagainst: 'player_goals_against',
  goaliegoalsagainst: 'player_goals_against',
  powerplaypoints: 'player_power_play_points',
  blockedshots: 'player_blocked_shots',

  // Tennis
  aces: 'player_aces',
  acesallowed: 'player_aces_allowed',
  doublefaults: 'player_double_faults',
  gameswon: 'player_games_won',
  gameslost: 'player_games_lost',
  setswon: 'player_sets_won',
  setslost: 'player_sets_lost',
  breakpointswon: 'player_break_points_won',
  breakpointssaved: 'player_break_points_saved',
  breakpointsserved: 'player_break_points_served',
  breakpointsgivenup: 'player_break_points_given_up',
  pointswon: 'player_points_won',
  firstservepointswon: 'player_first_serve_points_won',
  secondservepointswon: 'player_second_serve_points_won',
  firstservepercent: 'player_first_serve_percentage',
  secondservepercent: 'player_second_serve_percentage',
  servicegameswon: 'player_service_games_won',
  returngameswon: 'player_return_games_won',
  returnpointswon: 'player_return_points_won',
  returnpointswonpercent: 'player_return_points_won_percentage',
});

const MARKET_COMPONENTS = Object.freeze({
  player_points_rebounds_assists: ['points', 'rebounds', 'assists'],
  player_points_rebounds: ['points', 'rebounds'],
  player_points_assists: ['points', 'assists'],
  player_rebounds_assists: ['rebounds', 'assists'],
  player_blocks_steals: ['blocks', 'steals'],
  player_rush_reception_yds: ['rushing_yards', 'receiving_yards'],
  player_pass_rush_yds: ['passing_yards', 'rushing_yards'],
});

const DIRECT_STAT_BY_MARKET = Object.freeze({
  player_points: 'points',
  player_rebounds: 'rebounds',
  player_offensive_rebounds: 'offensiveRebounds',
  player_defensive_rebounds: 'defensiveRebounds',
  player_assists: 'assists',
  player_steals: 'steals',
  player_blocks: 'blocks',
  player_turnovers: 'turnovers',
  player_threes: 'threePointersMade',
  player_three_pointers_attempted: 'threePointersAttempted',
  player_field_goals_made: 'fieldGoalsMade',
  player_field_goals_attempted: 'fieldGoalsAttempted',
  player_free_throws_made: 'freeThrowsMade',
  player_free_throws_attempted: 'freeThrowsAttempted',
  player_fantasy_points: 'fantasyScore',
  player_pass_yds: 'passing_yards',
  player_pass_tds: 'passing_touchdowns',
  player_pass_attempts: 'passing_attempts',
  player_pass_completions: 'passing_completions',
  player_pass_interceptions: 'passing_interceptions',
  player_completion_percentage: 'completion_percentage',
  player_longest_completion: 'passing_longestCompletion',
  player_rush_yds: 'rushing_yards',
  player_rush_attempts: 'rushing_attempts',
  player_rush_tds: 'rushing_touchdowns',
  player_longest_rush: 'rushing_longest',
  player_reception_yds: 'receiving_yards',
  player_receptions: 'receiving_receptions',
  player_targets: 'receiving_targets',
  player_reception_tds: 'receiving_touchdowns',
  player_sacks: 'defense_sacks',
  player_solo_tackles: 'defense_soloTackles',
  player_tackles_assists: 'defense_combinedTackles',
  player_field_goals: 'fieldGoals_made',
  player_kicking_points: 'kicking_totalPoints',
  player_punts: 'punting_numPunts',
  player_punts_inside_20: 'punting_puntsInside20',
  batter_hits: 'batting_hits',
  batter_runs: 'batting_runs',
  batter_rbis: 'batting_RBI',
  batter_total_bases: 'batting_totalBases',
  batter_home_runs: 'batting_homeRuns',
  batter_doubles: 'batting_doubles',
  batter_singles: 'batting_singles',
  batter_triples: 'batting_triples',
  batter_stolen_bases: 'batting_stolenBases',
  batter_walks: 'batting_basesOnBalls',
  batter_strikeouts: 'batting_strikeouts',
  pitcher_strikeouts: 'pitching_strikeouts',
  pitcher_hits_allowed: 'pitching_hits',
  pitcher_earned_runs: 'pitching_earnedRuns',
  pitcher_walks: 'pitching_basesOnBalls',
  pitcher_outs: 'pitching_outs',
  pitcher_innings_pitched: 'pitching_inningsPitched',
  pitcher_pitches: 'pitching_pitchesThrown',
  pitcher_batters_faced: 'pitching_battersFaced',
  player_shots_on_goal: 'shots_onGoal',
  player_goals: 'goals',
  player_saves: 'goalie_saves',
  player_goals_against: 'goalie_goalsAgainst',
  player_power_play_points: 'powerPlayPoints',
  player_blocked_shots: 'blocks',
  player_aces: 'aces',
  player_aces_allowed: 'acesAllowed',
  player_double_faults: 'doubleFaults',
  player_games_won: 'gamesWon',
  player_games_lost: 'gamesLost',
  player_sets_won: 'setsWon',
  player_sets_lost: 'setsLost',
  player_break_points_won: 'breakPointsWon',
  player_break_points_served: 'breakPointsServed',
  player_break_points_saved: 'breakPointsSaved',
  player_break_points_given_up: 'breakPointsGivenUp',
  player_points_won: 'pointsWon',
  player_first_serve_points_won: 'firstServePointsWon',
  player_second_serve_points_won: 'secondServePointsWon',
  player_first_serve_percentage: 'firstServePercent',
  player_second_serve_percentage: 'secondServePercent',
  player_service_games_won: 'serviceGamesWon',
  player_return_games_won: 'returnGamesWon',
  player_return_points_won: 'returnPointsWon',
  player_return_points_won_percentage: 'returnPointsWonPercent',
});

export function sportsGameOddsSportForLeague(leagueID, sportID = '') {
  const league = text(leagueID).toUpperCase();
  if (LEAGUE_TO_SPORT[league]) return LEAGUE_TO_SPORT[league];
  const sport = text(sportID).toUpperCase();
  if (sport === 'TENNIS') return 'TENNIS';
  if (sport === 'SOCCER') return 'SOCCER';
  return league || sport || null;
}

export function canonicalSportsGameOddsMarketKey(statID, sport = '') {
  const raw = text(statID);
  if (!raw) return null;
  const key = slug(raw);
  const selectedSport = String(sport).toUpperCase();
  if (['NFL','NCAAF'].includes(selectedSport) && key === 'fieldgoalsmade') return 'player_field_goals';
  if (selectedSport === 'NHL' && key === 'assists') return 'player_assists';
  if (selectedSport === 'NHL' && key === 'blocks') return 'player_blocked_shots';
  if (selectedSport === 'NHL' && key === 'points') return 'sgo_points';
  const known = MARKET_ALIASES[key];
  if (known) return known;
  const fallback = raw
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return fallback ? 'sgo_' + fallback.slice(0, 72) : null;
}

export function sportsGameOddsStatIdsForMarket(marketKey, marketName = '', sport = '') {
  const key = text(marketKey).toLowerCase();
  if (MARKET_COMPONENTS[key]) return [...MARKET_COMPONENTS[key]];
  if (DIRECT_STAT_BY_MARKET[key]) return [DIRECT_STAT_BY_MARKET[key]];
  const fromName = canonicalSportsGameOddsMarketKey(marketName, sport);
  if (fromName && MARKET_COMPONENTS[fromName]) return [...MARKET_COMPONENTS[fromName]];
  if (fromName && DIRECT_STAT_BY_MARKET[fromName]) return [DIRECT_STAT_BY_MARKET[fromName]];
  if (key.startsWith('sgo_')) return [key.slice(4)];
  return [];
}

function eventStart(event) {
  return iso(event?.status?.startsAt || event?.startTime || event?.startsAt || event?.scheduledAt);
}

function eventStatus(event) {
  const status = object(event?.status);
  if (status.cancelled === true) return 'CANCELLED';
  if (status.finalized === true || status.completed === true || status.ended === true) return 'FINAL';
  if (status.live === true || (status.started === true && status.ended !== true)) return 'LIVE';
  return 'SCHEDULED';
}

function teamData(event, side) {
  const row = object(event?.teams?.[side]);
  return {
    id: text(row.teamID || row.id),
    name: text(row.name || row.names?.display || row.names?.long || row.names?.short),
  };
}

function playerData(event, playerID) {
  const players = object(event?.players);
  const row = object(players[playerID]);
  const names = object(row.names);
  return {
    id: text(row.playerID || playerID),
    name: text(row.name || row.displayName || names.display || [names.firstName, names.lastName].filter(Boolean).join(' ')),
    teamID: text(row.teamID || row.team?.teamID || row.teamId),
    position: text(row.position || row.positionID || row.positionName),
  };
}

function playerTeam(player, home, away) {
  if (player.teamID && player.teamID === home.id) return home.name;
  if (player.teamID && player.teamID === away.id) return away.name;
  return '';
}

function impliedProbability(price) {
  const n = numberOrNull(price);
  if (n === null || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
}

function bookmakerName(id, row) {
  return text(row?.bookmakerName || row?.name || row?.title) || bookInfo(id).name || id;
}

function eventScores(event) {
  const results = object(event?.results);
  const game = object(results.game);
  const home = numberOrNull(game?.home?.points ?? game?.home ?? event?.teams?.home?.score ?? event?.status?.score?.home);
  const away = numberOrNull(game?.away?.points ?? game?.away ?? event?.teams?.away?.score ?? event?.status?.score?.away);
  return { home, away };
}

function flatRow({ event, player, prop, line, odd, book, home, away, ingestedAt }) {
  const scores = { home: numberOrNull(event?.homeScore), away: numberOrNull(event?.awayScore) };
  const status = text(event?.status).toUpperCase() || 'SCHEDULED';
  return {
    id: line.id,
    source: 'SportsGameOdds',
    provider: 'sportsgameodds',
    sport: prop.sport,
    eventId: event.id,
    providerEventId: event.providerEventId,
    sportsGameOddsEventId: event.providerEventId,
    playerId: player.id,
    providerPlayerId: player.providerPlayerId,
    sportsGameOddsPlayerId: player.providerPlayerId,
    playerName: player.name,
    team: player.team || '',
    position: player.position || '',
    entityType: 'player',
    statId: text(odd.statID),
    marketId: prop.marketKey,
    market: prop.marketName,
    period: prop.period,
    side: line.side,
    line: line.line,
    price: line.price,
    impliedProbability: line.impliedProbability,
    sportsbook: line.bookmakerName,
    sportsbookKey: line.bookmakerKey,
    fairOdds: numberOrNull(odd.fairOdds),
    fairLine: numberOrNull(odd.fairOverUnder),
    consensusLine: numberOrNull(odd.bookOverUnder),
    gameStartTime: event.commenceTime,
    homeTeam: home.name,
    awayTeam: away.name,
    homeScore: scores.home,
    awayScore: scores.away,
    live: status === 'LIVE',
    started: status === 'LIVE' || status === 'FINAL',
    completed: status === 'FINAL',
    isAlternate: prop.isAlternate === true,
    providerUpdatedAt: line.providerUpdatedAt || null,
    updatedAt: line.providerUpdatedAt || null,
    ingestedAt,
    deeplink: line.deeplink || '',
    sportsGameOddsOddId: text(odd.oddID) || null,
    sportsGameOddsBookmakerId: book || null,
  };
}

function makeLine({
  event,
  player,
  odd,
  bookmakerID,
  bookmaker,
  sport,
  marketKey,
  marketName,
  period,
  isAlternate,
  lineValue,
  price,
  providerUpdatedAt,
  deeplink,
  ingestedAt,
}) {
  const propId = isAlternate
    ? stableId(['prop', sport, event.id, player.id, marketKey, period, 'sgo-alt', lineValue])
    : stableId(['prop', sport, event.id, player.id, marketKey, period]);
  const prop = normalizedProp({
    id: propId,
    sport,
    league: sport,
    eventId: event.id,
    playerId: player.id,
    playerName: player.name,
    team: player.team,
    marketKey,
    marketName,
    period,
    isAlternate,
    provider: 'sportsgameodds',
    ingestedAt,
  });
  const side = text(odd.sideID).toUpperCase();
  const book = bookId(bookmakerID);
  const line = normalizedBookmakerLine({
    propId: prop.id,
    provider: 'sportsgameodds',
    bookmakerKey: book,
    bookmakerName: bookmakerName(book, bookmaker),
    side,
    line: lineValue,
    price,
    impliedProbability: impliedProbability(price),
    deeplink: deeplink || null,
    providerUpdatedAt,
    ingestedAt,
  });
  return { prop, line, book };
}

export function normalizeSportsGameOddsEvents(events = [], {
  requestedSport = '',
  includeAlternates = false,
  ingestedAt = new Date().toISOString(),
} = {}) {
  const normalizedEvents = new Map();
  const players = new Map();
  const props = new Map();
  const lines = new Map();
  const flat = [];
  const skipped = { teamMarket: 0, nonOu: 0, noPlayer: 0, noLine: 0, unavailable: 0, invalidSide: 0, cancelled: 0 };

  for (const rawEvent of list(events)) {
    const providerEventId = text(rawEvent?.eventID || rawEvent?.id);
    const requested = text(requestedSport).toUpperCase();
    const mappedSport = sportsGameOddsSportForLeague(rawEvent?.leagueID, rawEvent?.sportID);
    const sport = ['SOCCER','TENNIS'].includes(requested) ? requested : (mappedSport || requested);
    if (!providerEventId || !sport) continue;
    if (rawEvent?.status?.cancelled === true) { skipped.cancelled += 1; continue; }

    const home = teamData(rawEvent, 'home');
    const away = teamData(rawEvent, 'away');
    const start = eventStart(rawEvent);
    if (!start) continue;
    const scores = eventScores(rawEvent);
    const event = normalizedEvent({
      provider: 'sportsgameodds',
      providerEventId,
      sport,
      league: text(rawEvent?.leagueID).toUpperCase() || sport,
      homeTeam: home.name,
      awayTeam: away.name,
      commenceTime: start,
      status: eventStatus(rawEvent),
      homeScore: scores.home,
      awayScore: scores.away,
      providerUpdatedAt: iso(rawEvent?.updatedAt || rawEvent?.status?.updatedAt),
      ingestedAt,
    });
    event.sportsGameOddsEventId = providerEventId;
    if (home.id) event.homeTeamProviderId = home.id;
    if (away.id) event.awayTeamProviderId = away.id;
    normalizedEvents.set(event.id, event);

    for (const odd of Object.values(object(rawEvent?.odds))) {
      if (text(odd?.betTypeID).toLowerCase() !== 'ou') { skipped.nonOu += 1; continue; }
      const side = text(odd?.sideID).toLowerCase();
      if (!['over', 'under'].includes(side)) { skipped.invalidSide += 1; continue; }
      const entity = text(odd?.statEntityID);
      if (!entity || ['all', 'home', 'away'].includes(entity.toLowerCase())) { skipped.teamMarket += 1; continue; }

      const pdata = playerData(rawEvent, entity);
      if (!pdata.name) { skipped.noPlayer += 1; continue; }
      const player = normalizedPlayer({
        provider: 'sportsgameodds',
        providerPlayerId: pdata.id || entity,
        sport,
        name: pdata.name,
        team: playerTeam(pdata, home, away),
        position: pdata.position,
        ingestedAt,
      });
      player.sportsGameOddsPlayerId = pdata.id || entity;
      if (pdata.teamID) player.providerTeamId = pdata.teamID;
      players.set(player.id, player);

      const marketKey = canonicalSportsGameOddsMarketKey(odd?.statID, sport);
      if (!marketKey) continue;
      const marketName = text(odd?.marketName || odd?.statName || odd?.statID).replace(/\s+/g, ' ');
      const period = text(odd?.periodID || 'game').toLowerCase();
      const bookmakers = object(odd?.byBookmaker);

      for (const [bookmakerID, bookmaker] of Object.entries(bookmakers)) {
        if (bookmaker?.available === false) { skipped.unavailable += 1; continue; }
        const mainLine = numberOrNull(bookmaker?.overUnder ?? odd?.bookOverUnder ?? odd?.fairOverUnder);
        if (mainLine === null) { skipped.noLine += 1; continue; }
        try {
          const made = makeLine({
            event,
            player,
            odd,
            bookmakerID,
            bookmaker,
            sport,
            marketKey,
            marketName,
            period,
            isAlternate: false,
            lineValue: mainLine,
            price: bookmaker?.odds,
            providerUpdatedAt: iso(bookmaker?.lastUpdatedAt || odd?.lastUpdatedAt || rawEvent?.updatedAt),
            deeplink: text(bookmaker?.deeplink) || null,
            ingestedAt,
          });
          props.set(made.prop.id, made.prop);
          lines.set(made.line.id, made.line);
          flat.push(flatRow({ event, player, prop: made.prop, line: made.line, odd, book: made.book, home, away, ingestedAt }));
        } catch {}

        if (!includeAlternates) continue;
        for (const alt of list(bookmaker?.altLines)) {
          if (alt?.available === false) continue;
          const altLine = numberOrNull(alt?.overUnder);
          if (altLine === null || altLine === mainLine) continue;
          try {
            const made = makeLine({
              event,
              player,
              odd,
              bookmakerID,
              bookmaker,
              sport,
              marketKey,
              marketName,
              period,
              isAlternate: true,
              lineValue: altLine,
              price: alt?.odds,
              providerUpdatedAt: iso(alt?.lastUpdatedAt || bookmaker?.lastUpdatedAt || odd?.lastUpdatedAt),
              deeplink: text(alt?.deeplink || bookmaker?.deeplink) || null,
              ingestedAt,
            });
            props.set(made.prop.id, made.prop);
            lines.set(made.line.id, made.line);
            flat.push(flatRow({ event, player, prop: made.prop, line: made.line, odd, book: made.book, home, away, ingestedAt }));
          } catch {}
        }
      }
    }
  }

  const books = [...new Set(flat.filter((row) => row.isAlternate !== true).map((row) => row.sportsbookKey).filter(Boolean))].sort();
  return {
    props: flat,
    data: {
      events: [...normalizedEvents.values()],
      players: [...players.values()],
      props: [...props.values()],
      lines: [...lines.values()],
    },
    meta: {
      schemaVersion: 1,
      provider: 'SportsGameOdds',
      preferredProvider: 'PropLine',
      sport: text(requestedSport).toUpperCase() || null,
      fetchedAt: ingestedAt,
      ingestionTimestamp: ingestedAt,
      events: normalizedEvents.size,
      propCount: props.size,
      lineCount: lines.size,
      sportsbooks: books,
      sportsbookCount: books.length,
      regularLinesOnly: !includeAlternates,
      includesAlternates: includeAlternates,
      cacheHit: false,
      stale: false,
      skipped,
    },
  };
}
