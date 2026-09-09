import { sportsDataIoPropBoard } from '../lib/data-sources/sportsdataio/prop-board.mjs';
import { fetchTheOddsApiBoard, theOddsApiHealth } from './the-odds-api.mjs';

const text = (value) => String(value ?? '').trim();
const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function normalizeSportsDataIo(board, league) {
  const props = (board?.offers || []).map((o, i) => ({
    id: [league, o.gameId, o.playerId, o.market, o.sportsbookKey, o.side, o.line, i].join('|'),
    source: o.consensus ? 'SportsDataIO Consensus' : 'SportsDataIO',
    sport: text(o.sport || league).toUpperCase(),
    eventId: text(o.gameId),
    playerId: text(o.playerId),
    playerName: text(o.playerName),
    team: text(o.team),
    statId: '',
    marketId: text(o.bettingMarketId),
    market: text(o.market || 'Player Prop'),
    period: text(o.periodType || 'game'),
    side: text(o.side).toUpperCase(),
    line: num(o.line),
    price: '',
    impliedProbability: null,
    sportsbook: text(o.sportsbook || (o.consensus ? 'Consensus' : 'SportsDataIO')),
    sportsbookKey: text(o.sportsbookKey || (o.consensus ? 'consensus' : 'sportsdataio')).toLowerCase(),
    fairOdds: '',
    fairLine: null,
    gameStartTime: o.gameStartTime || null,
    homeTeam: text(o.homeTeam),
    awayTeam: text(o.awayTeam),
    homeScore: null,
    awayScore: null,
    live: false,
    started: false,
    completed: false,
    updatedAt: o.updatedAt || null,
    deeplink: '',
  })).filter(p => p.playerName && p.line !== null && (p.side === 'OVER' || p.side === 'UNDER'));

  const coverage = board?.coverage || [];
  const books = [...new Set(props.map(p => p.sportsbookKey).filter(Boolean))].sort();
  return {
    props,
    meta: {
      provider: 'SportsDataIO fallback',
      fetchedAt: board?.fetchedAt || new Date().toISOString(),
      latencyMs: board?.latencyMs ?? null,
      events: coverage.reduce((n, r) => n + Number(r?.gamesChecked || 0), 0),
      sportsbooks: books,
      sportsbookCount: books.length,
      propCount: props.length,
      liveEvents: 0,
      fullBookCoverage: false,
      regularLinesOnly: true,
    },
  };
}

async function fetchSportsDataIo(league, { force = false } = {}) {
  const board = await sportsDataIoPropBoard.fetchBoard({ sports: [league], force });
  return normalizeSportsDataIo(board, league);
}

export async function fetchUnifiedBoard(league, { signal, force = false } = {}) {
  const selected = text(league || 'NBA').toUpperCase();
  let oddsError = null;

  if (text(process.env.THE_ODDS_API_KEY)) {
    try {
      // Ignore force refreshes for the paid provider. The server-side adapter
      // decides when the quota-safe cache expires.
      return await fetchTheOddsApiBoard(selected, { signal, force: false });
    } catch (error) {
      oddsError = error;
    }
  }

  if (text(process.env.SPORTSDATAIO_API_KEY)) {
    try {
      const fallback = await fetchSportsDataIo(selected, { force });
      return {
        ...fallback,
        meta: {
          ...(fallback.meta || {}),
          preferredProvider: 'The Odds API',
          warning: oddsError
            ? `The Odds API is connected but unavailable: ${String(oddsError?.message || oddsError)}`
            : 'The Odds API key is not configured; using the legacy fallback.',
        },
      };
    } catch (fallbackError) {
      if (oddsError) throw oddsError;
      throw fallbackError;
    }
  }

  if (oddsError) throw oddsError;
  throw Object.assign(new Error('No sports data provider is configured'), { code: 'NO_PROVIDER' });
}

export function providerHealth() {
  const odds = theOddsApiHealth();
  return {
    theOddsApiConfigured: odds.configured,
    sportsGameOddsConfigured: Boolean(text(process.env.SPORTSGAMEODDS_API_KEY)),
    sportsDataIoConfigured: Boolean(text(process.env.SPORTSDATAIO_API_KEY)),
    preferredProvider: odds.configured ? 'The Odds API' : 'SportsDataIO fallback',
    regularLinesOnly: true,
    theOddsApi: odds,
    time: new Date().toISOString(),
  };
}
