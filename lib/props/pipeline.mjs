// rawProps -> normalize -> filter -> [rules] -> score -> sort -> render
//
// All Props, Auto Prop Finder, saved props and every future prop surface call
// THIS function. That is what guarantees they filter identically — there is no
// second code path where a page could drift.

import { fromScanResult, isSetNumber } from './model.mjs';
import { applyPropFilters, normalizeFilters, filterCounts, explainEmptyResult, availableFilters } from '../filters/index.mjs';
import { scoreProps, sortProps, SORTS } from '../scoring/index.mjs';

/**
 * @param {object} scanResult  latest.json from the scanner
 * @param {object} options     { filters, sort, limit, offset }
 */
export function buildPropView(scanResult, { filters = {}, sort = SORTS.SCORE_DESC, limit = null, offset = 0 } = {}) {
  const normalized = normalizeFilters(filters);

  // 1. Normalize + de-duplicate, then score, so score-based filters have a
  //    value to test against. Scoring is independent of the user's filters.
  const universe = scoreProps(fromScanResult(scanResult));

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
    scannedAt: scanResult?.scannedAt || null,
  };
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
