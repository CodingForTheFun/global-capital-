// rawProps -> normalize -> filter -> [rules] -> score -> sort -> render
//
// All Props, Auto Prop Finder, saved props and every future prop surface call
// THIS function. That is what guarantees they filter identically — there is no
// second code path where a page could drift.

import { fromScanResult, isSetNumber } from './model.mjs';
import { applyPropFilters, normalizeFilters, filterCounts, explainEmptyResult, availableFilters } from '../filters/index.mjs';
import { scoreProps, sortProps, SORTS } from '../scoring/index.mjs';
import { enrichProps } from '../data-sources/enrich.mjs';

/**
 * @param {object} scanResult  latest.json from the scanner
 * @param {object} options     { filters, sort, limit, offset }
 */
/**
 * Synchronous view over already-enriched props. Used by buildPropViewAsync and
 * directly by callers that have their own enriched population.
 */
export function buildPropViewFrom(props, { filters = {}, sort = SORTS.SCORE_DESC, limit = null, offset = 0, scannedAt = null, providers = [] } = {}) {
  const normalized = normalizeFilters(filters);
  const universe = scoreProps(props);

  // 2. Counts are computed before rules are applied, so the UI can show
  //    "47 matching props / 12 Scout qualifiers" from one pass.
  const counts = filterCounts(universe, normalized);

  // 3. The same filter engine, including the optional Scout-rules constraint.
  const filtered = applyPropFilters(universe, normalized);

  // 4. Sort, then page.
  const sorted = sortProps(filtered, sort);
  // An unset limit means "no limit", never a zero-length page.
  const paged = isSetNumber(limit) ? sorted.slice(offset, offset + Number(limit)) : sorted;

  return {
    props: paged,
    counts: { ...counts, returned: paged.length, filtered: sorted.length },
    sort,
    filters: normalized,
    availableFilters: availableFilters(universe),
    emptyReason: sorted.length === 0 ? explainEmptyResult(universe, normalized) : null,
    scannedAt,
    providers,
  };
}

/** Backwards-compatible synchronous view straight from a scan result. */
export function buildPropView(scanResult, options = {}) {
  return buildPropViewFrom(fromScanResult(scanResult), { ...options, scannedAt: scanResult?.scannedAt || null });
}

/**
 * The full pipeline, including provider enrichment.
 *
 * Enrichment is best-effort: if every provider fails, this returns exactly what
 * buildPropView would have, plus provider status saying why. A provider outage
 * degrades the data, never the page.
 */
export async function buildPropViewAsync(scanResult, options = {}) {
  const base = fromScanResult(scanResult);
  let enriched = base;
  let providers = [];
  try {
    const result = await enrichProps(base);
    enriched = result.props;
    providers = result.providers;
  } catch {
    // enrichProps already isolates provider failures; this is belt-and-braces
    // so nothing in the provider layer can ever break a prop view.
    enriched = base;
  }
  return buildPropViewFrom(enriched, { ...options, scannedAt: scanResult?.scannedAt || null, providers });
}

/**
 * Auto Prop Finder: identical pipeline, ranked, top N.
 *
 * It deliberately shares buildPropView rather than re-filtering, so the ranked
 * list is always drawn from exactly the population All Props is showing.
 */
export function findBestProps(scanResult, { filters = {}, limit = 25 } = {}) {
  const view = buildPropView(scanResult, { filters, sort: SORTS.SCORE_DESC, limit });
  return {
    ...view,
    ranked: view.props.map((prop, index) => ({ ...prop, rank: index + 1 })),
  };
}

/** Auto Prop Finder over the enriched population. */
export async function findBestPropsAsync(scanResult, { filters = {}, limit = 25 } = {}) {
  const view = await buildPropViewAsync(scanResult, { filters, sort: SORTS.SCORE_DESC, limit });
  return { ...view, ranked: view.props.map((prop, index) => ({ ...prop, rank: index + 1 })) };
}
