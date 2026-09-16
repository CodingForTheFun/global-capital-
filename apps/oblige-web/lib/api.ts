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

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal });
  } catch (cause) {
    if (signal?.aborted) throw new ApiError('The request was cancelled.', 0, 'ABORTED');
    throw new ApiError('Oblige Props could not be reached.', 0, 'NETWORK');
  }
  const body = (await response.json().catch(() => ({}))) as T & { message?: string; code?: string };
  if (!response.ok) {
    throw new ApiError(
      body?.message || 'That request could not be completed.',
      response.status,
      body?.code || 'REQUEST_FAILED',
    );
  }
  return body;
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

export async function fetchResearch(
  group: PropGroup,
  side: Side,
  signal?: AbortSignal,
): Promise<ResearchResponse> {
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
  if (group.team) params.set('team', group.team);
  if (group.opponent) params.set('opponent', group.opponent);
  if (group.homeTeam) params.set('homeTeam', group.homeTeam);
  if (group.awayTeam) params.set('awayTeam', group.awayTeam);
  return getJson<ResearchResponse>(`/api/apex/research?${params}`, signal);
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
