import { sportsDataIoPropBoard } from '../lib/data-sources/sportsdataio/prop-board.mjs';

const SGO_BASE = 'https://api.sportsgameodds.com/v2';
const DEFAULT_TTL_MS = 20_000;
const MAX_PAGES = 4;
const LIMIT = 25;
const cache = new Map();

const BOOK_NAMES = Object.freeze({
  draftkings: 'DraftKings', fanduel: 'FanDuel', betmgm: 'BetMGM', caesars: 'Caesars',
  espnbet: 'ESPN BET', fanatics: 'Fanatics', bet365: 'Bet365', pinnacle: 'Pinnacle',
  prizepicks: 'PrizePicks', underdog: 'Underdog', sleeper: 'Sleeper', bovada: 'Bovada',
  williamhill: 'William Hill', pointsbet: 'PointsBet', unibet: 'Unibet', circa: 'Circa',
});

function text(v) { return String(v ?? '').trim(); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function bool(v) { return v === true; }
function displayBook(key) {
  const clean = text(key).toLowerCase();
  return BOOK_NAMES[clean] || clean.replace(/[_-]+/g, ' ').replace(/\b\w/g, m => m.toUpperCase()) || 'Sportsbook';
}
function playerName(event, id) {
  const p = event?.players?.[id] || event?.players?.find?.(x => x?.playerID === id) || null;
  return text(p?.names?.long || p?.names?.full || p?.name || p?.displayName || p?.fullName || id.replace?.(/_/g, ' '));
}
function teamForPlayer(event, id) {
  const p = event?.players?.[id] || event?.players?.find?.(x => x?.playerID === id) || null;
  return text(p?.teamID || p?.team?.teamID || p?.team?.names?.short || p?.team || '');
}
function teamName(team, fallback = '') {
  return text(team?.names?.long || team?.names?.medium || team?.names?.short || team?.name || fallback);
}
function startsAt(event) {
  return event?.info?.startsAt || event?.startTime || event?.startsAt || event?.status?.startsAt || null;
}
function updatedAt(bookRow, odd, event) {
  return bookRow?.lastUpdatedAt || bookRow?.updatedAt || odd?.lastUpdatedAt || odd?.updatedAt || event?.updatedAt || null;
}
function normalizeMarketName(odd) {
  const raw = text(odd?.marketName || odd?.statID || 'Player Prop');
  return raw.replace(/[_-]+/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
}
function isPlayerEntity(id) {
  const v = text(id).toLowerCase();
  return Boolean(v && !['all','home','away','yes','no'].includes(v));
}

function normalizeEvents(events, league) {
  const out = [];
  const seen = new Set();
  for (const event of events || []) {
    const eventId = text(event?.eventID);
    const homeTeam = teamName(event?.teams?.home, event?.teams?.home?.teamID);
    const awayTeam = teamName(event?.teams?.away, event?.teams?.away?.teamID);
    const live = bool(event?.status?.started) && !bool(event?.status?.completed) && !bool(event?.status?.ended);
    const homeScore = num(event?.results?.homeScore ?? event?.status?.homeScore ?? event?.teams?.home?.score);
    const awayScore = num(event?.results?.awayScore ?? event?.status?.awayScore ?? event?.teams?.away?.score);
    const odds = event?.odds && typeof event.odds === 'object' ? Object.values(event.odds) : [];
    for (const odd of odds) {
      if (text(odd?.betTypeID).toLowerCase() !== 'ou') continue;
      if (!isPlayerEntity(odd?.statEntityID)) continue;
      const side = text(odd?.sideID).toUpperCase();
      if (side !== 'OVER' && side !== 'UNDER') continue;
      const playerId = text(odd?.playerID || odd?.statEntityID);
      const name = playerName(event, playerId);
      if (!name) continue;
      const byBookmaker = odd?.byBookmaker && typeof odd.byBookmaker === 'object' ? odd.byBookmaker : {};
      for (const [sportsbookKey, row] of Object.entries(byBookmaker)) {
        if (!row || row.available === false) continue;
        const line = num(row.overUnder ?? row.line ?? odd?.bookOverUnder ?? odd?.fairOverUnder);
        if (line === null) continue;
        const key = [eventId, playerId, odd?.oddID, sportsbookKey, side, line].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          id: key,
          source: 'SportsGameOdds',
          sport: text(event?.leagueID || league).toUpperCase(),
          eventId,
          playerId,
          playerName: name,
          team: teamForPlayer(event, playerId),
          statId: text(odd?.statID),
          marketId: text(odd?.oddID),
          market: normalizeMarketName(odd),
          period: text(odd?.periodID || 'game'),
          side,
          line,
          price: text(row?.odds || row?.price || ''),
          sportsbook: displayBook(sportsbookKey),
          sportsbookKey: text(sportsbookKey).toLowerCase(),
          fairOdds: text(odd?.fairOdds || ''),
          fairLine: num(odd?.fairOverUnder),
          gameStartTime: startsAt(event),
          homeTeam,
          awayTeam,
          homeScore,
          awayScore,
          live,
          started: bool(event?.status?.started),
          completed: bool(event?.status?.completed) || bool(event?.status?.ended),
          updatedAt: updatedAt(row, odd, event),
          deeplink: text(row?.deeplink || row?.deepLink || event?.links?.bookmakers?.[sportsbookKey] || ''),
        });
      }
    }
  }
  return out;
}

