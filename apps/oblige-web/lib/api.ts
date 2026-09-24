import type {
  Account,
  BoardResponse,
  GameLogRow,
  LineHistoryResponse,
  LiveMovesResponse,
  MatchupResponse,
  PropGroup,
  PropRow,
  ResearchResponse,
  Side,
} from './types';
import { marketDisplayLabel } from './utils';

/**
 * Every call goes through this app's own /api/* proxy, which forwards to the
 * existing Oblige service. No route, parameter name or payload shape is
 * changed here — the rewrite is the front end, and the contracts it consumes
 * are the ones already in production.
 */

export class ApiError extends Error {
  status: number;
  code: string;
  /** Server-requested wait before retrying (from Retry-After), when given. */
  retryAfterMs?: number;
  constructor(message: string, status: number, code = 'REQUEST_FAILED') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const GET_TIMEOUT_MS = 12_000;
const RETRYABLE_GET_STATUSES = new Set([429, 502, 503, 504]);
const RESEARCH_CACHE_TTL_MS = 60_000;
const RESEARCH_CACHE_MAX = 256;
const researchCache = new Map<string, { expiresAt: number; value: ResearchResponse }>();

function retryAfterMs(response: Response, attempt: number) {
  const raw = response.headers.get('retry-after');
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 250), 5_000);
    const date = Date.parse(raw);
    if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 250), 5_000);
  }
  return Math.min(450 * 2 ** attempt, 1_800);
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApiError('The request was cancelled.', 0, 'ABORTED'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ApiError('The request was cancelled.', 0, 'ABORTED'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function fetchGet(path: string, parentSignal?: AbortSignal) {
  if (parentSignal?.aborted) throw new ApiError('The request was cancelled.', 0, 'ABORTED');

  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  const timeout = setTimeout(() => controller.abort(), GET_TIMEOUT_MS);

  try {
    return await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch {
    if (parentSignal?.aborted) throw new ApiError('The request was cancelled.', 0, 'ABORTED');
    if (controller.signal.aborted) {
      throw new ApiError('Oblige Props took too long to respond.', 0, 'TIMEOUT');
    }
    throw new ApiError('Oblige Props could not be reached.', 0, 'NETWORK');
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

/**
 * GETs are idempotent, so one bounded retry is safe for transient gateway and
 * rate-limit failures. The browser respects Retry-After when supplied and
 * never retries auth/client errors. This gives the UI a calmer failure mode
 * without increasing normal polling frequency or touching provider logic.
 */
async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchGet(path, signal);
    const body = (await response.json().catch(() => ({}))) as T & { message?: string; code?: string };

    if (response.ok) return body;

    if (attempt === 0 && RETRYABLE_GET_STATUSES.has(response.status)) {
      await wait(retryAfterMs(response, attempt), signal);
      continue;
    }

    throw new ApiError(
      body?.message || 'That request could not be completed.',
      response.status,
      body?.code || 'REQUEST_FAILED',
    );
  }

  throw new ApiError('That request could not be completed.', 0, 'REQUEST_FAILED');
}

/* ---------------------------------------------------------------- account */

export async function fetchAccount(signal?: AbortSignal): Promise<Account> {
  try {
    const body = await getJson<{ authenticated?: boolean; user?: { id: string; email?: string } }>(
      '/api/account/me',
      signal,
    );
    return body?.authenticated && body?.user?.id ? body.user : null;
  } catch {
    return null;
  }
}

export async function postAccount(
  action: 'login' | 'register' | 'verify' | 'logout',
  payload: Record<string, unknown>,
) {
  const response = await fetch(`/api/account/${action}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    message?: string;
    authenticated?: boolean;
  };
  if (!response.ok || body?.ok === false) {
    throw new ApiError(body?.message || 'That request could not be completed.', response.status);
  }
  return body;
}

/* ------------------------------------------------------------------ board */

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const DATA_PROVIDER_BOOKS = new Set([
  'espn',
  'sportsdataio',
  'sportsgameodds',
  'propline',
  'clearsports',
  'sportradar',
]);

const sourceBookKey = (value: unknown) =>
  String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const isDataProviderBook = (row: Pick<PropRow, 'sportsbook' | 'sportsbookKey'>) =>
  DATA_PROVIDER_BOOKS.has(sourceBookKey(row.sportsbookKey)) ||
  DATA_PROVIDER_BOOKS.has(sourceBookKey(row.sportsbook));

const cleanPosition = (value: unknown): string | null => {
  const raw = String(value || '').trim();
  if (!raw || /^(?:position\s*)?(?:unavailable|unknown|not\s+available|n\/?a|none|null|-)$/i.test(raw)) return null;
  return raw;
};

function matchupLabel(row: PropRow) {
  if (row.awayTeam && row.homeTeam) return `${row.awayTeam} @ ${row.homeTeam}`;
  if (row.team && row.opponent) return `${row.team} vs ${row.opponent}`;
  return row.team || row.opponent || 'Matchup unavailable';
}

function canonicalPeriod(value: unknown, market = '') {
  const explicit = String(value || '').trim();
  const label = String(market || '').trim().toLowerCase();
  if (!explicit) {
    const compact = label.match(/\b([1-9])\s*(q|h|p|i|s)\b/i);
    if (compact) return `${compact[1]}${compact[2].toLowerCase()}`;
    const namedFromLabel: Array<[RegExp, string]> = [
      [/\b(?:first|1st)\s+quarter\b/i, '1q'], [/\b(?:second|2nd)\s+quarter\b/i, '2q'],
      [/\b(?:third|3rd)\s+quarter\b/i, '3q'], [/\b(?:fourth|4th)\s+quarter\b/i, '4q'],
      [/\b(?:first|1st)\s+half\b/i, '1h'], [/\b(?:second|2nd)\s+half\b/i, '2h'],
      [/\b(?:first|1st)\s+period\b/i, '1p'], [/\b(?:second|2nd)\s+period\b/i, '2p'],
      [/\b(?:third|3rd)\s+period\b/i, '3p'], [/\b(?:first|1st)\s+inning\b/i, '1i'],
      [/\b(?:first|1st)\s+set\b/i, '1s'], [/\b(?:second|2nd)\s+set\b/i, '2s'],
      [/\b(?:third|3rd)\s+set\b/i, '3s'], [/\b(?:fourth|4th)\s+set\b/i, '4s'],
      [/\b(?:fifth|5th)\s+set\b/i, '5s'],
    ];
    for (const [pattern, period] of namedFromLabel) if (pattern.test(label)) return period;
    return 'game';
  }

  const raw = explicit.toLowerCase().replace(/[\s_-]+/g, '');
  if (['game', 'full', 'fullgame', 'match', 'singlestat'].includes(raw)) return 'game';
  const direct = raw.match(/^([1-9])([qhpis])$/);
  if (direct) return `${direct[1]}${direct[2]}`;
  const reversed = raw.match(/^([qhpis])([1-9])$/);
  if (reversed) return `${reversed[2]}${reversed[1]}`;
  const firstN = raw.match(/^f([357])$/);
  if (firstN) return `1ix${firstN[1]}`;
  if (/^1ix[357]$/.test(raw) || ['reg', 'ot', 'so', 'dec'].includes(raw)) return raw;
  const named: Record<string, string> = {
    firstquarter: '1q', secondquarter: '2q', thirdquarter: '3q', fourthquarter: '4q',
    '1stquarter': '1q', '2ndquarter': '2q', '3rdquarter': '3q', '4thquarter': '4q',
    firsthalf: '1h', secondhalf: '2h', '1sthalf': '1h', '2ndhalf': '2h',
    firstperiod: '1p', secondperiod: '2p', thirdperiod: '3p',
    '1stperiod': '1p', '2ndperiod': '2p', '3rdperiod': '3p',
    firstinning: '1i', '1stinning': '1i',
    firstset: '1s', secondset: '2s', thirdset: '3s', fourthset: '4s', fifthset: '5s',
    '1stset': '1s', '2ndset': '2s', '3rdset': '3s', '4thset': '4s', '5thset': '5s',
  };
  return named[raw] || raw;
}

// Release recovery marker for verified-history identity fix; no runtime behavior change.
const PLAYER_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

function cleanPlayerDisplay(value: unknown) {
  return String(value || '')
    .trim()
    .replace(/^@+\s*/, '')
    .replace(/\s+\([A-Z0-9 .'-]{2,8}\)\s*$/i, '')
    .trim();
}

function playerIdentityKey(value: unknown) {
  const cleaned = cleanPlayerDisplay(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.'’_-]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  while (parts.length > 2 && PLAYER_SUFFIXES.has(parts.at(-1) || '')) parts.pop();
  return parts.length >= 2 ? `${parts[0]}|${parts.at(-1)}` : cleaned;
}

function preferredPlayerDisplay(current: string, candidate: string) {
  const score = (value: string) => {
    const cleaned = cleanPlayerDisplay(value);
    const parts = cleaned.split(/\s+/).filter(Boolean);
    const hasSuffix = parts.length > 2 && PLAYER_SUFFIXES.has(String(parts.at(-1) || '').replace(/\./g, '').toLowerCase());
    const middleCount = Math.max(0, parts.length - 2 - (hasSuffix ? 1 : 0));
    const decoration = value !== cleaned ? 10 : 0;
    return decoration + middleCount * 2 - (hasSuffix ? 0.25 : 0);
  };
  const a = cleanPlayerDisplay(current), b = cleanPlayerDisplay(candidate);
  return score(b) < score(a) ? b : a;
}

function eventIdentityKey(row: PropRow) {
  const at = Date.parse(String(row.gameStartTime || ''));
  // Providers regularly disagree by a minute or two on the same scheduled
  // event. A ten-minute bucket is tight enough to keep real separate games
  // apart while collapsing those provider-specific event IDs.
  if (Number.isFinite(at)) return `t:${Math.round(at / (10 * 60_000))}`;
  return `e:${String(row.eventId || matchupLabel(row)).trim().toLowerCase()}`;
}

function marketIdentityKey(row: PropRow, player: string, sport: string) {
  return marketDisplayLabel(row.market, player, row.marketId, sport)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function bestQuote(rows: PropRow[], side: Side): PropRow | null {
  // Only actual books/DFS platforms may win "best price". Aggregators and
  // statistics providers can carry sportsbook-shaped fields in fallback rows;
  // presenting those as books creates fake-looking prices such as ESPN +5000.
  return (
    rows
      .filter((row) => String(row.side || '').toUpperCase() === side && !isDataProviderBook(row))
      .sort((a, b) => Number(b.price ?? -1e6) - Number(a.price ?? -1e6))[0] || null
  );
}

/**
 * The board arrives as one row per book per side. A card is all the quotes for
 * one player, market and line, so fold them together before anything renders.
 */
export function groupProps(rows: PropRow[], sport: string): PropGroup[] {
  const groups = new Map<string, PropGroup>();
  for (const row of rows) {
    const player = String(row.playerName || '').trim();
    const market = String(row.market || '').trim();
    const line = num(row.line);
    const period = canonicalPeriod(row.period, market);
    if (!player || !market || line === null) continue;

    const key = [sport, eventIdentityKey(row), playerIdentityKey(player), marketIdentityKey(row, player, sport), period, line].join('|');
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        propId: row.propId || row.id || null,
        player,
        providerPlayerId: row.providerPlayerId || null,
        sportsGameOddsPlayerId: row.sportsGameOddsPlayerId || null,
        sportsGameOddsEventId: row.sportsGameOddsEventId || null,
        sportsGameOddsLeagueId: row.sportsGameOddsLeagueId || null,
        sportsGameOddsStatId: row.statId || null,
        market,
        marketId: row.marketId || null,
        line,
        sport,
        period,
        team: row.team || null,
        position: cleanPosition(row.position),
        opponent: row.opponent || null,
        homeTeam: row.homeTeam || null,
        awayTeam: row.awayTeam || null,
        matchup: matchupLabel(row),
        startsAt: row.gameStartTime || null,
        live: row.live === true,
        quotes: [],
        bestOver: null,
        bestUnder: null,
      };
      groups.set(key, group);
    }
    group.quotes.push(row);
    if (playerIdentityKey(group.player) === playerIdentityKey(player)) {
      group.player = preferredPlayerDisplay(group.player, player);
    }

    // A provider/book can omit identity fields that another quote for the exact
    // same prop supplies. Fill only missing metadata so the first sparse quote
    // cannot leave the research header with a fake/generic team identity.
    group.propId ||= row.propId || row.id || null;
    group.providerPlayerId ||= row.providerPlayerId || null;
    group.sportsGameOddsPlayerId ||= row.sportsGameOddsPlayerId || null;
    group.sportsGameOddsEventId ||= row.sportsGameOddsEventId || null;
    group.sportsGameOddsLeagueId ||= row.sportsGameOddsLeagueId || null;
    group.sportsGameOddsStatId ||= row.statId || null;
    group.marketId ||= row.marketId || null;
    group.team ||= row.team || null;
    group.position ||= cleanPosition(row.position);
    group.opponent ||= row.opponent || null;
    group.homeTeam ||= row.homeTeam || null;
    group.awayTeam ||= row.awayTeam || null;
    group.startsAt ||= row.gameStartTime || null;

    const candidateMatchup = matchupLabel(row);
    if (
      candidateMatchup !== 'Matchup unavailable' &&
      (
        group.matchup === 'Matchup unavailable' ||
        (!group.matchup.includes('@') && Boolean(row.awayTeam && row.homeTeam))
      )
    ) {
      group.matchup = candidateMatchup;
    }

    if (row.live === true) group.live = true;
  }

  for (const group of groups.values()) {
    // Fantasy scoring belongs to the platform that posted the line. If one
    // quote carries a source-qualified market id (for example PrizePicks),
    // preserve that verified identity for research even when another DFS book
    // happens to post the same display label and number.
    const qualified = group.quotes.find((row) => {
      const marketId = String(row.marketId || '').trim().toLowerCase();
      const book = String(row.sportsbookKey || '').trim().toLowerCase();
      return Boolean(book && marketId.startsWith(`${book}:`));
    });
    if (qualified?.marketId) group.marketId = qualified.marketId;
    if (qualified?.position) group.position = cleanPosition(qualified.position) || group.position;
    group.bestOver = bestQuote(group.quotes, 'OVER');
    group.bestUnder = bestQuote(group.quotes, 'UNDER');
  }
  return [...groups.values()];
}

export async function fetchBoard(sport: string, signal?: AbortSignal) {
  const body = await getJson<BoardResponse>(
    `/api/apex/props?sport=${encodeURIComponent(sport)}`,
    signal,
  );
  const rows = Array.isArray(body?.props) ? body.props : [];
  return {
    groups: groupProps(rows, sport),
    meta: body?.meta || {},
    supportedSports: body?.supportedSports || [],
    quoteCount: rows.length,
  };
}

/* --------------------------------------------------------------- research */

function rememberResearch(key: string, value: ResearchResponse) {
  if (researchCache.size >= RESEARCH_CACHE_MAX) {
    const oldest = researchCache.keys().next().value as string | undefined;
    if (oldest) researchCache.delete(oldest);
  }
  researchCache.set(key, { expiresAt: Date.now() + RESEARCH_CACHE_TTL_MS, value });
}

export async function fetchResearch(
  group: PropGroup,
  side: Side,
  signal?: AbortSignal,
  options: { detail?: boolean } = {},
): Promise<ResearchResponse> {
  if (signal?.aborted) throw new ApiError('The request was cancelled.', 0, 'ABORTED');

  const quote = group.bestOver || group.bestUnder || group.quotes[0] || null;
  const params = new URLSearchParams({
    sport: group.sport,
    playerName: group.player,
    market: group.market,
    line: String(group.line),
    side,
    games: '100',
    historyYears: '5',
  });
  if (group.providerPlayerId) params.set('providerPlayerId', group.providerPlayerId);
  if (group.sportsGameOddsPlayerId) params.set('sportsGameOddsPlayerId', group.sportsGameOddsPlayerId);
  if (group.sportsGameOddsEventId) params.set('sportsGameOddsEventId', group.sportsGameOddsEventId);
  if (group.sportsGameOddsLeagueId) params.set('sportsGameOddsLeagueId', group.sportsGameOddsLeagueId);
  if (group.sportsGameOddsStatId) params.set('sportsGameOddsStatId', group.sportsGameOddsStatId);
  if (group.marketId) params.set('marketId', group.marketId);
  if (group.position) params.set('position', group.position);
  if (group.team) params.set('team', group.team);
  if (group.opponent) params.set('opponent', group.opponent);
  if (group.homeTeam) params.set('homeTeam', group.homeTeam);
  if (group.awayTeam) params.set('awayTeam', group.awayTeam);
  if (quote?.eventId) params.set('eventId', String(quote.eventId));
  if (group.startsAt) params.set('gameStartTime', group.startsAt);
  if (group.period) params.set('period', group.period);
  if (options.detail === true) params.set('detail', '1');

  const path = `/api/apex/research?${params}`;
  const cached = researchCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) researchCache.delete(path);

  const value = await getJson<ResearchResponse>(path, signal);
  rememberResearch(path, value);
  return value;
}


const RESEARCH_BATCH_SIZE = 100;

/**
 * Resolve verified research summaries for a slate in one bounded request.
 * The production frontdoor caps this route at 100 props, so callers should
 * chunk larger slates and can merge each completed batch progressively.
 */
export async function fetchResearchBatch(
  groups: PropGroup[],
  side: Side,
  signal?: AbortSignal,
): Promise<Record<string, ResearchResponse>> {
  if (!groups.length) return {};
  if (groups.length > RESEARCH_BATCH_SIZE) {
    throw new ApiError(
      `Research batches are limited to ${RESEARCH_BATCH_SIZE} props.`,
      400,
      'RESEARCH_BATCH_TOO_LARGE',
    );
  }

  const props = groups.map((group) => {
    const quote = group.bestOver || group.bestUnder || group.quotes[0] || null;
    return {
      key: group.key,
      sport: group.sport,
      playerName: group.player,
      market: group.market,
      line: group.line,
      side,
      providerPlayerId: group.providerPlayerId,
      sportsGameOddsPlayerId: group.sportsGameOddsPlayerId,
      sportsGameOddsEventId: group.sportsGameOddsEventId,
      sportsGameOddsLeagueId: group.sportsGameOddsLeagueId,
      sportsGameOddsStatId: group.sportsGameOddsStatId,
      position: group.position,
      team: group.team,
      opponent: group.opponent,
      homeTeam: group.homeTeam,
      awayTeam: group.awayTeam,
      marketId: group.marketId,
      eventId: quote?.eventId || null,
      gameStartTime: group.startsAt,
      period: group.period || quote?.period || null,
      games: 40,
    };
  });

  const response = await fetch('/api/apex/research-batch', {
    method: 'POST',
    credentials: 'same-origin',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ props }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    code?: string;
    message?: string;
    results?: Record<string, ResearchResponse>;
  };

  if (response.status === 401) {
    throw new ApiError('Sign in to view verified research.', 401, 'AUTH_REQUIRED');
  }
  if (!response.ok || body.ok === false || !body.results) {
    const error = new ApiError(
      body.message || 'Verified research is temporarily unavailable.',
      response.status,
      body.code || 'RESEARCH_BATCH_UNAVAILABLE',
    );
    const retryAfter = Number(response.headers.get('retry-after'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterMs = Math.min(retryAfter, 120) * 1000;
    throw error;
  }

  return body.results;
}

const MATCHUP_UNAVAILABLE: MatchupResponse = {
  ok: true,
  available: false,
  code: 'MATCHUP_SOURCE_UNAVAILABLE',
  message: 'Game context could not load. Try again shortly.',
};

/**
 * Injuries, lineups, weather and the published pre-game estimate for the
 * prop's game. The backend needs the exact event identity; without it we
 * answer "unavailable" locally rather than sending a guess.
 */
export async function fetchMatchup(group: PropGroup, signal?: AbortSignal): Promise<MatchupResponse> {
  const quote = group.bestOver || group.bestUnder || group.quotes[0] || null;
  const eventId = quote?.eventId ? String(quote.eventId) : '';
  if (!eventId || !group.homeTeam || !group.awayTeam || !group.startsAt) {
    return {
      ok: true,
      available: false,
      code: 'MATCHUP_IDENTITY_MISSING',
      message: 'Game context needs a verified game, teams and start time, which this prop does not carry.',
    };
  }
  const params = new URLSearchParams({
    sport: group.sport,
    eventId,
    homeTeam: group.homeTeam,
    awayTeam: group.awayTeam,
    gameStartTime: group.startsAt,
  });
  try {
    const value = await getJson<MatchupResponse>(`/api/apex/research-matchup?${params}`, signal);
    if (typeof value?.available !== 'boolean') return MATCHUP_UNAVAILABLE;
    // A context for a different game is worse than none.
    if (value.available && (value.eventId !== eventId || !Array.isArray(value.teams) || value.teams.length !== 2)) {
      return MATCHUP_UNAVAILABLE;
    }
    return value;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof ApiError && error.status === 401) {
      return { ok: false, available: false, code: 'AUTH_REQUIRED', message: 'Sign in to view game context.' };
    }
    if (error instanceof ApiError && error.message && error.status === 400) {
      return { ok: true, available: false, code: error.code, message: error.message };
    }
    return MATCHUP_UNAVAILABLE;
  }
}

/** Realtime line movement, steam, suspensions and gradings. */
export async function fetchLiveMoves(
  filters: { sport?: string | null; type?: string | null; player?: string | null; limit?: number },
  signal?: AbortSignal,
): Promise<LiveMovesResponse> {
  const params = new URLSearchParams({ limit: String(Math.min(300, Math.max(1, filters.limit || 120))) });
  if (filters.sport) params.set('sport', filters.sport);
  if (filters.type) params.set('type', filters.type);
  if (filters.player) params.set('player', filters.player);
  return getJson<LiveMovesResponse>(`/api/apex/live-moves?${params}`, signal);
}

export async function fetchLineHistory(propId: string, signal?: AbortSignal) {
  const body = await getJson<LineHistoryResponse>(
    `/api/apex/line-history?propId=${encodeURIComponent(propId)}&limit=60`,
    signal,
  );
  return body.history || body.points || [];
}

/** The artwork route serves the image itself, so this is a URL, not a fetch. */
export function artworkUrl(sport: string, name: string, team?: string | null, providerPlayerId?: string | null) {
  const params = new URLSearchParams({ sport, name });
  if (team) params.set('team', team);
  if (providerPlayerId) params.set('providerPlayerId', providerPlayerId);
  return `/api/apex/player-artwork?${params}`;
}

/* ------------------------------------------------------- research helpers */

/** Windows come back under several names depending on the provider. */
export function windowOf(research: ResearchResponse | null, ...names: string[]) {
  if (!research?.windows) return null;
  for (const name of names) {
    const found = research.windows[name];
    if (found) return found;
  }
  return null;
}

export function splitOf(research: ResearchResponse | null, ...names: string[]) {
  if (!research?.splits) return null;
  for (const name of names) {
    const found = research.splits[name];
    if (found) return found;
  }
  return null;
}

/** streak ships either as a bare signed number or as {count, type}. */
export function streakOf(research: ResearchResponse | null): { count: number; over: boolean } | null {
  const raw = research?.streak;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw === 0) return null;
    return { count: Math.abs(raw), over: raw > 0 };
  }
  const count = num(raw.count);
  if (count === null || count === 0) return null;
  const type = String(raw.type || '').toUpperCase();
  return { count: Math.abs(count), over: type ? type === 'OVER' || type === 'HIT' : count > 0 };
}

export function playedGames(research: ResearchResponse | null): GameLogRow[] {
  return (research?.gameLog || []).filter((row) => num(row.value) !== null);
}
