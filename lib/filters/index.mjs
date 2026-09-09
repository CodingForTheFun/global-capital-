// The universal Scout Pro filter engine.
//
// ONE engine, used by All Props, Auto Prop Finder, ranked results, saved props,
// favourites, per-sport / per-game / per-player views, and anything added later.
// There is deliberately no second filter implementation anywhere in the codebase.
//
// Two rules make it consistent:
//
//  1. Every prop is evaluated by the same function, evaluatePropAgainstFilters().
//     Filtering is performed against normalized structured data, never against
//     rendered text, and never applied "visually" in a component.
//
//  2. A filter that cannot apply to a prop is INAPPLICABLE, not a failure. A
//     three-pointer filter does not silently delete NFL rushing props; it simply
//     does not constrain them. Availability is decided by isFilterApplicable().

import { SIDES, QUALITY_TIERS, qualityTierFor, isSetNumber, toNumberOrNull } from '../props/model.mjs';

export const EMPTY_FILTERS = Object.freeze({
  search: '',
  sports: [],
  markets: [],
  side: 'ALL',
  players: [],
  teams: [],
  opponents: [],
  games: [],
  timeWindow: 'ALL',        // ALL | TODAY
  minScore: null,
  maxScore: null,
  qualityTiers: [],
  minConfidence: null,
  minEdge: null,
  maxEdge: null,
  positiveEdgeOnly: false,
  hitRateWindow: 'l10',     // which window minHitRate applies to
  minHitRate: null,
  matchup: [],              // STRONG | NEUTRAL | WEAK
  ruleStatus: 'ALL',        // ALL | PASSED | FAILED
  minRulesPassed: null,
  maxDataAgeMinutes: null,
  applyScoutRules: false,
});

export function normalizeFilters(input = {}) {
  const filters = { ...EMPTY_FILTERS, ...(input || {}) };
  const upperList = (value) => (Array.isArray(value) ? value : value ? [value] : [])
    .map((item) => String(item).trim().toUpperCase())
    .filter(Boolean);

  return {
    ...filters,
    search: String(filters.search ?? '').trim(),
    sports: upperList(filters.sports),
    markets: upperList(filters.markets),
    side: SIDES.includes(String(filters.side).toUpperCase()) ? String(filters.side).toUpperCase() : 'ALL',
    players: upperList(filters.players),
    teams: upperList(filters.teams),
    opponents: upperList(filters.opponents),
    games: upperList(filters.games),
    timeWindow: String(filters.timeWindow || 'ALL').toUpperCase(),
    qualityTiers: upperList(filters.qualityTiers),
    matchup: upperList(filters.matchup),
    ruleStatus: String(filters.ruleStatus || 'ALL').toUpperCase(),
    hitRateWindow: String(filters.hitRateWindow || 'l10').toLowerCase(),
    applyScoutRules: filters.applyScoutRules === true,
    positiveEdgeOnly: filters.positiveEdgeOnly === true,
  };
}

/** Which filters are meaningful for this prop's sport/market. */
export function isFilterApplicable(filterId, prop) {
  if (!prop) return false;
  switch (filterId) {
    case 'minEdge':
    case 'maxEdge':
    case 'positiveEdgeOnly':
      return prop.edge !== null && prop.edge !== undefined;
    case 'minHitRate':
      return Object.values(prop.hitRates || {}).some(isSetNumber);
    case 'matchup':
      return (prop.contextSplits || []).some((row) => /opponent/i.test(row.label || '') && isSetNumber(row.hitRate));
    case 'minScore':
    case 'maxScore':
    case 'qualityTiers':
      return isSetNumber(prop.score);
    case 'minConfidence':
      return isSetNumber(prop.confidence);
    case 'maxDataAgeMinutes':
      return Boolean(prop.updatedAt);
    case 'teams':
      return Boolean(prop.team);
    default:
      return true;
  }
}

/**
 * Which filter controls the UI should offer for a given prop population.
 * A control with no supporting data in the current dataset is reported
 * unavailable so the UI can disable or hide it rather than lie.
 */
