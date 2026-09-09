// Shared Scout Pro API routes for props, provider health and live intelligence.
// Provider credentials and raw provider payloads never reach the browser.

import { buildUnifiedPropViewAsync } from './universe.mjs';
import { filtersFromQuery, normalizeFilters } from '../filters/index.mjs';
import { similarFiltersFor, SORTS } from '../scoring/index.mjs';
import { providerStatus, getProvider } from '../data-sources/registry.mjs';
import { sportsDataIoPropBoard } from '../data-sources/sportsdataio/prop-board.mjs';
import { handleLiveRoutes } from '../live/routes.mjs';
import { liveService } from '../live/service.mjs';
import { publicMessageFor, publicErrorFromRecord, internalDetail, GENERIC_MESSAGE } from '../safe-error.mjs';

const MAX_LIMIT = 500;
const MAX_HISTORY_PAGE = 100;

/**
 * Why the board is empty.
 *
 * The universe has TWO sources: the SportsDataIO prop board and the PickFinder
 * scan. An empty page can mean neither produced anything, or that both did and
 * the filters excluded it all. Those need different actions from the operator,
 * so the API says which it is rather than returning a bare empty list.
 */
function describeBoardState(scan, errorRecord, view) {
  const counts = view?.counts || {};
  const meta = view?.universe || {};
  const scanPicks = Array.isArray(scan?.picks) ? scan.picks.length : 0;
  const providerOffers = Number(meta.providerProps ?? meta.providerOffers ?? 0) || 0;
  const surfaced = errorRecord ? publicErrorFromRecord(errorRecord, GENERIC_MESSAGE) : { message: null, code: null };
  const total = Number(counts.total ?? 0) || 0;

  const base = {
    sourceMode: meta.sourceMode ?? null,
    providerOffers,
    scanPicks,
    scannedAt: scan?.scannedAt ?? null,
    code: surfaced.code,
  };

  if (total === 0) {
    // Neither source produced a usable prop. Name the one the operator can act on.
    let message;
    if (providerOffers === 0 && scanPicks === 0) {
      message = surfaced.message
        || 'No props available. The SportsDataIO prop board returned nothing and no PickFinder scan has completed. Check /api/health/providers for feed coverage.';
    } else {
      // Something arrived but nothing survived normalization — usually an offer
      // with no resolvable player, which is dropped rather than shown as blank.
      message = `Sources returned data (${providerOffers} provider offers, ${scanPicks} scanned picks) but none produced a displayable prop.`;
    }
    return { ...base, status: 'empty', message };
  }

  if (Number(counts.matching ?? 0) === 0) {
    return { ...base, status: 'filtered-out', message: `All ${total} available props were excluded by the current filters.` };
  }

  return { ...base, status: 'ok', message: surfaced.message };
}

