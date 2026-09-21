import {
  normalizedEvent,
  normalizedPlayer,
  normalizedProp,
  normalizedBookmakerLine,
  numberOrNull,
  stableId,
} from '../../autoscout/models.mjs';

const text = (value) => String(value ?? '').trim();
const list = (value) => Array.isArray(value) ? value : [];

const MARKET_KEYS = Object.freeze({
  NBA: Object.freeze({
    'sr:market:921': 'player_points',
    'sr:market:922': 'player_assists',
    'sr:market:923': 'player_rebounds',
    'sr:market:924': 'player_threes',
    'sr:market:8000': 'player_steals',
    'sr:market:8001': 'player_blocks',
    'sr:market:8002': 'player_turnovers',
    'sr:market:8003': 'player_points_rebounds',
    'sr:market:8004': 'player_points_assists',
    'sr:market:8005': 'player_rebounds_assists',
    'sr:market:8006': 'player_points_rebounds_assists',
    'sr:market:8007': 'player_blocks_steals',
  }),
  MLB: Object.freeze({
    'sr:market:925': 'pitcher_strikeouts',
    'sr:market:926': 'batter_total_bases',
    'sr:market:928': 'pitcher_earned_runs',
    'sr:market:9000': 'batter_hits',
    'sr:market:9001': 'batter_runs',
    'sr:market:9002': 'batter_rbis',
    'sr:market:9003': 'batter_home_runs',
  }),
});

function slug(value) {
  return text(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\(incl\.[^)]+\)/g, ' ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 72);
}

export function sportradarMarketKey(sport, market = {}) {
  const selected = text(sport).toUpperCase();
  const mapped = MARKET_KEYS[selected]?.[text(market?.id)];
  if (mapped) return mapped;

  const label = slug(market?.name);
  const aliases = {
    total_points: 'player_points',
    total_assists: 'player_assists',
    total_rebounds: 'player_rebounds',
    total_3_point_field_goals: 'player_threes',
    total_steals: 'player_steals',
    total_blocks: 'player_blocks',
    total_turnovers: 'player_turnovers',
    total_points_plus_rebounds: 'player_points_rebounds',
    total_points_plus_assists: 'player_points_assists',
    total_rebounds_plus_assists: 'player_rebounds_assists',
    total_points_plus_assists_plus_rebounds: 'player_points_rebounds_assists',
    total_points_plus_rebounds_plus_assists: 'player_points_rebounds_assists',
    total_blocks_plus_steals: 'player_blocks_steals',
    total_pitcher_strikeouts: 'pitcher_strikeouts',
    total_bases: 'batter_total_bases',
    total_earned_runs: 'pitcher_earned_runs',
    total_hits: 'batter_hits',
    total_runs: 'batter_runs',
    total_runs_batted_in: 'batter_rbis',
    total_home_runs_over_under_market_structure: 'batter_home_runs',
    total_passing_yards: 'player_pass_yds',
    total_passing_touchdowns: 'player_pass_tds',
    total_pass_attempts: 'player_pass_attempts',
    total_pass_completions: 'player_pass_completions',
    total_interceptions_thrown: 'player_pass_interceptions',
    total_rushing_yards: 'player_rush_yds',
    total_rushing_attempts: 'player_rush_attempts',
    total_rushing_touchdowns: 'player_rush_tds',
    total_receiving_yards: 'player_reception_yds',
    total_receptions: 'player_receptions',
    total_receiving_touchdowns: 'player_reception_tds',
    total_field_goals_made: 'player_field_goals',
    total_tackles_plus_assists: 'player_tackles_assists',
    total_sacks: 'player_sacks',
    total_shots_on_goal: 'player_shots_on_goal',
    total_saves: 'player_saves',
    total_goals: 'player_goals',
    total_power_play_points: 'player_power_play_points',
  };
  return aliases[label] || (label ? `player_${label.replace(/^total_/, '')}` : null);
}

function bookKey(book = {}) {
  const known = {
    fanduel: 'fanduel',
    draftkings: 'draftkings',
    betmgm: 'betmgm',
    mgm: 'betmgm',
    caesars: 'caesars',
    williamhill: 'caesars',
    williamhillus: 'caesars',
    betrivers: 'betrivers',
    fanatics: 'fanatics',
    hardrockbet: 'hardrock',
    bet365: 'bet365',
    espnbet: 'espnbet',
  };
  const compact = slug(book?.name).replace(/_/g, '');
  return known[compact] || slug(book?.name || book?.id);
}

