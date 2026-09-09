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

const str = (value) => {
  const text = String(value ?? '').trim();
  return text || null;
};

/**
 * Stable identity so the same prop from repeated scans de-duplicates.
 * Source app and line class are included when known so identical-looking props
 * from different books/modifiers do not collapse into one row.
 */
export function propKey({ provider, gameId, playerName, market, line, side, lineType = null }) {
  const parts = [
    String(provider || 'pickfinder').toLowerCase(),
    String(gameId || '').toLowerCase(),
    String(playerName || '').toLowerCase().replace(/\s+/g, ' ').trim(),
    String(market || '').toLowerCase().replace(/\s+/g, ' ').trim(),
    isSetNumber(line) ? Number(line).toFixed(2) : 'na',
    String(side || '').toUpperCase(),
  ];
  if (lineType) parts.push(String(lineType).toUpperCase());
  return parts.join('|');
}

/** Adapter: PickFinder researched pick OR full-board row -> normalized prop. */
export function fromPickFinder(pick, { scannedAt = null } = {}) {
  if (!pick || typeof pick !== 'object') return null;

  const line = num(pick.line);
  const side = SIDES.includes(String(pick.pick || '').toUpperCase()) ? String(pick.pick).toUpperCase() : null;
  const average = num(pick.avg);
  const rawDiff = num(pick.diff);
  const sourceApp = str(pick.sourceApp) || 'PickFinder';
  const lineType = str(pick.lineType)?.toUpperCase() || (pick.regularLine === true ? 'REGULAR' : null);
  const edge = rawDiff !== null ? rawDiff : (average !== null && line !== null ? Number((average - line).toFixed(2)) : null);

  return {
    id: propKey({
      // Keep legacy PickFinder ids stable when sourceApp is absent, while
      // separating the same market when a full-board row names another app.
      provider: sourceApp,
      gameId: pick.matchId,
      playerName: pick.player,
      market: pick.prop,
      line,
      side,
      lineType,
    }),
    provider: 'pickfinder',
    sourceApp,
    lineType,
    sourceUrl: str(pick.sourceUrl) || str(pick.id),

    sport: str(pick.sport)?.toUpperCase() || null,
    league: str(pick.sport)?.toUpperCase() || null,
    gameId: str(pick.matchId),
    eventDate: str(pick.eventDate),
    gameStartTime: null,
    isToday: pick.isToday === true || String(pick.dateScope || '').toUpperCase() === 'TODAY',

    playerName: str(pick.player),
    playerImage: null,
    team: str(pick.team),
    opponent: str(pick.opponent),

    market: str(pick.prop),
    line,
    side,

    average,
    edge,
    projection: null,
    projectionSource: null,

    hitRates: {
      l5: num(pick.l5),
      l10: num(pick.l10),
      l15: num(pick.l15),
      h2h: num(pick.h2h),
      season: null,
      l20: null,
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
      sourceAppConfirmed: pick.sourceAppConfirmed === true,
      regularLine: pick.regularLine === true || lineType === 'REGULAR',
      isToday: pick.isToday === true || String(pick.dateScope || '').toUpperCase() === 'TODAY',
      boardLoaded: pick.boardLoaded === true,
    },

    ruleResults: {
      qualified: pick.qualified === true,
      failures: Array.isArray(pick.failures) ? pick.failures.slice() : [],
      passedCount: num(pick.passedCount),
      totalCount: num(pick.totalCount),
    },

    score: null,
    scoreBreakdown: null,
    confidence: num(pick.confidence),
    qualityTier: null,

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
    enrichedBy: null,

    scanError: str(pick.scanError),
    updatedAt: scannedAt || null,
  };
}

/** Adapt a whole scan/board result, de-duplicating on stable identity. */
export function fromScanResult(result) {
  const picks = Array.isArray(result?.picks) ? result.picks : [];
  const scannedAt = result?.refreshedAt || result?.scannedAt || null;
  const seen = new Map();
  for (const pick of picks) {
    const prop = fromPickFinder(pick, { scannedAt });
    if (!prop) continue;
    seen.set(prop.id, prop);
  }
  return [...seen.values()];
}

/** True when at least one legitimate signal can contribute to ranking. */
export function isScorable(prop) {
  if (!prop) return false;
  const rates = Object.values(prop.hitRates || {}).filter(isSetNumber);
  return rates.length > 0 || isSetNumber(prop.projection) || isSetNumber(prop.expectedMinutes);
}
