import { sportsDataIoPropBoard } from '../lib/data-sources/sportsdataio/prop-board.mjs';
import { apexPage } from './ui/page.mjs';

const SPORTS = ['NFL','NBA','MLB','NHL','WNBA','NCAAF','NCAAB'];

function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, max-age=0',
    'content-length': Buffer.byteLength(body),
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

function propsFromBoard(board, sport) {
  return (board?.offers || []).map((offer, i) => ({
    id: [sport, offer.gameId, offer.bettingMarketId, offer.bettingOutcomeId, offer.sportsbookKey, i].filter(Boolean).join(':'),
    sport: offer.sport || sport,
    playerName: offer.playerName || null,
    playerId: offer.playerId ?? null,
    team: offer.team || null,
    market: offer.market || 'Player Prop',
    side: offer.side || 'OVER',
    line: Number.isFinite(Number(offer.line)) ? Number(offer.line) : null,
    sportsbook: offer.sportsbook || (offer.consensus ? 'Consensus' : 'SportsDataIO'),
    consensusSource: Boolean(offer.consensus),
    gameId: offer.gameId ?? null,
    gameStartTime: offer.gameStartTime ?? null,
    homeTeam: offer.homeTeam || null,
    awayTeam: offer.awayTeam || null,
    updatedAt: offer.updatedAt ?? null,
  })).filter((p) => p.playerName && p.market && p.line !== null && (p.side === 'OVER' || p.side === 'UNDER'));
}

export async function handleApexRequest(req, res, url) {
  const pathname = url.pathname;
  if (pathname === '/apex' || pathname === '/apex/') {
    const body = apexPage(SPORTS);
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(body),
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin',
      'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'",
    });
    res.end(body);
    return true;
  }
  if (pathname === '/api/apex/health' && req.method === 'GET') {
    return json(res, 200, { ok: true, app: 'apex-market-lab', provider: 'SportsDataIO', keyConfigured: Boolean(process.env.SPORTSDATAIO_API_KEY), time: new Date().toISOString() }), true;
  }
  if (pathname === '/api/apex/props' && req.method === 'GET') {
    const sport = String(url.searchParams.get('sport') || 'NFL').toUpperCase();
    if (!SPORTS.includes(sport)) return json(res, 400, { ok: false, error: 'Unsupported sport.' }), true;
    try {
      const board = await sportsDataIoPropBoard.fetchBoard({ sports: [sport], force: url.searchParams.get('force') === '1' });
      const coverage = Array.isArray(board?.coverage) ? board.coverage : [];
      const c = coverage[0] || {};
      const props = propsFromBoard(board, sport);
      return json(res, 200, {
        ok: true,
        props,
        meta: {
          sport,
          provider: 'SportsDataIO',
          fetchedAt: board?.fetchedAt || new Date().toISOString(),
          latencyMs: board?.latencyMs ?? null,
          gamesScanned: c.gamesChecked ?? 0,
          propCount: props.length,
          status: c.status ?? 0,
          warning: c.errorType && !props.length ? `SportsDataIO ${sport} feed: ${c.errorType}` : null,
        },
      }), true;
    } catch (error) {
      console.error('[Apex Market Lab] provider request failed', error?.message || error);
      return json(res, 503, { ok: false, error: 'SportsDataIO is temporarily unavailable for this board.', props: [] }), true;
    }
  }
  return false;
}
