// SportsDataIO betting payloads -> compact Scout Pro market context.
//
// SportsDataIO's aggregated-odds model is BettingMarket -> BettingOutcomes.
// This module keeps that structure away from the rest of Scout Pro and only
// exposes data we can tie safely to the current player + market. PickFinder's
// verified line is NEVER overwritten by sportsbook data.

import { toNumberOrNull } from '../../props/model.mjs';
import { normalizePlayerName } from '../contract.mjs';
import { marketKey } from './markets.mjs';

const str = (value) => {
  const text = String(value ?? '').trim();
  return text || null;
};

const num = toNumberOrNull;

function sportsbookName(value) {
  if (typeof value === 'string') return str(value);
  if (!value || typeof value !== 'object') return null;
  return str(value.Name ?? value.Key ?? value.Code ?? value.SportsbookName);
}

function normalizeBetType(value) {
  return marketKey(value)
    .replace(/^player\s+/, '')
    .replace(/^total\s+/, '')
    .replace(/\btotal\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sameBetType(propMarket, market) {
  const left = normalizeBetType(propMarket);
  const candidates = [market?.BettingBetType, market?.Name, market?.Market, market?.MarketName]
    .map(normalizeBetType)
    .filter(Boolean);
  if (!left || !candidates.length) return false;
  return candidates.some((right) => right === left || right.endsWith(` ${left}`) || left.endsWith(` ${right}`));
}

function flattenMarkets(payload) {
  const markets = [];
  const visit = (node) => {
    if (!node) return;
    if (Array.isArray(node)) { for (const item of node) visit(item); return; }
    if (typeof node !== 'object') return;
    if (Array.isArray(node.BettingMarkets)) {
      for (const market of node.BettingMarkets) visit(market);
      return;
    }
    if (Array.isArray(node.Markets)) {
      for (const market of node.Markets) visit(market);
      return;
    }
    if (node.BettingMarketID != null || node.BettingOutcomes || node.Outcomes) markets.push(node);
  };
  visit(payload);
  return markets;
}

function outcomeRows(market) {
  const base = Array.isArray(market?.BettingOutcomes)
    ? market.BettingOutcomes
    : (Array.isArray(market?.Outcomes) ? market.Outcomes : []);
  return base.map((row) => ({
    sportsbook: sportsbookName(row?.SportsBook ?? row?.Sportsbook),
    side: str(row?.BettingOutcomeType ?? row?.OutcomeType)?.toUpperCase() || null,
    line: num(row?.Value ?? row?.Line ?? row?.BetValue),
    payoutAmerican: num(row?.PayoutAmerican ?? row?.AmericanOdds),
    payoutDecimal: num(row?.PayoutDecimal ?? row?.DecimalOdds),
    isAvailable: row?.IsAvailable !== false,
    isAlternate: row?.IsAlternate === true,
    isInPlay: row?.IsInPlay === true,
    createdAt: str(row?.Created),
    updatedAt: str(row?.Updated),
    unlistedAt: str(row?.Unlisted ?? row?.UnlistedTime),
    playerId: num(row?.PlayerID),
    outcomeId: num(row?.BettingOutcomeID),
  })).filter((row) => row.side && row.sportsbook && row.line !== null);
}

/** Efficient lookup by provider player id first, then normalized name. */
export function indexBettingMarkets(payload = []) {
  const all = flattenMarkets(payload);
  const byPlayerId = new Map();
  const byPlayerName = new Map();

  for (const market of all) {
    const id = num(market?.PlayerID);
    if (id !== null) {
      if (!byPlayerId.has(id)) byPlayerId.set(id, []);
      byPlayerId.get(id).push(market);
    }

    const name = normalizePlayerName(market?.PlayerName);
    if (name) {
      if (!byPlayerName.has(name)) byPlayerName.set(name, []);
      byPlayerName.get(name).push(market);
    }
  }
  return { all, byPlayerId, byPlayerName };
}

function marketsForProp(prop, index, providerPlayerId = null) {
  if (!index) return [];
  let candidates = [];
  if (providerPlayerId !== null && index.byPlayerId?.has(providerPlayerId)) {
    candidates = index.byPlayerId.get(providerPlayerId);
  } else {
    const key = normalizePlayerName(prop?.playerName);
    candidates = key ? (index.byPlayerName?.get(key) || []) : [];
  }

  return candidates.filter((market) => {
    const type = String(market?.BettingMarketType || '').toUpperCase();
    if (type && !type.includes('PLAYER')) return false;
    const period = String(market?.BettingPeriodType || '').toUpperCase();
    // Scout Pro props are full-game unless PickFinder explicitly says otherwise.
    if (period && !['FULL GAME', 'GAME', 'REGULATION TIME'].some((label) => period.includes(label))) return false;
    return sameBetType(prop?.market, market);
  });
}

function median(values) {
  const nums = values.filter((value) => value !== null).map(Number).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : Number(((nums[mid - 1] + nums[mid]) / 2).toFixed(2));
}

function timestamp(value) {
  const n = Date.parse(value || '');
  return Number.isFinite(n) ? n : null;
}

function movementForSide(rows, side) {
  const wanted = rows.filter((row) => row.side === side && !row.isAlternate);
  if (wanted.length < 2) return null;

  const groups = new Map();
  for (const row of wanted) {
    if (!groups.has(row.sportsbook)) groups.set(row.sportsbook, []);
    groups.get(row.sportsbook).push(row);
  }

  const openings = [];
  const currents = [];
  let latestAt = null;
  for (const list of groups.values()) {
    const ordered = [...list].sort((a, b) => (timestamp(a.createdAt) ?? 0) - (timestamp(b.createdAt) ?? 0));
    const first = ordered[0];
    const active = ordered.filter((row) => row.isAvailable && !row.unlistedAt);
    const current = (active.length ? active : ordered).sort((a, b) => (timestamp(b.updatedAt ?? b.createdAt) ?? 0) - (timestamp(a.updatedAt ?? a.createdAt) ?? 0))[0];
    if (first?.line !== null) openings.push(first.line);
    if (current?.line !== null) currents.push(current.line);
    const t = timestamp(current?.updatedAt ?? current?.createdAt);
    if (t !== null && (latestAt === null || t > latestAt)) latestAt = t;
  }

  const openingLine = median(openings);
  const currentLine = median(currents);
  if (openingLine === null || currentLine === null || openingLine === currentLine) return null;
  return {
    openingLine,
    currentLine,
    change: Number((currentLine - openingLine).toFixed(2)),
    booksTracked: groups.size,
    updatedAt: latestAt === null ? null : new Date(latestAt).toISOString(),
  };
}

/**
 * Return current sportsbook context for a single PickFinder prop.
 * The PickFinder line remains authoritative; these fields are comparison data.
 */
export function bettingEnrichmentForProp(prop, index, providerPlayerId = null) {
  const markets = marketsForProp(prop, index, providerPlayerId);
  if (!markets.length) return null;

  // Prefer the market with the largest current sportsbook set.
  const ranked = markets.map((market) => ({ market, rows: outcomeRows(market) }))
    .filter(({ rows }) => rows.length)
    .sort((a, b) => b.rows.filter((row) => row.isAvailable && !row.isAlternate).length - a.rows.filter((row) => row.isAvailable && !row.isAlternate).length);
  if (!ranked.length) return null;

  const { market, rows } = ranked[0];
  const side = String(prop?.side || '').toUpperCase();
  const current = rows.filter((row) => row.isAvailable && !row.isAlternate && ['OVER', 'UNDER'].includes(row.side));
  const sameSide = current.filter((row) => row.side === side);
  if (!sameSide.length) return null;

  const lines = sameSide.map((row) => row.line);
  const consensusLine = median(lines);
  const bestLine = side === 'UNDER' ? Math.max(...lines) : Math.min(...lines);
  const atBestLine = sameSide.filter((row) => row.line === bestLine);
  const bestOdds = atBestLine.map((row) => row.payoutAmerican).filter((value) => value !== null)
    .sort((a, b) => b - a)[0] ?? null;

  const latest = current.map((row) => timestamp(row.updatedAt ?? row.createdAt)).filter((value) => value !== null);
  const uniqueBooks = new Set(current.map((row) => row.sportsbook).filter(Boolean));
  const movement = movementForSide(rows, side);

  const out = {
    bettingMarketId: num(market?.BettingMarketID),
    marketConsensusLine: consensusLine,
    bestSportsbookLine: bestLine,
    bestSportsbookOddsAmerican: bestOdds,
    sportsbookCount: uniqueBooks.size || null,
    sportsbookOutcomes: current.slice(0, 100),
    bettingUpdatedAt: latest.length ? new Date(Math.max(...latest)).toISOString() : str(market?.Updated),
    lineMovement: movement,
  };

  for (const [key, value] of Object.entries(out)) {
    if (value === null || value === undefined || (Array.isArray(value) && !value.length)) delete out[key];
  }
  return Object.keys(out).length ? out : null;
}
