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
import { providerStatus } from '../data-sources/registry.mjs';
import { publicMessageFor, internalDetail, GENERIC_MESSAGE } from '../safe-error.mjs';

const MAX_LIMIT = 250;

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
export async function handlePropRoutes(req, res, url, { readLatest, json, log = console }) {
  const path = url.pathname;
  if (!path.startsWith('/api/props') && path !== '/api/providers') return false;
  if (req.method !== 'GET') return false;

  // Provider status: names, capabilities and health only. Never credentials.
  if (path === '/api/providers') {
    json(res, 200, { providers: providerStatus() });
    return true;
  }

  try {
    const scan = await readLatest();
    const filters = filtersFromQuery(url.search);
    const sort = sortFrom(url.searchParams);
    const { limit, offset } = parsePaging(url.searchParams);

    // Auto Prop Finder: the SAME filtered population, ranked.
    if (path === '/api/props/best') {
      const view = await findBestPropsAsync(scan, { filters, limit: Math.min(limit, 50) });
      json(res, 200, {
        ranked: view.ranked,
        counts: view.counts,
        filters: view.filters,
        availableFilters: view.availableFilters,
        emptyReason: view.emptyReason,
        providers: view.providers,
        scannedAt: view.scannedAt,
      });
      return true;
    }

    // One prop's full detail, including its score breakdown and Find Similar.
    if (path === '/api/props/detail') {
      const id = String(url.searchParams.get('id') || '');
      // No filters: a detail view must resolve a prop even when the current
      // filters would exclude it.
      const view = await buildPropViewAsync(scan, { filters: {}, limit: null });
      const prop = view.props.find((row) => row.id === id) || null;
      if (!prop) { json(res, 404, { ok: false, message: 'That prop is no longer in the latest scan.' }); return true; }
      json(res, 200, {
        prop,
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
      json(res, 200, view);
      return true;
    }
  } catch (error) {
    log?.error?.('[AutoProp props] request failed', JSON.stringify(internalDetail(error, { stage: 'props-route', path })));
    json(res, 500, { ok: false, message: publicMessageFor(error, GENERIC_MESSAGE) });
    return true;
  }

  return false;
}