export async function handlePropRoutes(req, res, url, { readLatest, readLastError = async () => null, json, log = console }) {
  const path = url.pathname;
  if (req.method !== 'GET') return false;

  if (path.startsWith('/api/live')) {
    return handleLiveRoutes(req, res, url, { readLatest, json, log });
  }

  if (path === '/api/health') {
    const providers = providerStatus();
    json(res, 200, {
      app: 'ok',
      service: 'scout-pro',
      time: new Date().toISOString(),
      cache: 'memory',
      worker: 'ready',
      providers: providers.map((provider) => ({ id: provider.id, status: provider.status })),
    });
    return true;
  }

  if (path === '/api/health/providers') {
    const providers = providerStatus();
    json(res, 200, {
      checkedAt: new Date().toISOString(),
      providers,
      propBoard: sportsDataIoPropBoard.stats(),
      live: liveService.stats(),
    });
    return true;
  }

  if (!path.startsWith('/api/props') && path !== '/api/providers') return false;

  if (path === '/api/providers') {
    const providers = providerStatus();
    const sportsdataio = getProvider('sportsdataio');
    const force = ['1', 'true', 'yes'].includes(String(url.searchParams.get('force') || '').toLowerCase());
    let entitlementMatrix = null;
    let providerStats = null;
    let operatorCoverage = null;
    let playerPropBoard = null;
    if (sportsdataio) {
      try {
        providerStats = typeof sportsdataio.stats === 'function' ? sportsdataio.stats() : null;
        if (typeof sportsdataio.entitlements === 'function' && sportsdataio.isConfigured?.()) {
          entitlementMatrix = await sportsdataio.entitlements({ force });
        }
        if (force && typeof sportsdataio.operatorCoverage === 'function' && sportsdataio.isConfigured?.()) {
          operatorCoverage = await sportsdataio.operatorCoverage({ sportsbook: 'PrizePicks' });
        }
        if (force && sportsdataio.isConfigured?.()) {
          const board = await sportsDataIoPropBoard.fetchBoard({ force: true });
          playerPropBoard = {
            fetchedAt: board.fetchedAt,
            latencyMs: board.latencyMs,
            totalOffers: Array.isArray(board.offers) ? board.offers.length : 0,
            coverage: board.coverage,
            clientStats: board.clientStats,
          };
        }
      } catch (error) {
        log?.error?.('[Scout Pro providers] diagnostics failed', JSON.stringify(internalDetail(error, { stage: 'provider-diagnostics' })));
      }
    }
    json(res, 200, {
      providers,
      sportsdataio: {
        entitlements: entitlementMatrix,
        stats: providerStats,
        operatorCoverage,
        playerPropBoard,
      },
    });
    return true;
  }

  try {
    const scan = await readLatest();
    const errorRecord = await readLastError().catch(() => null);
    const filters = filtersFromQuery(url.search);
    const sort = sortFrom(url.searchParams);
    const { limit, offset } = parsePaging(url.searchParams);

    if (path === '/api/props/best') {
      const pageLimit = Math.min(limit, MAX_HISTORY_PAGE);
      const view = await buildUnifiedPropViewAsync(scan, {
        filters,
        sort: SORTS.SCORE_DESC,
        limit: pageLimit,
        offset: 0,
        hydrateHistory: true,
      });
      json(res, 200, {
        ranked: view.props.map((prop, index) => ({ ...prop, rank: index + 1 })),
        counts: view.counts,
        scanState: describeScanState(scan, errorRecord, view.counts),
        filters: view.filters,
        availableFilters: view.availableFilters,
        emptyReason: view.emptyReason,
        providers: view.providers,
        scannedAt: view.scannedAt,
        universe: view.universe,
        boardState: describeBoardState(scan, errorRecord, view),
      });
      return true;
    }

    // Full detail deliberately does not hydrate the whole universe. It performs
    // exactly one detail-only playerGameLog call for the selected prop below.
    if (path === '/api/props/detail') {
      const id = String(url.searchParams.get('id') || '');
      const view = await buildUnifiedPropViewAsync(scan, { filters: {}, limit: null, hydrateHistory: false });
      const prop = view.props.find((row) => row.id === id) || null;
      if (!prop) {
        json(res, 404, { ok: false, message: 'That prop is no longer in the latest board.' });
        return true;
      }

      let analytics = null;
      if (prop.providerPlayerId) {
        const adapter = getProvider('sportsdataio');
        if (adapter && typeof adapter.playerGameLog === 'function' && adapter.isConfigured?.()) {
          try {
            analytics = await adapter.playerGameLog({
              sport: prop.sport,
              playerId: prop.providerPlayerId,
              market: prop.market,
              line: prop.line,
              side: prop.side,
            });
          } catch (error) {
            log?.error?.('[Scout Pro props] detail analytics failed', JSON.stringify(internalDetail(error, { stage: 'detail-analytics', sport: prop.sport })));
          }
        }
      }

      json(res, 200, {
        prop,
        analytics,
        scoreBreakdown: prop.scoreBreakdown,
        similarFilters: normalizeFilters(similarFiltersFor(prop)),
        providers: view.providers,
        scannedAt: view.scannedAt,
        universe: view.universe,
        boardState: describeBoardState(scan, errorRecord, view),
      });
      return true;
    }

    if (path === '/api/props') {
      const view = await buildUnifiedPropViewAsync(scan, {
        filters,
        sort,
        limit,
        offset,
        // The UI uses 25/50/100 pages. A direct API request can still ask for
        // up to 500 rows, but we avoid an uncontrolled game-log fan-out there.
        hydrateHistory: limit <= MAX_HISTORY_PAGE,
      });
      json(res, 200, { ...view, boardState: describeBoardState(scan, errorRecord, view) });
      return true;
    }
  } catch (error) {
    log?.error?.('[Scout Pro props] request failed', JSON.stringify(internalDetail(error, { stage: 'props-route', path })));
    json(res, 500, { ok: false, message: publicMessageFor(error, GENERIC_MESSAGE) });
    return true;
  }

  return false;
}
