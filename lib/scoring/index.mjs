// Scout Score: a normalized 0-100 quality score with a visible breakdown.
//
// Every factor is computed from data PickFinder actually publishes on the
// player detail page. Factors the provider does not supply (usage, expected
// minutes, pace, injury status, role stability, line movement, book
// projections) are deliberately absent rather than estimated — an unexplained
// number is worse than a missing one.
//
// Weights are centralised here so they can be tuned in one place.

import { qualityTierFor, toNumberOrNull, isSetNumber } from '../props/model.mjs';
import { matchupRating } from '../filters/index.mjs';

export const DEFAULT_WEIGHTS = Object.freeze({
  recentForm: 34,     // L5 / L10 / L15 hit rates
  headToHead: 12,     // H2H hit rate
  expectedOutcome: 12,// PickFinder's expected win/loss split
  contextSplits: 18,  // verified contextual splits (opponent, venue, rest…)
  edge: 12,           // recent average vs the posted line
  consistency: 8,     // agreement across the hit-rate windows
  dataConfidence: 4,  // how much of the above was actually verified

  // Provider-backed factors. Each is skipped entirely when no stats provider
  // supplied the data, so with PickFinder alone the score is unchanged.
  projectionEdge: 22, // a real projection against the posted line
  availability: 10,   // injury designation
  opportunity: 10,    // expected minutes and depth-chart role
  matchupStrength: 8, // opponent rank against this position
  lineupConfirmation: 8,
  dataFreshness: 4,
});

/** Which provider supplied a given field, for per-factor attribution. */
function sourceOf(prop, field) {
  const provider = prop?.enrichedBy?.[field];
  return provider === 'sportsdataio' ? 'SportsDataIO' : (provider || null);
}

function primarySource(prop) {
  const providers = Object.values(prop?.enrichedBy || {});
  return providers.includes('sportsdataio') ? 'SportsDataIO' : (providers[0] || null);
}

/** Minutes since the provider data on this prop was fetched. */
function ageMinutes(prop) {
  const at = prop?.enrichment?.at;
  const parsed = Date.parse(at || '');
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round((Date.now() - parsed) / 60000));
}

