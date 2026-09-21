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
    if (!player || !market || line === null) continue;

    const key = [row.eventId || matchupLabel(row), player, market, line].join('|');
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
    if (qualified?.position) group.position = qualified.position;
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
): Promise<ResearchResponse> {
  if (signal?.aborted) throw new ApiError('The request was cancelled.', 0, 'ABORTED');

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
  if (group.marketId) params.set('marketId', group.marketId);
  if (group.position) params.set('position', group.position);
  if (group.team) params.set('team', group.team);
  if (group.opponent) params.set('opponent', group.opponent);
  if (group.homeTeam) params.set('homeTeam', group.homeTeam);
  if (group.awayTeam) params.set('awayTeam', group.awayTeam);

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
      position: group.position,
      team: group.team,
      opponent: group.opponent,
      homeTeam: group.homeTeam,
      awayTeam: group.awayTeam,
      marketId: group.marketId,
      eventId: quote?.eventId || null,
      gameStartTime: group.startsAt,
      period: quote?.period || null,
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
    throw new ApiError(
      body.message || 'Verified research is temporarily unavailable.',
      response.status,
      body.code || 'RESEARCH_BATCH_UNAVAILABLE',
    );
  }

  return body.results;
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
