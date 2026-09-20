// Verified WNBA per-player game history from the public SportsDataverse
// WNBA Stats API archive. This is an on-demand research fallback only: it never
// supplies current prop lines, prices, books or provider freshness.
import { normalizePlayerName } from '../contract.mjs';
import { marketContract, numeric } from '../espn/stat-contract.mjs';
import { samePublicTeam } from '../espn/identity.mjs';

const RELEASE = 'https://github.com/sportsdataverse/sportsdataverse-data/releases/download/wnba_stats_player_game_logs';
const MAX_BYTES = 4 * 1024 * 1024;
const TTL_MS = 30 * 60_000;
const cache = new Map();

const FIELD_COLUMN = Object.freeze({
  Points:'pts',
  Rebounds:'reb',
  OffensiveRebounds:'oreb',
  DefensiveRebounds:'dreb',
  Assists:'ast',
  Steals:'stl',
  BlockedShots:'blk',
  Turnovers:'tov',
  ThreePointersMade:'fg3m',
  ThreePointersAttempted:'fg3a',
  FieldGoalsMade:'fgm',
  FieldGoalsAttempted:'fga',
  FreeThrowsMade:'ftm',
  FreeThrowsAttempted:'fta',
  PersonalFouls:'pf',
});

const text = value => String(value ?? '').trim();
const unavailable = (code, message, retryable = false) => ({
  ok:true, available:false, lineOnly:false, code, message, retryable, gameLog:[],
});

export function parseCsv(input = '') {
  const rows = [];
  let row = [], field = '', quoted = false;
  const source = String(input).replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  if (quoted || !rows.length) throw Object.assign(Error('WNBA_ARCHIVE_CSV_INVALID'), { code:'WNBA_ARCHIVE_CSV_INVALID' });
  const headers = rows.shift().map(v => text(v).toLowerCase());
  if (!headers.length || new Set(headers).size !== headers.length) throw Object.assign(Error('WNBA_ARCHIVE_SCHEMA_INVALID'), { code:'WNBA_ARCHIVE_SCHEMA_INVALID' });
  return rows.filter(r => r.some(v => text(v))).map(values => Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ''])));
}

export function archiveUrl(season) {
  return `${RELEASE}/player_game_logs_${season}.csv`;
}

async function loadSeason(season, { fetcher = globalThis.fetch, now = Date.now, cacheEnabled = true } = {}) {
  const key = String(season);
  const hit = cache.get(key);
  if (cacheEnabled && hit && hit.expires > now()) return { rows:hit.rows, cached:true };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  timer.unref?.();
  try {
    const response = await fetcher(archiveUrl(season), {
      method:'GET',
      redirect:'follow',
      credentials:'omit',
      headers:{ accept:'text/csv' },
      signal:controller.signal,
    });
    if (!response?.ok) throw Object.assign(Error('WNBA_ARCHIVE_HTTP'), { code:'WNBA_ARCHIVE_HTTP', status:response?.status || 0 });
    const length = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(length) && length > MAX_BYTES) throw Object.assign(Error('WNBA_ARCHIVE_TOO_LARGE'), { code:'WNBA_ARCHIVE_TOO_LARGE' });
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > MAX_BYTES) throw Object.assign(Error('WNBA_ARCHIVE_TOO_LARGE'), { code:'WNBA_ARCHIVE_TOO_LARGE' });
    const rows = parseCsv(body);
    const required = ['game_id','game_date','team_abbreviation','player_id','player_name'];
    if (!rows.length || required.some(name => !Object.hasOwn(rows[0], name))) throw Object.assign(Error('WNBA_ARCHIVE_SCHEMA_INVALID'), { code:'WNBA_ARCHIVE_SCHEMA_INVALID' });
    if (cacheEnabled) {
      cache.set(key, { rows, expires:now() + TTL_MS });
      while (cache.size > 4) cache.delete(cache.keys().next().value);
    }
    return { rows, cached:false };
  } finally {
    clearTimeout(timer);
  }
}

function opponentFrom(row) {
  const matchup = text(row.matchup);
  const match = matchup.match(/^(.+?)\s+(@|vs\.?)\s+(.+)$/i);
  if (!match) return { opponent:null, isHome:null };
  return { opponent:text(match[3]), isHome:/^vs/i.test(match[2]) };
}

function rowValue(row, fields) {
  let total = 0;
  for (const field of fields) {
    const column = FIELD_COLUMN[field];
    if (!column) return null;
    const value = numeric(row[column]);
    if (value === null) return null;
    total += value;
  }
  return Number(total.toFixed(3));
}

function chooseIdentity(rows, params) {
  const wanted = normalizePlayerName(params.playerName);
  const named = rows.filter(row => row.player_id && normalizePlayerName(row.player_name) === wanted);
  if (!named.length) return null;
  const ids = [...new Set(named.map(row => text(row.player_id)).filter(Boolean))];
  if (ids.length === 1) return { id:ids[0], rows:named };
  const team = text(params.team);
  if (!team) return null;
  const teamIds = [...new Set(named.filter(row => samePublicTeam(row.team_abbreviation, team, 'WNBA')).map(row => text(row.player_id)).filter(Boolean))];
  if (teamIds.length !== 1) return null;
  return { id:teamIds[0], rows:named.filter(row => text(row.player_id) === teamIds[0]) };
}

