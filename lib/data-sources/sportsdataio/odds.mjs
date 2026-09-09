// SportsDataIO betting-feed helpers.
//
// Raw odds payloads stay inside the provider layer. This module converts only
// currently available CORE player-prop outcomes into a small, explicit shape.
// SportsDataIO documents BettingOutcome.Participant as sportsbook free-text;
// it must never be used as the canonical display name. PlayerID + PlayerName
// are the identity fields. Missing names are resolved later from provider
// player/stat feeds by exact PlayerID.

import { toNumberOrNull } from '../../props/model.mjs';

const text = (value) => String(value ?? '').trim();

export function normalizeSportsbookName(value) {
  const raw = typeof value === 'string'
    ? value
    : value?.Name ?? value?.Key ?? value?.SportsbookName ?? value?.SportsBookName ?? value?.Sportsbook ?? '';
  return text(raw).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function isPrizePicksName(value) {
  return normalizeSportsbookName(value) === 'prizepicks';
}

function sportsbookFromOutcome(outcome) {
  return outcome?.SportsBook ?? outcome?.Sportsbook ?? outcome?.Book ?? outcome?.SportsbookName ?? outcome?.SportsBookName ?? null;
}

function sportsbookDisplay(book) {
  if (typeof book === 'string') return text(book);
  return text(book?.Name ?? book?.Key ?? book?.SportsbookName ?? book?.SportsBookName ?? book?.Sportsbook);
}

function sideOf(value) {
  const side = text(value).toUpperCase();
  return side === 'OVER' || side === 'UNDER' ? side : null;
}

function coreAvailable(outcome) {
  return Boolean(outcome && typeof outcome === 'object'
    && outcome.IsAvailable !== false
    && outcome.IsAlternate !== true);
}

function marketContext(node, parent = {}) {
  return {
    bettingMarketId: node?.BettingMarketID ?? parent.bettingMarketId ?? null,
    bettingEventId: node?.BettingEventID ?? parent.bettingEventId ?? null,
    marketType: text(node?.BettingMarketType) || parent.marketType || null,
    betType: text(node?.BettingBetType) || parent.betType || null,
    periodType: text(node?.BettingPeriodType) || parent.periodType || null,
    marketName: text(node?.Name) || parent.marketName || null,
    playerId: node?.PlayerID ?? parent.playerId ?? null,
    playerName: text(node?.PlayerName) || parent.playerName || null,
    teamId: node?.TeamID ?? parent.teamId ?? null,
    team: text(node?.TeamKey) || parent.team || null,
    gameId: node?.GameID ?? parent.gameId ?? null,
    gameStartTime: node?.GameStartTime ?? node?.StartDate ?? parent.gameStartTime ?? null,
    homeTeam: text(node?.HomeTeam) || parent.homeTeam || null,
    awayTeam: text(node?.AwayTeam) || parent.awayTeam || null,
  };
}

function offerFromOutcome(outcome, context, { sport, book = null, consensus = false } = {}) {
  if (!coreAvailable(outcome)) return null;
  const side = sideOf(outcome.BettingOutcomeType);
  const line = toNumberOrNull(outcome.Value ?? outcome.BetValue);
  const playerId = outcome.PlayerID ?? context.playerId ?? null;
  const playerName = text(outcome.PlayerName) || context.playerName || null;
  const market = context.betType || context.marketName;
  if (!playerId || !side || line === null || !market) return null;

  const sportsbookKey = consensus ? 'consensus' : normalizeSportsbookName(book);
  if (!sportsbookKey) return null;
  return {
    source: consensus ? 'SportsDataIO Consensus' : 'SportsDataIO',
    sportsbook: consensus ? 'Consensus' : (sportsbookDisplay(book) || sportsbookKey),
    sportsbookKey,
    consensus,
    sport: text(sport).toUpperCase() || null,
    playerId,
    playerName,
    teamId: outcome.TeamID ?? context.teamId,
    team: text(outcome.TeamKey) || context.team,
    market,
    marketType: context.marketType,
    periodType: context.periodType,
    line,
    side,
    isAvailable: true,
    isAlternate: false,
    bettingEventId: context.bettingEventId,
    bettingMarketId: context.bettingMarketId,
    bettingOutcomeId: outcome.BettingOutcomeID ?? outcome.ConsensusOutcomeID ?? null,
    sportsbookOutcomeId: consensus ? null : (outcome.SportsbookOutcomeID ?? null),
    gameId: context.gameId,
    gameStartTime: context.gameStartTime,
    homeTeam: context.homeTeam,
    awayTeam: context.awayTeam,
    updatedAt: outcome.Updated ?? null,
    createdAt: outcome.Created ?? null,
  };
}

/**
 * Flatten SportsDataIO BettingMarket payloads. Book-specific, available,
 * non-alternate OVER/UNDER outcomes are preferred. If a market has no usable
 * sportsbook outcomes, SportsDataIO's own ConsensusOutcomes are accepted as a
 * clearly labelled provider-consensus fallback. Consensus is never returned by
 * prizePicksOffers and is never represented as a sportsbook line.
 */
export function normalizePlayerPropOffers(payload, { sport = null, sportsbook = null } = {}) {
  const wantedBook = sportsbook ? normalizeSportsbookName(sportsbook) : null;
  const rows = [];
  const seen = new Set();

  function add(row) {
    if (!row) return false;
    if (wantedBook && row.sportsbookKey !== wantedBook) return false;
    const key = [row.sportsbookKey, row.sport, row.playerId, row.market.toLowerCase(), row.side, row.line].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    rows.push(row);
    return true;
  }

  function visit(node, parent = {}) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const item of node) visit(item, parent); return; }

    const context = marketContext(node, parent);
    let bookRowsAdded = 0;
    const outcomes = Array.isArray(node.BettingOutcomes) ? node.BettingOutcomes : [];
    for (const outcome of outcomes) {
      const book = sportsbookFromOutcome(outcome);
      if (add(offerFromOutcome(outcome, context, { sport, book, consensus: false }))) bookRowsAdded++;
    }

    // Consensus is a real SportsDataIO-calculated market outcome, not a named
    // sportsbook. Use it only when browsing all provider-native props and only
    // when the same market yielded no usable book-specific rows.
    if (!wantedBook && bookRowsAdded === 0) {
      const consensus = Array.isArray(node.ConsensusOutcomes) ? node.ConsensusOutcomes : [];
      for (const outcome of consensus) add(offerFromOutcome(outcome, context, { sport, consensus: true }));
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === 'BettingOutcomes' || key === 'ConsensusOutcomes') continue;
      if (value && typeof value === 'object') visit(value, context);
    }
  }

  visit(payload, {});
  return rows;
}

