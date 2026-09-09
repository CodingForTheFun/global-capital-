import { propKey, toNumberOrNull } from './model.mjs';
import { normalizePlayerName } from '../data-sources/contract.mjs';

const clean = (value) => {
  const text = String(value ?? '').trim();
  return text || null;
};

function opponentFor({ team, homeTeam, awayTeam } = {}) {
  const t = String(team || '').toUpperCase();
  const home = String(homeTeam || '').toUpperCase();
  const away = String(awayTeam || '').toUpperCase();
  if (t && home && t === home) return clean(awayTeam);
  if (t && away && t === away) return clean(homeTeam);
  return null;
}

function canonicalOfferKey(offer = {}) {
  return [
    String(offer.sport || '').toUpperCase(),
    String(offer.gameId ?? ''),
    String(offer.playerId ?? normalizePlayerName(offer.playerName)),
    String(offer.market || '').toLowerCase().replace(/\s+/g, ' ').trim(),
    toNumberOrNull(offer.line) === null ? 'na' : Number(offer.line).toFixed(2),
    String(offer.side || '').toUpperCase(),
  ].join('|');
}

/**
 * Collapse identical real lines offered by multiple books into one board row.
 * We never average lines, infer a consensus line, or rename a book. A row keeps
 * the exact line and side and carries every sportsbook that actually offered it.
 */
export function collapseSportsbookOffers(offers = []) {
  const grouped = new Map();
  for (const offer of offers) {
    if (!offer || offer.isAvailable === false || offer.isAlternate === true) continue;
    const key = canonicalOfferKey(offer);
    const existing = grouped.get(key);
    const book = clean(offer.sportsbook);
    if (!existing) {
      grouped.set(key, {
        ...offer,
        sportsbooks: book ? [book] : [],
        sportsbookCount: book ? 1 : 0,
      });
      continue;
    }
    if (book && !existing.sportsbooks.includes(book)) existing.sportsbooks.push(book);
    existing.sportsbookCount = existing.sportsbooks.length;
    const existingUpdated = Date.parse(existing.updatedAt || '') || 0;
    const nextUpdated = Date.parse(offer.updatedAt || '') || 0;
    if (nextUpdated > existingUpdated) existing.updatedAt = offer.updatedAt;
  }
  return [...grouped.values()];
}

export function fromSportsDataIoOffer(offer, { fetchedAt = null } = {}) {
  if (!offer || typeof offer !== 'object') return null;
  const line = toNumberOrNull(offer.line);
  const side = ['OVER', 'UNDER'].includes(String(offer.side || '').toUpperCase())
    ? String(offer.side).toUpperCase()
    : null;
  const playerName = clean(offer.playerName);
  const market = clean(offer.market);
  const sport = clean(offer.sport)?.toUpperCase() || null;
  if (!playerName || !market || !sport || line === null || !side) return null;

  const sportsbook = clean(offer.sportsbook);
  const sportsbookKey = clean(offer.sportsbookKey);
  const providerIdentity = sportsbookKey ? `sportsdataio:${sportsbookKey}` : 'sportsdataio';
  const gameId = clean(offer.gameId);
  const team = clean(offer.team);
  const opponent = opponentFor({ team, homeTeam: offer.homeTeam, awayTeam: offer.awayTeam });
  const updatedAt = clean(offer.updatedAt) || fetchedAt || null;
  const isPrizePicks = String(sportsbookKey || '').toLowerCase() === 'prizepicks';

  return {
    id: propKey({ provider: providerIdentity, gameId, playerName, market, line, side }),
    provider: 'sportsdataio',
    sourceUrl: null,
    sourceLabel: sportsbook ? `SportsDataIO · ${sportsbook}` : 'SportsDataIO',
    sportsbook,
    sportsbooks: Array.isArray(offer.sportsbooks) ? offer.sportsbooks.slice() : (sportsbook ? [sportsbook] : []),
    sportsbookCount: Number.isFinite(Number(offer.sportsbookCount)) ? Number(offer.sportsbookCount) : (sportsbook ? 1 : 0),

    sport,
    league: sport,
    gameId,
    gameStartTime: clean(offer.gameStartTime),
    isToday: true,

    playerName,
    playerImage: null,
    team,
    opponent,
    market,
    marketDisplayName: market,
    line,
    side,
    overOdds: null,
    underOdds: null,

    average: null,
    edge: null,
    projection: null,
    projectionSource: null,
    hitRates: { l5: null, l10: null, l15: null, h2h: null, season: null, l20: null },
    expectedOutcome: null,
    expectedOutcomeRate: null,
    contextSplits: [],

    verification: {
      detailPageVerified: false,
      prizePicksConfirmed: isPrizePicks,
      regularLine: true,
      isToday: true,
      providerVerified: true,
    },
    isMainLine: true,
    isPromotional: false,

    ruleResults: {
      qualified: false,
      failures: ['Scout historical evidence is not yet complete for this provider-native row.'],
      passedCount: 0,
      totalCount: null,
    },
    qualificationStatus: 'UNQUALIFIED',
    qualificationScore: null,
    qualificationReasons: [],
    rejectionReasons: ['Historical Scout-rule evidence incomplete'],

    score: null,
    scoreBreakdown: null,
    confidence: null,
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
    providerPlayerId: offer.playerId ?? null,
    providerTeamId: offer.teamId ?? null,
    providerGameId: offer.gameId ?? null,
    playerPosition: null,
    venue: null,
    isHome: team && offer.homeTeam ? String(team).toUpperCase() === String(offer.homeTeam).toUpperCase() : null,
    gamePeriod: null,
    gameClock: null,
    homeScore: null,
    awayScore: null,
    projectionUpdatedAt: null,
    injuryNotes: null,
    injuryUpdatedAt: null,
    enrichedBy: null,
    enrichment: null,

    bettingEventId: offer.bettingEventId ?? null,
    bettingMarketId: offer.bettingMarketId ?? null,
    bettingOutcomeId: offer.bettingOutcomeId ?? null,
    sourceUpdatedAt: updatedAt,
    updatedAt,
    scanError: null,
  };
}

export function fromSportsDataIoOffers(offers = [], { fetchedAt = null } = {}) {
  return collapseSportsbookOffers(offers)
    .map((offer) => fromSportsDataIoOffer(offer, { fetchedAt }))
    .filter(Boolean);
}
