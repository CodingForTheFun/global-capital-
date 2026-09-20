import { backfillH2H } from './h2h-backfill.mjs';
import { fetchPublicResearch, PUBLIC_LEAGUES } from './research.mjs';
import { canonicalSport } from './stat-contract.mjs';
import { fantasyScoringMeta, fantasyScoringSupported, fantasySpec, scoreFantasyRow } from '../../props/fantasy-scoring.mjs';

const TTL_MS = 2 * 60 * 60_000;
const cache = new Map();
const pending = new Map();

const text = value => String(value ?? '').trim();

function athleteId(history, sport) {
  const raw = text(history?.player?.providerPlayerId);
  const prefix = `history:${sport}:`;
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : null;
}

async function rawRequest(path, fetchImpl, now) {
  const hit = cache.get(path);
  if (hit && hit.expires > now()) return hit.value;
  if (pending.has(path)) return pending.get(path);
  const work = (async () => {
    try {
      const response = await fetchImpl(path, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
      if (!response.ok) return null;
      const value = await response.json();
      cache.set(path, { value, expires: now() + TTL_MS });
      while (cache.size > 1200) cache.delete(cache.keys().next().value);
      return value;
    } catch {
      return null;
    }
  })().finally(() => pending.delete(path));
  pending.set(path, work);
  return work;
}

function rawRows(payload) {
  const names = Array.isArray(payload?.names) ? payload.names : [];
  if (!names.length || new Set(names).size !== names.length) return new Map();
  const rows = new Map();
  for (const group of payload?.seasonTypes || []) {
    for (const category of group?.categories || []) {
      if (category?.type !== 'event') continue;
      for (const event of category?.events || []) {
        if (!event?.eventId || !Array.isArray(event.stats) || event.stats.length !== names.length) continue;
        rows.set(String(event.eventId), Object.fromEntries(names.map((name, index) => [name, event.stats[index]])));
      }
    }
  }
  return rows;
}

async function loadRawSeasons(history, spec, params, options) {
  const sport = canonicalSport(params.sport);
  const [family, league] = PUBLIC_LEAGUES[sport] || [];
  const id = athleteId(history, sport);
  if (!family || !league || !id) return { rows: new Map(), providerError: false };
  const fetchImpl = options.fetchImpl || ((...args) => fetch(...args));
  const now = options.now || (() => Date.now());
  const seasons = [...new Set((history.gameLog || []).map(row => String(row?.season || '')).filter(Boolean))];
  const output = new Map();
  for (const season of seasons) {
    const query = new URLSearchParams({ season });
    if (spec.category) query.set('category', spec.category);
    const path = `https://site.web.api.espn.com/apis/common/v3/sports/${family}/${league}/athletes/${encodeURIComponent(id)}/gamelog?${query}`;
    const payload = await rawRequest(path, fetchImpl, now);
    if (!payload) return { rows: output, providerError: true };
    for (const [eventId, values] of rawRows(payload)) output.set(`${sport.toLowerCase()}:${eventId}`, values);
  }
  return { rows: output, providerError: false };
}

/**
 * Reconstruct fantasy-score history only for source + sport combinations whose
 * exact platform formula is verified. `null` means this selection is not one
 * of those combinations and should keep the normal line-only policy.
 */
export async function fetchFantasyResearch(params = {}, options = {}) {
  if (!fantasyScoringSupported(params)) return null;
  const spec = fantasySpec(params);
  const proxyParams = { ...params, market: spec.proxyMarket, providerMarketKey: spec.proxyMarketKey };
  let history = await (options.fetchHistory || fetchPublicResearch)(proxyParams);
  if (!history?.available) {
    return { ...(history || {}), fantasyScoring: fantasyScoringMeta(spec) };
  }

  // Do the deeper opponent walk on the ordinary measured stat first; that path
  // can be independently validated by inspectGameLog. The fantasy conversion
  // then applies to the same verified event ids.
  history = await backfillH2H(history, proxyParams, options);
  const rawResult = await loadRawSeasons(history, spec, params, options);
  if (rawResult.providerError) {
    return {
      ok: true,
      available: false,
      retryable: true,
      code: 'RESEARCH_PROVIDER_ERROR',
      message: 'Historical fantasy scoring components are temporarily unavailable. Please retry.',
      gameLog: [],
      source: history.source,
      player: history.player,
      opponent: history.opponent,
      opponentId: history.opponentId,
      season: history.season,
      fantasyScoring: fantasyScoringMeta(spec),
    };
  }
  const raw = rawResult.rows;
  const scored = [];
  let excluded = 0;
  for (const row of history.gameLog || []) {
    const value = scoreFantasyRow(row, spec, raw.get(row.gameId) || null);
    if (value === null) { excluded += 1; continue; }
    scored.push({ ...row, value, fantasyScore: value });
  }

  if (!scored.length || excluded > 0) {
    return {
      ok: true,
      available: false,
      lineOnly: true,
      retryable: false,
      code: 'FANTASY_COMPONENTS_INCOMPLETE',
      message: excluded
        ? 'This fantasy line stays line-only because at least one verified game is missing a scoring component required by the platform formula.'
        : 'This fantasy line stays line-only because its exact historical scoring components were not returned.',
      gameLog: [],
      source: history.source,
      player: history.player,
      opponent: history.opponent,
      opponentId: history.opponentId,
      season: history.season,
      fantasyScoring: fantasyScoringMeta(spec),
    };
  }

  return {
    ...history,
    gameLog: scored,
    marketDisplayName: spec.label,
    statKind: `fantasy:${spec.id}`,
    fantasyScoring: fantasyScoringMeta(spec),
    coverage: { ...(history.coverage || {}), fantasyGamesScored: scored.length, fantasyGamesExcluded: 0 },
  };
}