function describeAge(minutes) {
  if (minutes < 1) return 'updated just now';
  if (minutes < 60) return `updated ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `updated ${hours} hour${hours === 1 ? '' : 's'} ago`;
}

const clamp = (n, min = 0, max = 100) => Math.max(min, Math.min(max, n));
const finite = toNumberOrNull;

function mean(values) {
  const usable = values.filter(isSetNumber).map(Number);
  return usable.length ? usable.reduce((a, b) => a + b, 0) / usable.length : null;
}

/**
 * Score one prop.
 *
 * Each factor contributes `weight * ratio` where ratio is 0..1. A factor with
 * no data contributes nothing AND removes its weight from the denominator, so
 * a prop is never punished for data the provider simply does not publish —
 * it is instead reported with lower data confidence.
 */
export function scoreProp(prop, weights = DEFAULT_WEIGHTS) {
  if (!prop) return null;
  const factors = [];

  // Every factor carries value, weight, normalized contribution, explanation
  // and source, so a user can always see why a prop scored what it did.
  const addFactor = (id, label, weight, ratio, detail, { value = null, source = 'PickFinder' } = {}) => {
    if (ratio === null) {
      factors.push({ id, label, weight, value: null, ratio: null, points: 0, contribution: 0, available: false, detail, source: null });
      return;
    }
    const bounded = clamp(ratio, 0, 1);
    factors.push({
      id, label, weight, value,
      ratio: bounded,
      points: Number((weight * bounded).toFixed(2)),
      contribution: Number((bounded * 100).toFixed(1)),
      available: true, detail, source,
    });
  };

  const rates = prop.hitRates || {};
  const recent = mean([rates.l5, rates.l10, rates.l15]);
  addFactor('recentForm', 'Recent form (L5/L10/L15)', weights.recentForm,
    recent === null ? null : recent / 100,
    recent === null ? 'No hit-rate windows verified' : `${Math.round(recent)}% average across verified windows`,
    { value: recent === null ? null : Math.round(recent) });

  const h2h = finite(rates.h2h);
  addFactor('headToHead', 'Head-to-head', weights.headToHead,
    h2h === null ? null : h2h / 100,
    h2h === null ? 'No H2H sample published' : `${h2h}% head-to-head`, { value: h2h });

  const expected = finite(prop.expectedOutcomeRate);
  addFactor('expectedOutcome', 'Expected win/loss split', weights.expectedOutcome,
    expected === null ? null : expected / 100,
    expected === null ? 'Not published' : `${expected}%${prop.expectedOutcome ? ` (${prop.expectedOutcome})` : ''}`, { value: expected });

  const verifiedSplits = (prop.contextSplits || []).filter((row) => row.verified && isSetNumber(row.hitRate));
  const splitMean = mean(verifiedSplits.map((row) => row.hitRate));
  addFactor('contextSplits', 'Contextual splits', weights.contextSplits,
    splitMean === null ? null : splitMean / 100,
    splitMean === null ? 'No contextual splits verified' : `${verifiedSplits.length} verified split${verifiedSplits.length === 1 ? '' : 's'}, ${Math.round(splitMean)}% average`,
    { value: splitMean === null ? null : Math.round(splitMean) });

  // Edge is the recent average against the posted line, in the direction of the
  // pick. A 20% deviation from the line is treated as a full-credit edge.
  const edge = finite(prop.edge);
  const line = finite(prop.line);
  let edgeRatio = null;
  let edgeDetail = 'No recent average published';
  if (edge !== null && line !== null && line !== 0) {
    const directional = String(prop.side).toUpperCase() === 'UNDER' ? -edge : edge;
    edgeRatio = clamp((directional / Math.abs(line)) / 0.2, 0, 1);
    edgeDetail = `${directional > 0 ? '+' : ''}${directional.toFixed(2)} vs line ${line} (${directional > 0 ? 'favourable' : 'against'} the ${String(prop.side || '').toLowerCase()})`;
  }
  addFactor('edge', 'Recent average vs line', weights.edge, edgeRatio, edgeDetail, { value: edge });

  // Consistency: tight agreement between windows scores higher than a single
  // hot streak that the longer windows do not support.
  const windows = [rates.l5, rates.l10, rates.l15].filter(isSetNumber).map(Number);
  let consistencyRatio = null;
  let consistencyDetail = 'Needs at least two verified windows';
  if (windows.length >= 2) {
    const spread = Math.max(...windows) - Math.min(...windows);
    consistencyRatio = clamp(1 - spread / 50, 0, 1);
    consistencyDetail = `${spread.toFixed(0)}% spread across ${windows.length} windows`;
  }
  addFactor('consistency', 'Window agreement', weights.consistency, consistencyRatio, consistencyDetail,
    { value: windows.length >= 2 ? Number((Math.max(...windows) - Math.min(...windows)).toFixed(0)) : null });

  // --- provider-backed factors -------------------------------------------
  // A real projection is a stronger signal than the recent-average baseline,
  // so it is scored separately and only when a provider supplied one.
  const projection = finite(prop.projection);
  const lineValue = finite(prop.line);
  let projectionRatio = null;
  let projectionDetail = 'No provider projection';
  if (projection !== null && lineValue !== null && lineValue !== 0) {
    const directional = String(prop.side).toUpperCase() === 'UNDER' ? lineValue - projection : projection - lineValue;
    projectionRatio = clamp((directional / Math.abs(lineValue)) / 0.15, 0, 1);
    projectionDetail = `${prop.projectionSource || 'Provider'} projects ${projection} vs line ${lineValue} (${directional > 0 ? '+' : ''}${directional.toFixed(2)} for the ${String(prop.side || '').toLowerCase()})`;
  }
  addFactor('projectionEdge', 'Projection vs line', weights.projectionEdge, projectionRatio, projectionDetail,
    { value: projection, source: prop.projectionSource || sourceOf(prop, 'projection') });

  const injury = String(prop.injuryStatus || '').toUpperCase();
  const availabilityRatio = injury
    ? ({ ACTIVE: 1, QUESTIONABLE: 0.5, DOUBTFUL: 0.15, OUT: 0 }[injury] ?? null)
    : null;
  addFactor('availability', 'Availability', weights.availability, availabilityRatio,
    injury ? `${injury.charAt(0)}${injury.slice(1).toLowerCase()}${prop.injuryDetail ? ` (${prop.injuryDetail})` : ''}` : 'No injury report',
    { value: injury || null, source: sourceOf(prop, 'injuryStatus') });

  // Opportunity blends projected minutes with depth-chart role; either alone
  // still scores, and neither present means the factor is skipped.
  const minutes = finite(prop.expectedMinutes);
  const depth = finite(prop.depthChartOrder);
  const parts = [];
  const detail = [];
  if (minutes !== null) { parts.push(clamp(minutes / 34, 0, 1)); detail.push(`${minutes} projected minutes`); }
  if (depth !== null) { parts.push(depth <= 1 ? 1 : depth === 2 ? 0.6 : 0.3); detail.push(`depth-chart ${depth}`); }
  if (prop.lineupStatus) detail.push(`${String(prop.lineupStatus).toLowerCase()} lineup`);
  addFactor('opportunity', 'Role and opportunity', weights.opportunity,
    parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null,
    detail.length ? detail.join(', ') : 'No role data',
    { value: minutes, source: sourceOf(prop, 'expectedMinutes') });

  // Opponent rank is 1 = toughest defence, so a high rank favours the over.
  const rank = finite(prop.opponentPositionRank ?? prop.opponentRank);
  addFactor('matchupStrength', 'Opponent strength', weights.matchupStrength,
    rank === null ? null : clamp(rank / 30, 0, 1),
    rank === null ? 'No opponent ranking' : `Opponent ranked ${rank} against this position`,
    { value: rank, source: sourceOf(prop, 'opponentRank') });

  // Lineup confirmation is a strong late signal where a league publishes it.
  const lineup = String(prop.lineupStatus || '').toUpperCase();
  addFactor('lineupConfirmation', 'Lineup confirmation', weights.lineupConfirmation,
    lineup ? ({ CONFIRMED: 1, PROJECTED: 0.6 }[lineup] ?? null) : null,
    lineup ? `${lineup.charAt(0)}${lineup.slice(1).toLowerCase()} lineup` : 'No lineup published',
    { value: lineup || null, source: sourceOf(prop, 'lineupStatus') });

  // How fresh the provider data backing this score actually is.
  const freshnessMinutes = ageMinutes(prop);
  addFactor('dataFreshness', 'Data freshness', weights.dataFreshness,
    freshnessMinutes === null ? null : clamp(1 - freshnessMinutes / 120, 0, 1),
    freshnessMinutes === null ? 'No provider data' : `Provider data ${describeAge(freshnessMinutes)}`,
    { value: freshnessMinutes, source: primarySource(prop) });

  const checks = [
    prop.verification?.detailPageVerified,
    prop.verification?.prizePicksConfirmed,
    prop.verification?.regularLine,
    prop.verification?.isToday,
  ];
  const verifiedCount = checks.filter(Boolean).length;
  addFactor('dataConfidence', 'Source verification', weights.dataConfidence,
    verifiedCount / checks.length,
    `${verifiedCount}/${checks.length} source checks verified`);

  const availableWeight = factors.filter((factor) => factor.available).reduce((sum, factor) => sum + factor.weight, 0);
  const earned = factors.reduce((sum, factor) => sum + factor.points, 0);
  const score = availableWeight > 0 ? Math.round(clamp((earned / availableWeight) * 100)) : null;

  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  const coverage = totalWeight > 0 ? Math.round((availableWeight / totalWeight) * 100) : 0;

  const sources = [...new Set(factors.filter((f) => f.available && f.source).map((f) => f.source))];
  return {
    score,
    qualityTier: qualityTierFor(score),
    sources,
    dataAgeMinutes: ageMinutes(prop),
    freshness: (() => {
      const age = ageMinutes(prop);
      if (age === null) return null;
      return { minutes: age, label: describeAge(age), stale: age > 60 };
    })(),
    // How much of the scoring model this prop actually had data for. A high
    // score built on 30% coverage is reported as such rather than hidden.
    dataCoverage: coverage,
    matchup: matchupRating(prop),
    factors,
    unavailableFactors: factors.filter((factor) => !factor.available).map((factor) => factor.id),
  };
}

/** Attach score, tier and breakdown to a population. */
export function scoreProps(props = [], weights = DEFAULT_WEIGHTS) {
  return props.map((prop) => {
    const breakdown = scoreProp(prop, weights);
    return {
      ...prop,
      score: breakdown?.score ?? null,
      qualityTier: breakdown?.qualityTier ?? null,
      scoreBreakdown: breakdown,
    };
  });
}

export const SORTS = Object.freeze({
  SCORE_DESC: 'score-desc',
  SCORE_ASC: 'score-asc',
  CONFIDENCE_DESC: 'confidence-desc',
  EDGE_DESC: 'edge-desc',
  HIT_RATE_DESC: 'hit-rate-desc',
  PLAYER_ASC: 'player-asc',
  UPDATED_DESC: 'updated-desc',
});

// Nulls always sort last, whichever direction is chosen: a prop with no data
// must never outrank a prop with real data.
const nullsLast = (a, b, direction) => {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction === 'asc' ? a - b : b - a;
};

const bestHitRate = (prop) => {
  const values = Object.values(prop.hitRates || {}).filter(isSetNumber).map(Number);
  return values.length ? Math.max(...values) : null;
};

export function sortProps(props = [], sort = SORTS.SCORE_DESC) {
  const list = [...props];
  switch (sort) {
    case SORTS.SCORE_ASC:
      return list.sort((a, b) => nullsLast(a.score ?? null, b.score ?? null, 'asc'));
    case SORTS.CONFIDENCE_DESC:
      return list.sort((a, b) => nullsLast(a.confidence ?? null, b.confidence ?? null, 'desc'));
    case SORTS.EDGE_DESC:
      return list.sort((a, b) => nullsLast(a.edge ?? null, b.edge ?? null, 'desc'));
    case SORTS.HIT_RATE_DESC:
      return list.sort((a, b) => nullsLast(bestHitRate(a), bestHitRate(b), 'desc'));
    case SORTS.PLAYER_ASC:
      return list.sort((a, b) => String(a.playerName || '').localeCompare(String(b.playerName || '')));
    case SORTS.UPDATED_DESC:
      return list.sort((a, b) => nullsLast(Date.parse(a.updatedAt) || null, Date.parse(b.updatedAt) || null, 'desc'));
    case SORTS.SCORE_DESC:
    default:
      return list.sort((a, b) => nullsLast(a.score ?? null, b.score ?? null, 'desc')
        || nullsLast(a.confidence ?? null, b.confidence ?? null, 'desc'));
  }
}

/** Filters that reproduce a prop's shape, for "Find Similar". */
export function similarFiltersFor(prop) {
  if (!prop) return {};
  return {
    sports: prop.sport ? [prop.sport] : [],
    markets: prop.market ? [prop.market] : [],
    side: prop.side || 'ALL',
  };
}
