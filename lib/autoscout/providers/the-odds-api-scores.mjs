import { SUPPORTED_SPORTS, normalizedEvent, numberOrNull } from '../models.mjs';
import { SPORT_KEYS } from './the-odds-api.mjs';
import { recordProviderRequest, recordProviderError, snapshotDiagnostics } from '../runtime-store.mjs';

const BASE = 'https://api.the-odds-api.com/v4';
const cache = new Map();
const inFlight = new Map();
const text = (value) => String(value ?? '').trim();

function apiKey() { return text(process.env.THE_ODDS_API_KEY); }
function scoreOf(raw, teamName) {
  const row = (raw?.scores || []).find((score) => text(score?.name) === text(teamName));
  return numberOrNull(row?.score);
}
function statusOf(raw) {
  if (raw?.completed === true) return 'FINAL';
  const start = Date.parse(raw?.commence_time || '');
  if (Array.isArray(raw?.scores) && raw.scores.length && Number.isFinite(start) && start <= Date.now()) return 'LIVE';
  return 'SCHEDULED';
}
function ttlFor(rows) {
  if (rows.some((row) => row.status === 'LIVE')) return 30_000;
  const starts = rows.map((row) => Date.parse(row.commenceTime || '')).filter(Number.isFinite);
  const next = starts.filter((start) => start > Date.now()).sort((a, b) => a - b)[0];
  if (next && next - Date.now() < 2 * 3600_000) return 90_000;
  return 180_000;
}

async function apiGet(path, params = {}, { signal, sport = null } = {}) {
  if (!apiKey()) throw Object.assign(new Error('The Odds API is not configured.'), { code: 'NOT_CONFIGURED' });
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('apiKey', apiKey());
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  let response;
  try {
    response = await fetch(url, { signal, headers: { accept: 'application/json' } });
  } catch (error) {
    recordProviderError({ provider: 'the-odds-api-scores', endpoint: path, sport, reason: error?.message, code: error?.code });
    throw error;
  }
  const used = numberOrNull(response.headers.get('x-requests-used'));
  const remaining = numberOrNull(response.headers.get('x-requests-remaining'));
  const cost = numberOrNull(response.headers.get('x-requests-last'));
  recordProviderRequest({ cost, remaining, used });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const reason = body?.message || body?.error || `Provider HTTP ${response.status}`;
    recordProviderError({ provider: 'the-odds-api-scores', endpoint: path, sport, status: response.status, reason, code: body?.error_code || body?.code });
    throw Object.assign(new Error(reason), { status: response.status, code: body?.error_code || body?.code || 'ODDS_API_SCORE_ERROR' });
  }
  return body;
}

export function normalizeScoreRows(rawRows, sport, ingestedAt = new Date().toISOString()) {
  const selected = text(sport).toUpperCase();
  return (Array.isArray(rawRows) ? rawRows : []).filter((raw) => raw?.id).map((raw) => normalizedEvent({
    provider: 'the-odds-api',
    providerEventId: raw.id,
    sport: selected,
    league: selected,
    homeTeam: raw.home_team,
    awayTeam: raw.away_team,
    commenceTime: raw.commence_time || null,
    status: statusOf(raw),
    homeScore: scoreOf(raw, raw.home_team),
    awayScore: scoreOf(raw, raw.away_team),
    providerUpdatedAt: raw.last_update || null,
    ingestedAt,
  }));
}

export async function fetchScores(sport, { signal, force = false, daysFrom = 1 } = {}) {
  const selected = text(sport).toUpperCase();
  const sportKey = SPORT_KEYS[selected];
  if (!SUPPORTED_SPORTS.includes(selected) || !sportKey) throw Object.assign(new Error(`Unsupported sport: ${selected}`), { code: 'UNSUPPORTED_SPORT' });
  if (!apiKey()) throw Object.assign(new Error('The Odds API is not configured.'), { code: 'NOT_CONFIGURED' });

  const historyDays = Math.max(0, Math.min(3, Number(daysFrom) || 0));
  const cacheKey = `${selected}|${historyDays}`;
  const cached = cache.get(cacheKey);
  if (!force && cached && cached.expiresAt > Date.now()) return { ...cached.value, meta: { ...cached.value.meta, cacheHit: true } };
  if (!force && inFlight.has(cacheKey)) return inFlight.get(cacheKey);

  const task = (async () => {
    const started = Date.now();
    const ingestedAt = new Date().toISOString();
    const params = { dateFormat: 'iso' };
    if (historyDays > 0) params.daysFrom = historyDays;
    const raw = await apiGet(`/sports/${sportKey}/scores`, params, { signal, sport: selected });
    const games = normalizeScoreRows(raw, selected, ingestedAt)
      .sort((a, b) => (Date.parse(a.commenceTime || '') || Infinity) - (Date.parse(b.commenceTime || '') || Infinity));
    const ttlMs = ttlFor(games);
    const diagnostics = snapshotDiagnostics();
    const value = {
      games,
      meta: {
        provider: 'The Odds API',
        sport: selected,
        fetchedAt: ingestedAt,
        ingestionTimestamp: ingestedAt,
        latencyMs: Date.now() - started,
        liveCount: games.filter((game) => game.status === 'LIVE').length,
        scheduledCount: games.filter((game) => game.status === 'SCHEDULED').length,
        finalCount: games.filter((game) => game.status === 'FINAL').length,
        cacheHit: false,
        cacheSeconds: Math.round(ttlMs / 1000),
        quota: diagnostics.quota || {},
        scoreDetail: 'The Odds API score feed does not provide a reliable game clock or player live-stat progress; those fields remain unavailable.',
      },
    };
    cache.set(cacheKey, { value, expiresAt: Date.now() + ttlMs });
    return value;
  })();
  inFlight.set(cacheKey, task);
  try { return await task; }
  finally { inFlight.delete(cacheKey); }
}

export const theOddsApiScoresProvider = Object.freeze({
  id: 'the-odds-api-scores',
  name: 'The Odds API Scores',
  kind: 'scores',
  capabilities: ['scheduled-games','live-scores','recent-finals','timestamps'],
  supportedSports: Object.freeze([...SUPPORTED_SPORTS]),
  isConfigured: () => Boolean(apiKey()),
  fetchScores,
  health: () => ({ id: 'the-odds-api-scores', configured: Boolean(apiKey()), supportedSports: [...SUPPORTED_SPORTS], diagnostics: snapshotDiagnostics() }),
});