async function fetchJson(url, headers, signal) {
  const res = await fetch(url, { headers, signal });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    const err = new Error(body?.error || `SportsGameOdds request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}

async function fetchSportsGameOdds(league, { signal, force = false } = {}) {
  const apiKey = text(process.env.SPORTSGAMEODDS_API_KEY);
  if (!apiKey) throw Object.assign(new Error('SPORTSGAMEODDS_API_KEY is not configured'), { code: 'NOT_CONFIGURED' });
  const cacheKey = `sgo:${league}`;
  const cached = cache.get(cacheKey);
  if (!force && cached && Date.now() - cached.at < DEFAULT_TTL_MS) return cached.value;

  const events = [];
  let cursor = null;
  const started = Date.now();
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ leagueID: league, oddsAvailable: 'true', limit: String(LIMIT) });
    if (cursor) params.set('cursor', cursor);
    const body = await fetchJson(`${SGO_BASE}/events?${params.toString()}`, { 'x-api-key': apiKey, accept: 'application/json' }, signal);
    events.push(...(Array.isArray(body.data) ? body.data : []));
    cursor = body.nextCursor || null;
    if (!cursor) break;
  }
  const props = normalizeEvents(events, league);
  const books = [...new Set(props.map(p => p.sportsbookKey).filter(Boolean))].sort();
  const value = {
    props,
    meta: {
      provider: 'SportsGameOdds',
      fetchedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      events: events.length,
      sportsbooks: books,
      sportsbookCount: books.length,
      propCount: props.length,
      liveEvents: new Set(props.filter(p => p.live).map(p => p.eventId)).size,
      freshnessSeconds: DEFAULT_TTL_MS / 1000,
      fullBookCoverage: true,
    },
  };
  cache.set(cacheKey, { at: Date.now(), value });
  return value;
}

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
      provider: 'SportsDataIO',
      fetchedAt: board?.fetchedAt || new Date().toISOString(),
      latencyMs: board?.latencyMs ?? null,
      events: coverage.reduce((n, r) => n + Number(r?.gamesChecked || 0), 0),
      sportsbooks: books,
      sportsbookCount: books.length,
      propCount: props.length,
      liveEvents: 0,
      freshnessSeconds: 30,
      fullBookCoverage: false,
    },
  };
}

async function fetchSportsDataIo(league, { force = false } = {}) {
  const board = await sportsDataIoPropBoard.fetchBoard({ sports: [league], force });
  return normalizeSportsDataIo(board, league);
}

function dedupe(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = [row.sport, row.eventId, row.playerName.toLowerCase(), row.market.toLowerCase(), row.period, row.side, row.line, row.sportsbookKey].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export async function fetchUnifiedBoard(league, { signal, force = false } = {}) {
  const selected = text(league || 'NBA').toUpperCase();
  let primary = null;
  let primaryError = null;
  if (text(process.env.SPORTSGAMEODDS_API_KEY)) {
    try { primary = await fetchSportsGameOdds(selected, { signal, force }); }
    catch (err) { primaryError = err; }
  }

  let fallback = null;
  let fallbackError = null;
  if (text(process.env.SPORTSDATAIO_API_KEY)) {
    try { fallback = await fetchSportsDataIo(selected, { force }); }
    catch (err) { fallbackError = err; }
  }

  if (!primary && !fallback) {
    const err = new Error(primaryError?.message || fallbackError?.message || 'No sports data provider is configured');
    err.code = 'NO_PROVIDER';
    throw err;
  }

  const props = dedupe([...(primary?.props || []), ...(fallback?.props || [])]);
  const books = [...new Set(props.map(p => p.sportsbookKey).filter(Boolean))].sort();
  const providers = [primary?.meta?.provider, fallback?.meta?.provider].filter(Boolean);
  return {
    props,
    meta: {
      provider: providers.join(' + '),
      providers,
      fetchedAt: primary?.meta?.fetchedAt || fallback?.meta?.fetchedAt || new Date().toISOString(),
      latencyMs: Math.max(Number(primary?.meta?.latencyMs || 0), Number(fallback?.meta?.latencyMs || 0)) || null,
      events: Math.max(Number(primary?.meta?.events || 0), Number(fallback?.meta?.events || 0)),
      sportsbooks: books,
      sportsbookCount: books.length,
      propCount: props.length,
      liveEvents: Number(primary?.meta?.liveEvents || 0),
      fullBookCoverage: Boolean(primary?.meta?.fullBookCoverage),
      warning: primaryError ? `Primary odds feed unavailable: ${primaryError.message}` : null,
    },
  };
}

export function providerHealth() {
  return {
    sportsGameOddsConfigured: Boolean(text(process.env.SPORTSGAMEODDS_API_KEY)),
    sportsDataIoConfigured: Boolean(text(process.env.SPORTSDATAIO_API_KEY)),
    preferredProvider: 'SportsGameOdds',
    time: new Date().toISOString(),
  };
}