export function availableFilters(props = []) {
  const ids = ['search', 'sports', 'markets', 'side', 'players', 'opponents', 'games', 'timeWindow', 'ruleStatus', 'minRulesPassed'];
  const conditional = ['minScore', 'maxScore', 'qualityTiers', 'minConfidence', 'minEdge', 'maxEdge', 'positiveEdgeOnly', 'minHitRate', 'matchup', 'maxDataAgeMinutes', 'teams'];
  const available = new Set(ids);
  for (const id of conditional) {
    if (props.some((prop) => isFilterApplicable(id, prop))) available.add(id);
  }
  return [...available];
}

/** Matchup strength derived from the verified opponent split — never invented. */
export function matchupRating(prop) {
  const row = (prop?.contextSplits || []).find((item) => /opponent/i.test(item.label || '') && isSetNumber(item.hitRate));
  if (!row) return null;
  const rate = Number(row.hitRate);
  if (rate >= 75) return 'STRONG';
  if (rate >= 55) return 'NEUTRAL';
  return 'WEAK';
}

function searchHaystack(prop) {
  return [
    prop.playerName, prop.team, prop.opponent, prop.sport, prop.league,
    prop.market, prop.gameId, prop.side,
  ].filter(Boolean).join(' ').toLowerCase();
}

function hitRateFor(prop, window) {
  const rates = prop.hitRates || {};
  if (window === 'best') {
    const values = Object.values(rates).filter(isSetNumber).map(Number);
    return values.length ? Math.max(...values) : null;
  }
  return toNumberOrNull(rates[window]);
}

/**
 * Evaluate ONE prop against the full filter set.
 *
 * @returns {{matchesFilters: boolean, failedFilters: string[], appliedFilters: string[], inapplicableFilters: string[]}}
 */
export function evaluatePropAgainstFilters(prop, rawFilters = {}) {
  const filters = normalizeFilters(rawFilters);
  const failed = [];
  const applied = [];
  const inapplicable = [];

  // `check` runs a constraint only when the user set it AND it applies here.
  const check = (id, isSet, applies, passes) => {
    if (!isSet) return;
    if (!applies) { inapplicable.push(id); return; }
    applied.push(id);
    if (!passes()) failed.push(id);
  };

  check('search', Boolean(filters.search), true,
    () => searchHaystack(prop).includes(filters.search.toLowerCase()));

  check('sports', filters.sports.length > 0, true,
    () => filters.sports.includes(String(prop.sport || '').toUpperCase()));

  check('markets', filters.markets.length > 0, true,
    () => filters.markets.includes(String(prop.market || '').toUpperCase()));

  check('side', filters.side !== 'ALL', true,
    () => String(prop.side || '').toUpperCase() === filters.side);

  check('players', filters.players.length > 0, true,
    () => filters.players.includes(String(prop.playerName || '').toUpperCase()));

  check('teams', filters.teams.length > 0, isFilterApplicable('teams', prop),
    () => filters.teams.includes(String(prop.team || '').toUpperCase()));

  check('opponents', filters.opponents.length > 0, true,
    () => filters.opponents.includes(String(prop.opponent || '').toUpperCase()));

  check('games', filters.games.length > 0, true,
    () => filters.games.includes(String(prop.gameId || '').toUpperCase()));

  check('timeWindow', filters.timeWindow === 'TODAY', true,
    () => prop.isToday === true);

  check('minScore', isSetNumber(filters.minScore), isFilterApplicable('minScore', prop),
    () => Number(prop.score) >= Number(filters.minScore));

  check('maxScore', isSetNumber(filters.maxScore), isFilterApplicable('maxScore', prop),
    () => Number(prop.score) <= Number(filters.maxScore));

  check('qualityTiers', filters.qualityTiers.length > 0, isFilterApplicable('qualityTiers', prop),
    () => filters.qualityTiers.includes(String(prop.qualityTier || qualityTierFor(prop.score) || '').toUpperCase()));

  check('minConfidence', isSetNumber(filters.minConfidence), isFilterApplicable('minConfidence', prop),
    () => Number(prop.confidence) >= Number(filters.minConfidence));

  check('minEdge', isSetNumber(filters.minEdge), isFilterApplicable('minEdge', prop),
    () => Number(prop.edge) >= Number(filters.minEdge));

  check('maxEdge', isSetNumber(filters.maxEdge), isFilterApplicable('maxEdge', prop),
    () => Number(prop.edge) <= Number(filters.maxEdge));

  check('positiveEdgeOnly', filters.positiveEdgeOnly, isFilterApplicable('positiveEdgeOnly', prop),
    () => Number(prop.edge) > 0);

  check('minHitRate', isSetNumber(filters.minHitRate), isFilterApplicable('minHitRate', prop),
    () => {
      const rate = hitRateFor(prop, filters.hitRateWindow);
      return rate !== null && rate >= Number(filters.minHitRate);
    });

  check('matchup', filters.matchup.length > 0, isFilterApplicable('matchup', prop),
    () => filters.matchup.includes(matchupRating(prop)));

  check('ruleStatus', filters.ruleStatus !== 'ALL', true,
    () => (filters.ruleStatus === 'PASSED' ? prop.ruleResults?.qualified === true : prop.ruleResults?.qualified !== true));

  check('minRulesPassed', isSetNumber(filters.minRulesPassed), true,
    () => Number(prop.ruleResults?.passedCount ?? 0) >= Number(filters.minRulesPassed));

  check('maxDataAgeMinutes', isSetNumber(filters.maxDataAgeMinutes), isFilterApplicable('maxDataAgeMinutes', prop),
    () => {
      const age = (Date.now() - Date.parse(prop.updatedAt)) / 60000;
      return Number.isFinite(age) && age <= Number(filters.maxDataAgeMinutes);
    });

  // Scout rules are an ADDITIONAL constraint layered on the user's filters.
  // Turning rules on never clears the other filters, and turning them off
  // never widens the population beyond what those filters allow.
  check('applyScoutRules', filters.applyScoutRules, true,
    () => prop.ruleResults?.qualified === true);

  return {
    matchesFilters: failed.length === 0,
    failedFilters: failed,
    appliedFilters: applied,
    inapplicableFilters: inapplicable,
  };
}

