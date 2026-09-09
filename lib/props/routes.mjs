// Shared prop API routes, mounted by every Scout Pro server.
//
// One implementation so All Props, Auto Prop Finder and the prop detail view
// behave identically no matter which server binary is running.
//
// All provider calls happen here, server-side. No key, endpoint, header or
// provider response ever reaches the browser.

import { buildPropViewAsync, findBestPropsAsync } from './pipeline.mjs';
import { filtersFromQuery, normalizeFilters } from '../filters/index.mjs';
import { similarFiltersFor, SORTS } from '../scoring/index.mjs';
import { providerStatus, getProvider } from '../data-sources/registry.mjs';
import { publicMessageFor, publicErrorFromRecord, internalDetail, GENERIC_MESSAGE } from '../safe-error.mjs';

const MAX_LIMIT = 250;

/**
 * Why the board is empty. Without this the UI cannot tell "no scan has ever
 * run" from "your filters excluded everything", and both look like a page
 * stuck on Loading.
 */
function describeScanState(scan, errorRecord, counts) {
  const pickCount = Array.isArray(scan?.picks) ? scan.picks.length : 0;
  const surfaced = errorRecord ? publicErrorFromRecord(errorRecord, GENERIC_MESSAGE) : { message: null, code: null };

  if (!scan) {
    return {
      status: 'no-scan',
      scannedAt: null,
      pickCount: 0,
      message: surfaced.message
        || 'No scan has completed yet. Connect PickFinder and run a scan to populate the board.',
      code: surfaced.code,
    };
  }
  if (pickCount === 0) {
    return {
      status: 'scan-empty',
      scannedAt: scan.scannedAt || null,
      pickCount: 0,
      message: surfaced.message || 'The last scan finished without finding any props.',
      code: surfaced.code,
    };
  }
  if (counts && counts.matching === 0) {
    return {
      status: 'filtered-out',
      scannedAt: scan.scannedAt || null,
      pickCount,
      message: `All ${pickCount} scanned props were excluded by the current filters.`,
      code: null,
    };
  }
  return {
    status: 'ok',
    scannedAt: scan.scannedAt || null,
    pickCount,
    // A stale error is still worth surfacing alongside good data.
    message: surfaced.message,
    code: surfaced.code,
  };
}

function parsePaging(params) {
  const limit = Number(params.get('limit'));
  const offset = Number(params.get('offset'));
  return {
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, MAX_LIMIT) : 100,
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
export async function handlePropRoutes(req, res, url, { readLatest, readLastError = async () => null, json, log = console }) {
  const path = url.pathname;
  if (!path.startsWith('/api/props') && path !== '/api/providers') return false;
  if (req.method !== 'GET') return false;

  // Provider diagnostics: health + runtime entitlement matrix for the key that
  // exists inside Railway. No credential, auth header or raw response body is
  // ever returned. `force=1` re-probes the matrix server-side and, only on that
  // explicit diagnostic request, checks whether PrizePicks appears in the
  // current player-props feeds. This is how we decide whether browser scanning
  // can be reduced without guessing.
  if (path === '/api/providers') {
    const providers = providerStatus();
    const sportsdataio = getProvider('sportsdataio');
    const force = ['1', 'true', 'yes'].includes(String(url.searchParams.get('force') || '').toLowerCase());
    let entitlementMatrix = null;
    let providerStats = null;
    let operatorCoverage = null;
    if (sportsdataio) {
      try {
        providerStats = typeof sportsdataio.stats === 'function' ? sportsdataio.stats() : null;
        if (typeof sportsdataio.entitlements === 'function' && sportsdataio.isConfigured?.()) {
          entitlementMatrix = await sportsdataio.entitlements({ force });
        }
        if (force && typeof sportsdataio.operatorCoverage === 'function' && sportsdataio.isConfigured?.()) {
          operatorCoverage = await sportsdataio.operatorCoverage({ sportsbook: 'PrizePicks' });
        }
      } catch (error) {
        log?.error?.('[AutoProp providers] diagnostics failed', JSON.stringify(internalDetail(error, { stage: 'provider-diagnostics' })));
      }
    }
    json(res, 200, {
      providers,
      sportsdataio: {
        entitlements: entitlementMatrix,
        stats: providerStats,
        operatorCoverage,
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

    // Auto Prop Finder: the SAME filtered population, ranked.
    if (path === '/api/props/best') {
      const view = await findBestPropsAsync(scan, { filters, limit: Math.min(limit, 50) });
      json(res, 200, {
        ranked: view.ranked,
        counts: view.counts,
        scanState: describeScanState(scan, errorRecord, view.counts),
        filters: view.filters,
        availableFilters: view.availableFilters,
        emptyReason: view.emptyReason,
        providers: view.providers,
        scannedAt: view.scannedAt,
      });
      return true;
    }

    // One prop's full detail, including its score breakdown, Find Similar and
    // (when provider identity is available) a real SportsDataIO game-log
    // analysis. This provider call is DETAIL ONLY — never list rendering.
    if (path === '/api/props/detail') {
      const id = String(url.searchParams.get('id') || '');
      // No filters: a detail view must resolve a prop even when the current
      // filters would exclude it.
      const view = await buildPropViewAsync(scan, { filters: {}, limit: null });
      const prop = view.props.find((row) => row.id === id) || null;
      if (!prop) { json(res, 404, { ok: false, message: 'That prop is no longer in the latest scan.' }); return true; }

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
            log?.error?.('[AutoProp props] detail analytics failed', JSON.stringify(internalDetail(error, { stage: 'detail-analytics', sport: prop.sport })));
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
      });
      return true;
    }

    // All Props.
    if (path === '/api/props') {
      const view = await buildPropViewAsync(scan, { filters, sort, limit, offset });
      json(res, 200, { ...view, scanState: describeScanState(scan, errorRecord, view.counts) });
      return true;
    }
  } catch (error) {
    log?.error?.('[AutoProp props] request failed', JSON.stringify(internalDetail(error, { stage: 'props-route', path })));
    json(res, 500, { ok: false, message: publicMessageFor(error, GENERIC_MESSAGE) });
    return true;
  }

  return false;
}
