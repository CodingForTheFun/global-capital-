import type {
  Account,
  BoardResponse,
  GameLogRow,
  LineHistoryResponse,
  PropGroup,
  PropRow,
  ResearchResponse,
  Side,
} from './types';
import { isDfs, quotePeriod, variantKey } from './prop-signals';

/**
 * Every call goes through this app's own /api/* proxy, which forwards to the
 * existing Oblige service. No route, parameter name or payload shape is
 * changed here — the rewrite is the front end, and the contracts it consumes
 * are the ones already in production.
 */

export class ApiError extends Error {
  status: number;
  code: string;
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

async function fetchGet(path: string, parentSignal?: AbortSignal, timeoutMs = GET_TIMEOUT_MS) {
  if (parentSignal?.aborted) throw new ApiError('The request was cancelled.', 0, 'ABORTED');

  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    });
    // Keep cancellation and the deadline active until the body is consumed.
    // Headers alone do not mean that research finished loading.
    const raw = await response.text();
    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid JSON envelope');
      body = parsed as Record<string, unknown>;
    } catch {
      if (response.ok) throw new ApiError('The service returned an incomplete response. Please retry.', response.status, 'INVALID_RESPONSE');
    }
    return { response, body };
  } catch (error) {
    if (parentSignal?.aborted) throw new ApiError('The request was cancelled.', 0, 'ABORTED');
    if (controller.signal.aborted) {
      throw new ApiError('Oblige Props took too long to respond.', 0, 'TIMEOUT');
    }
    if (error instanceof ApiError) throw error;
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
export async function getJson<T>(path: string, signal?: AbortSignal, timeoutMs = GET_TIMEOUT_MS, totalTimeoutMs?: number): Promise<T> {
  const deadline = totalTimeoutMs === undefined ? Infinity : Date.now() + totalTimeoutMs;
  const remaining = () => Math.max(0, deadline - Date.now());
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (signal?.aborted) throw new ApiError('The request was cancelled.', 0, 'ABORTED');
    if (remaining() <= 0) throw new ApiError('Oblige Props took too long to respond.', 0, 'TIMEOUT');
    let result: Awaited<ReturnType<typeof fetchGet>>;
    try {
      result = await fetchGet(path, signal, Math.min(timeoutMs, remaining()));
    } catch (error) {
      if (attempt === 0 && error instanceof ApiError && ['TIMEOUT', 'NETWORK', 'INVALID_RESPONSE'].includes(error.code)) {
        await wait(Math.min(450, remaining()), signal);
        continue;
      }
      throw error;
    }
    const { response, body } = result;

    if (response.ok) return body as T;

    if (attempt === 0 && RETRYABLE_GET_STATUSES.has(response.status)) {
      await wait(Math.min(retryAfterMs(response, attempt), remaining()), signal);
      continue;
    }

    throw new ApiError(
      typeof body.message === 'string' ? body.message : 'That request could not be completed.',
      response.status,
      typeof body.code === 'string' ? body.code : 'REQUEST_FAILED',
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
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function matchupLabel(row: PropRow) {
  if (row.awayTeam && row.homeTeam) return `${row.awayTeam} @ ${row.homeTeam}`;
  if (row.team && row.opponent) return `${row.team} vs ${row.opponent}`;
  return row.team || row.opponent || 'Matchup unavailable';
}

function bestQuote(rows: PropRow[], side: Side): PropRow | null {
  // Best price is the highest American number on that side, which is the same
  // ordering for favourites and underdogs.
  return (
    rows
      .filter((row) => String(row.side || '').toUpperCase() === side)
      .sort((a, b) => Number(isDfs(a)) - Number(isDfs(b)) || Number(b.price ?? -1e6) - Number(a.price ?? -1e6))[0] || null
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
    if (!player || !market || line === null) continue;

    const playerIdentity = String(row.providerPlayerId || '').trim() || player.toLowerCase();
    const period = quotePeriod(row);
    const key = [row.eventId || matchupLabel(row), playerIdentity, market, period || '', variantKey(row), line].join('|');
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        propId: row.propId || row.id || null,
        player,
        providerPlayerId: row.providerPlayerId || null,
        market,
        marketId: row.marketId || null,
        line,
        sport,
        team: row.team || null,
        position: row.position || null,
        opponent: row.opponent || null,
        homeTeam: row.homeTeam || null,
        awayTeam: row.awayTeam || null,
        matchup: matchupLabel(row),
        startsAt: row.gameStartTime || null,
        live: row.live === true,
        period,
        quotes: [],
        bestOver: null,
        bestUnder: null,
      };
      groups.set(key, group);
    }
    group.quotes.push(row);
    if (row.live === true) group.live = true;
  }

  for (const group of groups.values()) {
    // PrizePicks fantasy scoring must retain the exact platform-qualified market
    // identity and player role that the backend attached to its live line.
    // Without this, the UI still has the real number but asks research as a
    // generic fantasy market and incorrectly gets an unavailable response.
    const qualified = group.quotes.find((row) => {
      const marketId = String(row.marketId || '').trim().toLowerCase();
      const book = String(row.sportsbookKey || '').trim().toLowerCase();
      return Boolean(book && marketId.startsWith(`${book}:`));
    });
    if (qualified?.marketId) group.marketId = qualified.marketId;
    if (qualified?.position) group.position = qualified.position;
    group.bestOver = bestQuote(group.quotes, 'OVER');
    group.bestUnder = bestQuote(group.quotes, 'UNDER');
  }
  return [...groups.values()];
}

export async function fetchBoard(sport: string, signal?: AbortSignal) {
  const body = await getJson<BoardResponse>(
    `/api/apex/props?sport=${encodeURIComponent(sport)}&alternates=1`,
    signal,
  );
  const rows = Array.isArray(body?.props) ? body.props : [];
  const players = new Map((body?.data?.players || []).map(player => [player.id, player]));
  const quotes = rows.map(row => {
    const player = row.playerId ? players.get(row.playerId) : undefined;
    return player ? { ...row, providerPlayerId: row.providerPlayerId || player.providerPlayerId, position: row.position || player.position, team: row.team || player.team } : row;
  });
  return {
    groups: groupProps(quotes, sport),
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
): Promise<ResearchResponse> {
  if (signal?.aborted) throw new ApiError('The request was cancelled.', 0, 'ABORTED');

  const params = new URLSearchParams({
    sport: group.sport,
    playerName: group.player,
    market: group.market,
    line: String(group.line),
    side,
    games: '20',
  });
  if (group.providerPlayerId) params.set('providerPlayerId', group.providerPlayerId);
  if (group.marketId) params.set('marketId', group.marketId);
  if (group.position) params.set('position', group.position);
  if (group.team) params.set('team', group.team);
  if (group.opponent) params.set('opponent', group.opponent);
  if (group.homeTeam) params.set('homeTeam', group.homeTeam);
  if (group.awayTeam) params.set('awayTeam', group.awayTeam);
  if (group.period) params.set('period', group.period);
  if (group.startsAt) params.set('gameStartTime', group.startsAt);
  const eventId = group.quotes?.find(row => row.eventId)?.eventId;
  if (eventId) params.set('eventId', eventId);

  const path = `/api/apex/research?${params}`;
  const cached = researchCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) researchCache.delete(path);

  const value = await getJson<ResearchResponse>(path, signal, 45000, 45000);
  // A provider miss is not a successful sample: an explicit UI retry must
  // reach the service instead of replaying the same unavailable cache entry.
  if (value.available !== false) rememberResearch(path, value);
  return value;
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