/** Filter a population. Every prop goes through the same evaluation. */
export function applyPropFilters(props = [], filters = {}) {
  const normalized = normalizeFilters(filters);
  return props.filter((prop) => evaluatePropAgainstFilters(prop, normalized).matchesFilters);
}

/**
 * Counts for the result bar: total, matching the user's filters, and how many
 * of those also pass the Scout rules. Computed in one pass over the population.
 */
export function filterCounts(props = [], filters = {}) {
  const withoutRules = normalizeFilters({ ...filters, applyScoutRules: false });
  let matching = 0;
  let qualifiers = 0;
  for (const prop of props) {
    if (!evaluatePropAgainstFilters(prop, withoutRules).matchesFilters) continue;
    matching++;
    if (prop.ruleResults?.qualified === true) qualifiers++;
  }
  return { total: props.length, matching, qualifiers };
}

/** Active filters as removable chips, so one can be cleared without a reset. */
export function activeFilterChips(filters = {}) {
  const normalized = normalizeFilters(filters);
  const chips = [];
  const push = (id, label) => chips.push({ id, label });

  if (normalized.search) push('search', `"${normalized.search}"`);
  for (const sport of normalized.sports) push('sports', sport);
  for (const market of normalized.markets) push('markets', market);
  if (normalized.side !== 'ALL') push('side', normalized.side);
  for (const player of normalized.players) push('players', player);
  for (const team of normalized.teams) push('teams', team);
  for (const opponent of normalized.opponents) push('opponents', `vs ${opponent}`);
  for (const game of normalized.games) push('games', game);
  if (normalized.timeWindow === 'TODAY') push('timeWindow', 'Tonight');
  if (isSetNumber(normalized.minScore)) push('minScore', `Score ${normalized.minScore}+`);
  if (isSetNumber(normalized.maxScore)) push('maxScore', `Score ≤ ${normalized.maxScore}`);
  for (const tier of normalized.qualityTiers) push('qualityTiers', QUALITY_TIERS.find((t) => t.id === tier)?.label || tier);
  if (isSetNumber(normalized.minConfidence)) push('minConfidence', `Confidence ${normalized.minConfidence}+`);
  if (isSetNumber(normalized.minEdge)) push('minEdge', `Edge ${normalized.minEdge}+`);
  if (isSetNumber(normalized.maxEdge)) push('maxEdge', `Edge ≤ ${normalized.maxEdge}`);
  if (normalized.positiveEdgeOnly) push('positiveEdgeOnly', 'Positive edge');
  if (isSetNumber(normalized.minHitRate)) push('minHitRate', `${normalized.hitRateWindow.toUpperCase()} ${normalized.minHitRate}%+`);
  for (const rating of normalized.matchup) push('matchup', `Matchup ${rating}`);
  if (normalized.ruleStatus !== 'ALL') push('ruleStatus', normalized.ruleStatus === 'PASSED' ? 'Passed rules' : 'Failed rules');
  if (isSetNumber(normalized.minRulesPassed)) push('minRulesPassed', `${normalized.minRulesPassed}+ rules passed`);
  if (isSetNumber(normalized.maxDataAgeMinutes)) push('maxDataAgeMinutes', `Updated < ${normalized.maxDataAgeMinutes}m`);
  if (normalized.applyScoutRules) push('applyScoutRules', 'Scout Rules ON');
  return chips;
}

