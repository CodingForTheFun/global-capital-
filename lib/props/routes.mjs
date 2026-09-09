// Shared prop API routes, mounted by every Scout Pro server.
//
// One implementation so All Props, Auto Prop Finder and the prop detail view
// behave identically no matter which server binary is running.
//
// All provider calls happen here, server-side. No key, endpoint, header or
// provider response ever reaches the browser.

import { buildUnifiedPropViewAsync } from './universe.mjs';
import { filtersFromQuery, normalizeFilters } from '../filters/index.mjs';
import { similarFiltersFor, SORTS } from '../scoring/index.mjs';
import { providerStatus, getProvider } from '../data-sources/registry.mjs';
import { sportsDataIoPropBoard } from '../data-sources/sportsdataio/prop-board.mjs';
import { publicMessageFor, internalDetail, GENERIC_MESSAGE } from '../safe-error.mjs';

const MAX_LIMIT = 500;

function parsePaging(params) {
  const limit = Number(params.get('limit'));
  const offset = Number(params.get('offset'));
  return {
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, MAX_LIMIT) : 250,
    offset: Number.isFinite(offset) && offset > 0 ? offset : 0,
  };
}

function sortFrom(params) {
  const requested = String(params.get('sort') || '').trim();
  return Object.values(SORTS).includes(requested) ? requested : SORTS.SCORE_DESC;
}

/**
 * @param {object} deps  { readLatest, json, log }
 * @returns {Promise<boolean>} true when the request was handled
 */
export async function handlePropRoutes(req, res, url, { readLatest, json, log = console }) {
  const path = url.pathname;
  if (!path.startsWith('/api/props') && path !== '/api/providers') return false;
  if (req.method !== 'GET') return false;

  // Provider diagnostics: health + runtime entitlement matrix for the key that
  // exists inside Railway. No credential, auth header or raw response body is
  // ever returned. `force=1` re-probes the matrix server-side and also checks
  // the current per-game player-prop board using safe counts only.
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
    const filters = filtersFromQuery(url.search);
    const sort = sortFrom(url.searchParams);
    const { limit, offset } = parsePaging(url.searchParams);

    // Auto Prop Finder: the SAME filtered population, ranked. Provider-native
    // rows can participate in browsing immediately; Scout Rules still fail
    // closed until the required historical evidence exists for a row.
    if (path === '/api/props/best') {
      const view = await buildUnifiedPropViewAsync(scan, {
        filters,
        sort: SORTS.SCORE_DESC,
        limit: Math.min(limit, 100),
        offset: 0,
      });
      json(res, 200, {
        ranked: view.props.map((prop, index) => ({ ...prop, rank: index + 1 })),
        counts: view.counts,
        filters: view.filters,
        availableFilters: view.availableFilters,
        emptyReason: view.emptyReason,
        providers: view.providers,
        scannedAt: view.scannedAt,
        universe: view.universe,
      });
      return true;
    }

    // One prop's full detail, including its score breakdown, Find Similar and
    // (when provider identity is available) a real SportsDataIO game-log
    // analysis. This provider call is DETAIL ONLY — never list rendering.
    if (path === '/api/props/detail') {
      const id = String(url.searchParams.get('id') || '');
      const view = await buildUnifiedPropViewAsync(scan, { filters: {}, limit: null });
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
      });
      return true;
    }

    // All Props. Defaults to 250 rows and accepts up to 500 explicitly. There
    // is no hidden eight-row cap anywhere in this route or the pipeline.
    if (path === '/api/props') {
      const view = await buildUnifiedPropViewAsync(scan, { filters, sort, limit, offset });
      json(res, 200, view);
      return true;
    }
  } catch (error) {
    log?.error?.('[Scout Pro props] request failed', JSON.stringify(internalDetail(error, { stage: 'props-route', path })));
    json(res, 500, { ok: false, message: publicMessageFor(error, GENERIC_MESSAGE) });
    return true;
  }

  return false;
}