function normalizeRows(rows, params, fields, before) {
  const output = new Map(), conflicts = new Set();
  for (const row of rows) {
    if (!row.player_id || text(row.measure_type).toLowerCase() && text(row.measure_type).toLowerCase() !== 'p') continue;
    const minutes = numeric(row.min);
    const value = rowValue(row, fields);
    const dateMs = Date.parse(row.game_date);
    if (!text(row.game_id) || !Number.isFinite(dateMs) || dateMs >= before || minutes === null || minutes <= 0 || value === null) continue;
    if (params.eventId && text(params.eventId) === text(row.game_id)) continue;
    const { opponent, isHome } = opponentFrom(row);
    const seasonType = text(row.season_type).toLowerCase() === 'playoffs' ? 3 : 2;
    const normalized = {
      gameId:`wnba:${text(row.game_id)}`,
      date:new Date(dateMs).toISOString(),
      opponent,
      opponentId:null,
      team:text(row.team_abbreviation) || null,
      isHome,
      minutes,
      value,
      season:text(row.season) || null,
      seasonType,
      gameResult:['W','L'].includes(text(row.wl).toUpperCase()) ? text(row.wl).toUpperCase() : null,
      points:numeric(row.pts),
      rebounds:numeric(row.reb),
      offensiveRebounds:numeric(row.oreb),
      defensiveRebounds:numeric(row.dreb),
      assists:numeric(row.ast),
      steals:numeric(row.stl),
      blocks:numeric(row.blk),
      turnovers:numeric(row.tov),
      threes:numeric(row.fg3m),
      threePointersAttempted:numeric(row.fg3a),
      fieldGoalsMade:numeric(row.fgm),
      fieldGoalsAttempted:numeric(row.fga),
      freeThrowsMade:numeric(row.ftm),
      freeThrowsAttempted:numeric(row.fta),
      personalFouls:numeric(row.pf),
      statKind:fields.join('+'),
    };
    if (conflicts.has(normalized.gameId)) continue;
    const prior = output.get(normalized.gameId);
    if (!prior || prior.value === normalized.value) output.set(normalized.gameId, normalized);
    else { conflicts.add(normalized.gameId); output.delete(normalized.gameId); }
  }
  return [...output.values()].sort((a,b) => Date.parse(b.date) - Date.parse(a.date));
}

export async function fetchWnbaStatsArchiveResearch(params = {}, dependencies = {}) {
  if (String(params.sport || '').toUpperCase() !== 'WNBA') return null;
  const period = text(params.period).toLowerCase();
  if (period && !['game','full','full_game','match','single_stat'].includes(period)) {
    return unavailable('UNSUPPORTED_MARKET', 'WNBA Stats archive only verifies full-game player statistics.');
  }
  const contract = marketContract({ sport:'WNBA', market:params.market, providerMarketKey:params.providerMarketKey || params.marketId || null });
  if (!contract || contract.entityType !== 'player' || contract.fields.some(field => !FIELD_COLUMN[field])) {
    return unavailable('UNSUPPORTED_MARKET', 'WNBA Stats archive does not expose this exact historical statistic.');
  }
  const clock = dependencies.now || Date.now;
  const now = clock();
  const gameStart = Date.parse(params.gameStartTime || '');
  const before = Number.isFinite(gameStart) ? Math.min(now, gameStart) : now;
  const season = Number.isFinite(gameStart) ? new Date(gameStart).getUTCFullYear() : new Date(now).getUTCFullYear();
  const take = Math.min(40, Math.max(5, Math.floor(Number(params.games) || 20)));
  const loaded = [];
  let cached = true, loadError = null;
  for (const year of [season, season - 1]) {
    try {
      const snapshot = await loadSeason(year, dependencies);
      cached = cached && snapshot.cached;
      loaded.push(...snapshot.rows);
    } catch (error) {
      loadError = error;
      break;
    }
    const identity = chooseIdentity(loaded, params);
    if (identity && normalizeRows(identity.rows, params, contract.fields, before).length >= take) break;
  }
  if (!loaded.length && loadError) {
    return unavailable('RESEARCH_PROVIDER_ERROR', 'WNBA historical archive is temporarily unavailable. Please retry.', true);
  }
  const identity = chooseIdentity(loaded, params);
  if (!identity) {
    return unavailable(loadError ? 'RESEARCH_PROVIDER_ERROR' : 'PLAYER_NOT_FOUND',
      loadError ? 'WNBA historical identity verification is temporarily incomplete. Please retry.' : 'Player identity could not be verified in the WNBA Stats archive.',
      Boolean(loadError));
  }
  const gameLog = normalizeRows(identity.rows, params, contract.fields, before).slice(0, take);
  if (!gameLog.length) return unavailable('NO_GAME_LOG_DATA', 'No verified completed WNBA games contain this exact statistic.');
  return {
    ok:true,
    available:true,
    source:'WNBA Stats archive via SportsDataverse',
    cached,
    entityType:'player',
    statKind:contract.fields.join('+'),
    player:{ playerName:text(identity.rows[0]?.player_name) || text(params.playerName), providerPlayerId:`wnba-stats:${identity.id}`, team:text(params.team) || text(gameLog[0]?.team) || null, sport:'WNBA' },
    opponent:text(params.opponent) || null,
    opponentId:null,
    isHome:null,
    season:String(season),
    gameLog,
    coverage:{
      source:'wnba-stats-player-game-logs',
      complete:false,
      seasonComplete:false,
      returnedGames:gameLog.length,
      fields:[...contract.fields],
      historyPartial:Boolean(loadError),
      newestGame:gameLog[0]?.date || null,
      oldestGame:gameLog.at(-1)?.date || null,
    },
  };
}