function statusFlags(status) {
  const value = text(status).toLowerCase();
  const completed = ['ended', 'closed', 'complete', 'completed', 'final'].includes(value);
  const scheduled = ['', 'not_started', 'scheduled', 'created'].includes(value);
  return { completed, started: !scheduled, live: !scheduled && !completed };
}

function teamFor(player, competitors) {
  const id = text(player?.competitor_id);
  const team = list(competitors).find((row) => text(row?.id) === id);
  return text(team?.abbreviation || team?.name);
}

function eventTeams(competitors) {
  const home = list(competitors).find((row) => text(row?.qualifier).toLowerCase() === 'home');
  const away = list(competitors).find((row) => text(row?.qualifier).toLowerCase() === 'away');
  return {
    homeTeam: text(home?.abbreviation || home?.name),
    awayTeam: text(away?.abbreviation || away?.name),
  };
}

function impliedProbability(price) {
  const n = numberOrNull(price);
  if (n === null || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
}

function sideFromOutcome(outcome = {}) {
  const side = text(outcome?.type || outcome?.name).toLowerCase();
  if (side === 'over' || side === 'higher') return 'OVER';
  if (side === 'under' || side === 'lower') return 'UNDER';
  return null;
}

function eventContainers(payload) {
  if (!payload || typeof payload !== 'object') return [];
  for (const key of [
    'competition_sport_events_players_props',
    'sport_schedule_sport_events_players_props',
  ]) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  if (payload.sport_event_players_props && typeof payload.sport_event_players_props === 'object') {
    return [payload.sport_event_players_props];
  }
  return [];
}

export function normalizeSportradarPlayerProps(payload, {
  sport,
  fetchedAt = new Date().toISOString(),
} = {}) {
  const selected = text(sport).toUpperCase();
  const events = new Map();
  const players = new Map();
  const props = new Map();
  const lines = new Map();
  const flat = [];
  const skipped = {
    removed: 0,
    noSide: 0,
    noLine: 0,
    noPlayer: 0,
    noMarket: 0,
    noBook: 0,
  };

  for (const container of eventContainers(payload)) {
    const rawEvent = container?.sport_event || {};
    const providerEventId = text(rawEvent?.id);
    if (!providerEventId) continue;

    const competitors = list(rawEvent?.competitors);
    const teams = eventTeams(competitors);
    const flags = statusFlags(rawEvent?.status);
    const event = normalizedEvent({
      provider: 'sportradar',
      providerEventId,
      sport: selected,
      league: selected,
      homeTeam: teams.homeTeam,
      awayTeam: teams.awayTeam,
      commenceTime: rawEvent?.start_time || null,
      status: flags.completed ? 'FINAL' : flags.live ? 'LIVE' : 'SCHEDULED',
      providerUpdatedAt: payload?.generated_at || fetchedAt,
      ingestedAt: fetchedAt,
    });
    event.sportradarEventId = providerEventId;
    events.set(event.id, event);

    for (const group of list(container?.players_props)) {
      const rawPlayer = group?.player || {};
      const playerName = text(rawPlayer?.name);
      const providerPlayerId = text(rawPlayer?.id);
      if (!playerName || !providerPlayerId) {
        skipped.noPlayer += 1;
        continue;
      }

      const player = normalizedPlayer({
        provider: 'sportradar',
        providerPlayerId,
        sport: selected,
        name: playerName,
        team: teamFor(rawPlayer, competitors),
        ingestedAt: fetchedAt,
      });
      player.sportradarPlayerId = providerPlayerId;
      players.set(player.id, player);

      for (const market of list(group?.markets)) {
        const marketKey = sportradarMarketKey(selected, market);
        if (!marketKey) {
          skipped.noMarket += 1;
          continue;
        }
        const marketName = text(market?.name || marketKey);
        const prop = normalizedProp({
          sport: selected,
          league: selected,
          eventId: event.id,
          playerId: player.id,
          playerName: player.name,
          team: player.team,
          marketKey,
          marketName,
          period: 'game',
          provider: 'sportradar',
          ingestedAt: fetchedAt,
        });
        prop.sportradarMarketId = text(market?.id) || null;
        props.set(prop.id, prop);

        for (const book of list(market?.books)) {
          if (book?.removed === true) {
            skipped.removed += 1;
            continue;
          }
          const sportsbookKey = bookKey(book);
          if (!sportsbookKey) {
            skipped.noBook += 1;
            continue;
          }
          const sportsbook = text(book?.name || sportsbookKey);

          for (const outcome of list(book?.outcomes)) {
            if (outcome?.removed === true) {
              skipped.removed += 1;
              continue;
            }
            const side = sideFromOutcome(outcome);
            if (!side) {
              skipped.noSide += 1;
              continue;
            }
            const lineValue = numberOrNull(outcome?.total);
            if (lineValue === null) {
              skipped.noLine += 1;
              continue;
            }
            const price = numberOrNull(outcome?.odds_american);
            const line = normalizedBookmakerLine({
              propId: prop.id,
              provider: 'sportradar',
              bookmakerKey: sportsbookKey,
              bookmakerName: sportsbook,
              side,
              line: lineValue,
              price,
              impliedProbability: impliedProbability(price),
              providerUpdatedAt: payload?.generated_at || fetchedAt,
              ingestedAt: fetchedAt,
            });
            line.sportradarBookId = text(book?.id) || null;
            line.sportradarOutcomeId = text(outcome?.id) || null;
            line.sportradarExternalOutcomeId = text(outcome?.external_outcome_id) || null;
            line.sportradarExternalMarketId = text(book?.external_market_id) || null;
            line.sportradarExternalEventId = text(book?.external_sport_event_id) || null;
            line.openPrice = numberOrNull(outcome?.open_odds_american);
            line.openLine = numberOrNull(outcome?.open_total);
            line.trend = text(outcome?.trend) || null;
            lines.set(line.id, line);

            flat.push({
              id: line.id,
              source: 'Sportradar',
              provider: 'sportradar',
              sport: selected,
              eventId: event.id,
              providerEventId,
              sportradarEventId: providerEventId,
              playerId: player.id,
              providerPlayerId,
              sportradarPlayerId: providerPlayerId,
              playerName: player.name,
              entityType: 'player',
              team: player.team,
              position: player.position || '',
              statId: marketKey,
              marketId: marketKey,
              market: marketName,
              sportradarMarketId: prop.sportradarMarketId,
              period: 'game',
              side,
              line: line.line,
              price: line.price,
              impliedProbability: line.impliedProbability,
              sportsbook,
              sportsbookKey,
              sportradarBookId: line.sportradarBookId,
              sportradarOutcomeId: line.sportradarOutcomeId,
              externalOutcomeId: line.sportradarExternalOutcomeId,
              externalMarketId: line.sportradarExternalMarketId,
              externalEventId: line.sportradarExternalEventId,
              openPrice: line.openPrice,
              openLine: line.openLine,
              trend: line.trend,
              gameStartTime: event.commenceTime,
              homeTeam: event.homeTeam,
              awayTeam: event.awayTeam,
              live: market?.is_live === true || flags.live,
              started: flags.started,
              completed: flags.completed,
              isAlternate: false,
              providerUpdatedAt: payload?.generated_at || fetchedAt,
              updatedAt: fetchedAt,
              observedAt: fetchedAt,
              ingestedAt: fetchedAt,
              presenceSource: 'sportradar',
            });
          }
        }
      }
    }
  }

  return {
    props: flat,
    data: {
      events: [...events.values()],
      players: [...players.values()],
      props: [...props.values()],
      lines: [...lines.values()],
    },
    skipped,
  };
}

export function mergeSportradarBoards(parts = [], fetchedAt = new Date().toISOString()) {
  const props = new Map();
  const data = { events: new Map(), players: new Map(), props: new Map(), lines: new Map() };
  const skipped = { removed: 0, noSide: 0, noLine: 0, noPlayer: 0, noMarket: 0, noBook: 0 };

  for (const part of list(parts)) {
    for (const row of list(part?.props)) props.set(row.id || stableId([row.sport,row.eventId,row.playerId,row.marketId,row.sportsbookKey,row.side,row.line]), row);
    for (const key of ['events','players','props','lines']) {
      for (const row of list(part?.data?.[key])) data[key].set(row.id, row);
    }
    for (const key of Object.keys(skipped)) skipped[key] += Number(part?.skipped?.[key] || 0);
  }

  return {
    props: [...props.values()],
    data: Object.fromEntries(Object.entries(data).map(([key, map]) => [key, [...map.values()]])),
    skipped,
    fetchedAt,
  };
}
