// The normalized Scout Pro prop.
//
// Architecture seam: nothing downstream (filters, scoring, rules, UI) ever sees
// a raw provider response. Each provider gets an adapter that produces this
// shape, so adding a second data source later changes only the adapter.
//
// Fields are null when the provider does not supply them. Null means "not
// available" and is never rendered or filtered as if it were a real value —
// Scout Pro fails closed rather than inventing numbers.

export const SIDES = Object.freeze(['OVER', 'UNDER']);

export function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** True only when `value` is a real, caller-supplied number. */
export function isSetNumber(value) {
  return toNumberOrNull(value) !== null;
}

const num = toNumberOrNull;

export const QUALITY_TIERS = Object.freeze([
  { id: 'ELITE', label: 'Elite', min: 90 },
  { id: 'STRONG', label: 'Strong', min: 80 },
  { id: 'GOOD', label: 'Good', min: 70 },
  { id: 'NEUTRAL', label: 'Neutral', min: 60 },
  { id: 'LOW', label: 'Low Confidence', min: 0 },
]);

export function qualityTierFor(score) {
  if (toNumberOrNull(score) === null) return null;
  return QUALITY_TIERS.find((tier) => Number(score) >= tier.min)?.id ?? 'LOW';
}

// Number(null), Number(undefined) and Number('') all coerce to 0, which is a
// finite number. Without the explicit guard a missing hit rate would become a
// real "0%" and a missing average would become a real edge of 0 — exactly the
// fabricated value Scout Pro must never produce. Absent stays null.

const str = (value) => {
  const text = String(value ?? '').trim();
  return text || null;
};

/**
 * Stable identity so the same prop from repeated scans de-duplicates.
 * Keyed on the fields that define a prop, not on scrape order or URL noise.
 */
export function propKey({ provider, gameId, playerName, market, line, side }) {
  return [
    String(provider || 'pickfinder').toLowerCase(),
    String(gameId || '').toLowerCase(),
    String(playerName || '').toLowerCase().replace(/\s+/g, ' ').trim(),
    String(market || '').toLowerCase().replace(/\s+/g, ' ').trim(),
    isSetNumber(line) ? Number(line).toFixed(2) : 'na',
    String(side || '').toUpperCase(),
  ].join('|');
}

/**
 * Adapter: PickFinder scanner pick -> normalized Scout Pro prop.
 *
 * Only fields the scanner genuinely extracts are populated. Everything the
 * PickFinder detail page does not expose stays absent rather than being guessed.
 */
export function fromPickFinder(pick, { scannedAt = null } = {}) {
  if (!pick || typeof pick !== 'object') return null;

  const line = num(pick.line);
  const side = SIDES.includes(String(pick.pick || '').toUpperCase()) ? String(pick.pick).toUpperCase() : null;
  const average = num(pick.avg);
  const rawDiff = num(pick.diff);
  // PickFinder shows an Avg L10 and a Diff against the line. That is a
  // recent-form baseline, NOT a modelled projection — it is labelled as such
  // everywhere it surfaces so it is never mistaken for a book projection.
  const edge = rawDiff !== null ? rawDiff : (average !== null && line !== null ? Number((average - line).toFixed(2)) : null);

  return {
    id: propKey({
      provider: 'pickfinder',
      gameId: pick.matchId,
      playerName: pick.player,
      market: pick.prop,
      line,
      side,
    }),
    provider: 'pickfinder',
    sourceUrl: str(pick.sourceUrl) || str(pick.id),

    sport: str(pick.sport)?.toUpperCase() || null,
    league: str(pick.sport)?.toUpperCase() || null,
    gameId: str(pick.matchId),
    // The PickFinder board exposes a match date, not a kickoff timestamp, so
    // start-time filtering is limited to today/not-today rather than invented.
    gameStartTime: null,
    isToday: pick.isToday === true,

    playerName: str(pick.player),
    playerImage: null,
    team: null,
    opponent: str(pick.opponent),

    market: str(pick.prop),
    line,
    side,

    // Recent-form baseline from the detail page.
    average,
    edge,
    projection: null,
    projectionSource: null,

    hitRates: {
      l5: num(pick.l5),
      l10: num(pick.l10),
      l15: num(pick.l15),
      h2h: num(pick.h2h),
      season: null,   // enrichment slot
      l20: null,      // enrichment slot
    },

    expectedOutcome: str(pick.expectedOutcome),
    expectedOutcomeRate: num(pick.expectedOutcomeRate),

    contextSplits: Array.isArray(pick.filterAudit) ? pick.filterAudit.map((row) => ({
      label: str(row.label),
      value: str(row.value),
      hitRate: num(row.afterHitRate ?? row.hitRate),
      floor: num(row.floor),
      required: row.required === true,
      verified: row.verified === true,
    })) : [],

    verification: {
      detailPageVerified: pick.detailPageVerified === true,
      prizePicksConfirmed: pick.prizePicksConfirmed === true,
      regularLine: pick.regularLine === true,
      isToday: pick.isToday === true,
    },

    ruleResults: {
      qualified: pick.qualified === true,
      failures: Array.isArray(pick.failures) ? pick.failures.slice() : [],
      passedCount: null,
      totalCount: null,
    },

    score: null,
    scoreBreakdown: null,
    confidence: num(pick.confidence),
    qualityTier: null,

    // Enrichment slots. PickFinder supplies none of these; a configured stats
    // provider fills them in via lib/data-sources/enrich.mjs. They stay null
    // until a provider actually returns a value, and `enrichedBy` records which
    // provider supplied each one.
    injuryStatus: null,
    isStarter: null,
    expectedMinutes: null,
    usageRate: null,
    teamPace: null,
    opponentRank: null,
    liveStatus: null,
    injuryDetail: null,
    actualMinutes: null,
    depthChartOrder: null,
    lineupStatus: null,
    opponentPositionRank: null,
    opponentPointsAllowed: null,
    liveStat: null,
    seasonAverage: null,

    // Sportsbook comparison context. These are deliberately separate from the
    // PickFinder line/side so a secondary provider can never rewrite the prop.
    bettingMarketId: null,
    marketConsensusLine: null,
    bestSportsbookLine: null,
    bestSportsbookOddsAmerican: null,
    sportsbookCount: null,
    sportsbookOutcomes: null,
    bettingUpdatedAt: null,
    lineMovement: null,
    enrichedBy: null,

    // Already sanitised upstream; safe to surface.
    scanError: str(pick.scanError),
    updatedAt: scannedAt || null,
  };
}

/** Adapt a whole scan result, de-duplicating on stable identity. */
export function fromScanResult(result) {
  const picks = Array.isArray(result?.picks) ? result.picks : [];
  const scannedAt = result?.scannedAt || null;
  const seen = new Map();
  for (const pick of picks) {
    const prop = fromPickFinder(pick, { scannedAt });
    if (!prop) continue;
    // Later scans of the same prop win; earlier duplicates are discarded.
    seen.set(prop.id, prop);
  }
  return [...seen.values()];
}

/** True when the prop carries enough real data to be scored and ranked. */
export function isScorable(prop) {
  if (!prop) return false;
  const rates = Object.values(prop.hitRates || {}).filter(isSetNumber);
  return rates.length > 0;
}