/** Remove one filter without disturbing the rest. */
export function clearFilter(filters, id, value = null) {
  const next = { ...normalizeFilters(filters) };
  const listFields = ['sports', 'markets', 'players', 'teams', 'opponents', 'games', 'qualityTiers', 'matchup'];
  if (listFields.includes(id)) {
    next[id] = value === null ? [] : next[id].filter((item) => item !== String(value).toUpperCase());
    return next;
  }
  next[id] = EMPTY_FILTERS[id];
  return next;
}

/** Why a filter set returned nothing, and the single filters most likely at fault. */
export function explainEmptyResult(props = [], filters = {}) {
  const normalized = normalizeFilters(filters);
  const blame = new Map();
  for (const prop of props) {
    for (const id of evaluatePropAgainstFilters(prop, normalized).failedFilters) {
      blame.set(id, (blame.get(id) || 0) + 1);
    }
  }
  const ranked = [...blame.entries()].sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ id, excludedCount: count }));
  return {
    total: props.length,
    activeChips: activeFilterChips(normalized),
    // The filter excluding the most props is the best thing to relax first.
    suggestions: ranked.slice(0, 3),
  };
}

// --- URL state -------------------------------------------------------------
// Filters are shareable/bookmarkable. Only filter values are serialised; no
// session, credential or account data ever goes into a URL.

const LIST_KEYS = ['sports', 'markets', 'players', 'teams', 'opponents', 'games', 'qualityTiers', 'matchup'];
const NUMBER_KEYS = ['minScore', 'maxScore', 'minConfidence', 'minEdge', 'maxEdge', 'minHitRate', 'minRulesPassed', 'maxDataAgeMinutes'];

export function filtersToQuery(filters = {}) {
  const normalized = normalizeFilters(filters);
  const params = new URLSearchParams();
  if (normalized.search) params.set('q', normalized.search);
  for (const key of LIST_KEYS) if (normalized[key].length) params.set(key, normalized[key].join(','));
  for (const key of NUMBER_KEYS) if (isSetNumber(normalized[key])) params.set(key, String(normalized[key]));
  if (normalized.side !== 'ALL') params.set('side', normalized.side);
  if (normalized.timeWindow !== 'ALL') params.set('timeWindow', normalized.timeWindow);
  if (normalized.ruleStatus !== 'ALL') params.set('ruleStatus', normalized.ruleStatus);
  if (normalized.hitRateWindow !== 'l10') params.set('hitRateWindow', normalized.hitRateWindow);
  if (normalized.positiveEdgeOnly) params.set('positiveEdgeOnly', '1');
  if (normalized.applyScoutRules) params.set('rules', '1');
  return params.toString();
}

export function filtersFromQuery(query = '') {
  const params = new URLSearchParams(String(query).replace(/^\?/, ''));
  const filters = { ...EMPTY_FILTERS };
  if (params.get('q')) filters.search = params.get('q');
  for (const key of LIST_KEYS) {
    const value = params.get(key);
    if (value) filters[key] = value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  for (const key of NUMBER_KEYS) {
    const value = Number(params.get(key));
    if (params.get(key) !== null && Number.isFinite(value)) filters[key] = value;
  }
  if (params.get('side')) filters.side = params.get('side');
  if (params.get('timeWindow')) filters.timeWindow = params.get('timeWindow');
  if (params.get('ruleStatus')) filters.ruleStatus = params.get('ruleStatus');
  if (params.get('hitRateWindow')) filters.hitRateWindow = params.get('hitRateWindow');
  filters.positiveEdgeOnly = params.get('positiveEdgeOnly') === '1';
  filters.applyScoutRules = params.get('rules') === '1';
  return normalizeFilters(filters);
}
