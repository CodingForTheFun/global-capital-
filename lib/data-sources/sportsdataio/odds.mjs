// SportsDataIO betting-feed helpers.
//
// Raw odds payloads stay inside the provider layer. This module converts only
// currently available CORE player-prop outcomes into a small, explicit shape
// that Scout Pro can safely compare with PickFinder/PrizePicks lines.

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

/**
 * Flatten SportsDataIO BettingMarket -> BettingOutcome payloads while carrying
 * market/player context. Only available, non-alternate outcomes are returned.
 */
export function normalizePlayerPropOffers(payload, { sport = null, sportsbook = null } = {}) {
  const wantedBook = sportsbook ? normalizeSportsbookName(sportsbook) : null;
  const rows = [];
  const seen = new Set();

  function visit(node, parent = {}) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const item of node) visit(item, parent); return; }

    const context = marketContext(node, parent);
    const outcomes = Array.isArray(node.BettingOutcomes) ? node.BettingOutcomes : null;
    if (outcomes) {
      for (const outcome of outcomes) {
        if (!coreAvailable(outcome)) continue;
        const book = sportsbookFromOutcome(outcome);
        const sportsbookKey = normalizeSportsbookName(book);
        if (!sportsbookKey || (wantedBook && sportsbookKey !== wantedBook)) continue;
        const side = sideOf(outcome.BettingOutcomeType);
        const line = toNumberOrNull(outcome.Value ?? outcome.BetValue);
        const playerId = outcome.PlayerID ?? context.playerId ?? null;
        const playerName = text(context.playerName || outcome.Participant) || null;
        // A player prop without a player, side or line cannot safely become a
        // Scout Pro prop. Missing stays missing rather than being guessed.
        if (!playerId || !playerName || !side || line === null) continue;
        const market = context.betType || context.marketName;
        if (!market) continue;

        const row = {
          source: 'SportsDataIO',
          sportsbook: sportsbookDisplay(book) || sportsbookKey,
          sportsbookKey,
          sport: text(sport).toUpperCase() || null,
          playerId,
          playerName,
          teamId: context.teamId,
          team: context.team,
          market,
          marketType: context.marketType,
          periodType: context.periodType,
          line,
          side,
          isAvailable: true,
          isAlternate: false,
          bettingEventId: context.bettingEventId,
          bettingMarketId: context.bettingMarketId,
          bettingOutcomeId: outcome.BettingOutcomeID ?? null,
          sportsbookOutcomeId: outcome.SportsbookOutcomeID ?? null,
          gameId: context.gameId,
          gameStartTime: context.gameStartTime,
          homeTeam: context.homeTeam,
          awayTeam: context.awayTeam,
          updatedAt: outcome.Updated ?? node.Updated ?? null,
          createdAt: outcome.Created ?? node.Created ?? null,
        };
        const key = [sportsbookKey, row.sport, playerId, market.toLowerCase(), side, line].join('|');
        if (!seen.has(key)) { seen.add(key); rows.push(row); }
      }
    }

    // Recurse into wrappers/BettingEvents but do not visit BettingOutcomes a
    // second time after consuming them with their parent market context.
    for (const [key, value] of Object.entries(node)) {
      if (key === 'BettingOutcomes') continue;
      if (value && typeof value === 'object') visit(value, context);
    }
  }

  visit(payload, {});
  return rows;
}

export function prizePicksOffers(payload, options = {}) {
  return normalizePlayerPropOffers(payload, { ...options, sportsbook: 'PrizePicks' });
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