export function prizePicksOffers(payload, options = {}) {
  return normalizePlayerPropOffers(payload, { ...options, sportsbook: 'PrizePicks' });
}

/** Safe schema diagnostics only: counts, never values, raw odds, URLs or secrets. */
export function summarizePlayerPropShape(payload) {
  const counts = {
    marketNodes: 0, bettingOutcomes: 0, consensusOutcomes: 0,
    playerMarkets: 0, overUnderOutcomes: 0, numericLineOutcomes: 0,
    availableCoreOutcomes: 0, namedBookOutcomes: 0,
  };
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const item of node) visit(item); return; }
    const betting = Array.isArray(node.BettingOutcomes) ? node.BettingOutcomes : [];
    const consensus = Array.isArray(node.ConsensusOutcomes) ? node.ConsensusOutcomes : [];
    if (betting.length || consensus.length || node.BettingMarketID != null) {
      counts.marketNodes++;
      if (node.PlayerID != null) counts.playerMarkets++;
    }
    counts.bettingOutcomes += betting.length;
    counts.consensusOutcomes += consensus.length;
    for (const outcome of [...betting, ...consensus]) {
      if (sideOf(outcome?.BettingOutcomeType)) counts.overUnderOutcomes++;
      if (toNumberOrNull(outcome?.Value ?? outcome?.BetValue) !== null) counts.numericLineOutcomes++;
      if (coreAvailable(outcome)) counts.availableCoreOutcomes++;
    }
    for (const outcome of betting) if (normalizeSportsbookName(sportsbookFromOutcome(outcome))) counts.namedBookOutcomes++;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'BettingOutcomes' || key === 'ConsensusOutcomes') continue;
      if (value && typeof value === 'object') visit(value);
    }
  };
  visit(payload);
  return counts;
}

/** Safe diagnostics only: operator names/counts, never raw odds or URLs. */
export function summarizeSportsbookCoverage(payload, target = 'PrizePicks', { sport = null } = {}) {
  const offers = normalizePlayerPropOffers(payload, { sport });
  const targetKey = normalizeSportsbookName(target);
  const operators = new Map();
  let targetOffers = 0;
  for (const offer of offers) {
    const row = operators.get(offer.sportsbookKey) || { key: offer.sportsbookKey, name: offer.sportsbook, offers: 0 };
    row.offers++;
    operators.set(offer.sportsbookKey, row);
    if (offer.sportsbookKey === targetKey) targetOffers++;
  }
  return {
    target: target || 'PrizePicks',
    targetSeen: targetOffers > 0,
    targetOffers,
    totalCoreOffers: offers.length,
    operators: [...operators.values()].sort((a, b) => b.offers - a.offers || a.name.localeCompare(b.name)),
  };
}
