const EPS = 1e-10;

export const MARKET_ARB_POLICY = Object.freeze({
  maxQuoteAgeMs: 5 * 60_000,
  maxQuoteSkewMs: 60_000,
});

const BASKETBALL = new Set([
  'player_points','player_rebounds','player_assists','player_threes','player_blocks','player_steals','player_turnovers',
  'player_points_rebounds_assists','player_points_rebounds','player_points_assists','player_rebounds_assists','player_blocks_steals',
]);
const FOOTBALL = new Set([
  'player_pass_yds','player_pass_tds','player_pass_attempts','player_pass_completions','player_pass_interceptions',
  'player_rush_yds','player_rush_attempts','player_rush_tds','player_reception_yds','player_receptions','player_reception_tds',
  'player_pass_rush_yds','player_rush_reception_yds','player_sacks','player_sacks_taken','player_solo_tackles',
  'player_tackles_assists','player_defensive_interceptions','player_field_goals','player_pats','player_kicking_points',
]);
const BASEBALL = new Set([
  'batter_hits','batter_total_bases','batter_home_runs','batter_runs_scored','batter_runs','batter_rbis',
  'batter_hits_runs_rbis','batter_strikeouts','batter_walks','pitcher_strikeouts','pitcher_hits_allowed',
  'pitcher_earned_runs','pitcher_outs','pitcher_outs_recorded','pitcher_walks',
]);
const HOCKEY = new Set([
  'player_shots_on_goal','player_goals','player_assists','player_points','player_total_saves','player_saves',
  'player_goals_against','player_blocked_shots',
]);
const SOCCER = new Set([
  'player_shots','player_shots_on_target','player_goals','player_assists','player_passes_attempted','player_passes_completed',
]);

const MARKET_DOMAINS = Object.freeze({
  NBA: BASKETBALL,
  WNBA: BASKETBALL,
  NCAAB: BASKETBALL,
  NFL: FOOTBALL,
  NCAAF: FOOTBALL,
  MLB: BASEBALL,
  NHL: HOCKEY,
  SOCCER,
  MLS: SOCCER,
  EPL: SOCCER,
  UCL: SOCCER,
});

const number = value => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const text = value => String(value ?? '').trim();

function decimalOdds(value) {
  const price = number(value);
  if (price === null || Math.abs(price) < 100) return null;
  return price > 0 ? 1 + price / 100 : 1 + 100 / -price;
}

function quoteTime(row) {
  for (const value of [row?.lastSeenAt, row?.ingestedAt, row?.updatedAt, row?.providerUpdatedAt]) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function canonicalBook(row) {
  return text(row?.sportsbookKey || row?.bookmakerKey || row?.sportsbook).toLowerCase();
}

function isDfsBook(book) {
  const compact = text(book).toLowerCase().replace(/[^a-z]/g, '');
  return ['prizepicks','underdog','underdogfantasy'].includes(compact);
}

function supportedIntegerDomain(group) {
  const sport = text(group?.sport).toUpperCase();
  const marketId = text(group?.marketId).toLowerCase();
  return Boolean(marketId && MARKET_DOMAINS[sport]?.has(marketId));
}

function normalizeQuote(row, group, now) {
  if (!row || group?.live === true || row.live === true || row.started === true || row.completed === true
    || row.isAlternate === true || row.stale === true || row.suspended === true || row.requiresParlay === true) return null;
  if (text(row.period || 'game').toLowerCase() !== 'game') return null;
  if (text(row.entityType || 'player').toLowerCase() !== 'player') return null;
  if (row.payoutType != null && text(row.payoutType).toLowerCase() !== 'straight') return null;

  const side = text(row.side).toUpperCase();
  const line = number(row.line);
  const groupLine = number(group?.line);
  const price = number(row.price);
  const bookKey = canonicalBook(row);
  const decimal = decimalOdds(price);
  const observedAt = quoteTime(row);

  if (!bookKey || isDfsBook(bookKey) || !['OVER','UNDER'].includes(side) || line === null || groupLine === null
    || Math.abs(line - groupLine) > EPS || price === null || decimal === null || !Number.isFinite(observedAt)
    || observedAt > now || now - observedAt > MARKET_ARB_POLICY.maxQuoteAgeMs) return null;

  return {
    bookKey,
    bookName: text(row.sportsbook || row.bookmakerName || row.sportsbookKey) || bookKey,
    side,
    line,
    price,
    decimal,
    observedAt,
  };
}

function currentQuotes(group, now) {
  const freshest = new Map();
  for (const row of Array.isArray(group?.quotes) ? group.quotes : []) {
    const quote = normalizeQuote(row, group, now);
    if (!quote) continue;
    const key = [quote.bookKey, quote.side, quote.line].join('|');
    const previous = freshest.get(key);
    if (!previous || quote.observedAt >= previous.observedAt) freshest.set(key, quote);
  }
  return [...freshest.values()];
}

/**
 * Settlement-aware price arbitrage for the current exact prop line.
 *
 * Only integer-valued stat markets with known push behavior are eligible.
 * Integer thresholds can push, so the minimum return is 0% (stakes refunded)
 * while the positive return applies only when the bet is decided. Half-point
 * thresholds have no integer push outcome, so minimum and decided returns match.
 */
export function marketArbitrage(group, { now = Date.now() } = {}) {
  if (!supportedIntegerDomain(group) || !Number.isFinite(now)) return null;

  const quotes = currentQuotes(group, now);
  const overs = quotes.filter(quote => quote.side === 'OVER');
  const unders = quotes.filter(quote => quote.side === 'UNDER');
  const candidates = [];

  for (const over of overs) {
    for (const under of unders) {
      if (over.bookKey === under.bookKey || Math.abs(over.line - under.line) > EPS
        || Math.abs(over.observedAt - under.observedAt) > MARKET_ARB_POLICY.maxQuoteSkewMs) continue;

      const impliedSum = 1 / over.decimal + 1 / under.decimal;
      if (!(impliedSum > 0 && impliedSum < 1 - EPS)) continue;

      const decidedReturnPct = 100 * (1 / impliedSum - 1);
      const possiblePush = Number.isInteger(over.line);
      const minimumReturnPct = possiblePush ? 0 : decidedReturnPct;
      const overStakePct = 100 * (1 / over.decimal) / impliedSum;
      const underStakePct = 100 - overStakePct;

      candidates.push({
        line: over.line,
        over,
        under,
        impliedSum,
        possiblePush,
        minimumReturnPct,
        decidedReturnPct,
        maximumReturnPct: decidedReturnPct,
        overStakePct,
        underStakePct,
        theoretical: true,
        executionVerified: false,
        note: possiblePush
          ? 'The exact integer result pushes both sides and refunds stakes; the positive return applies only when the market is decided.'
          : 'Theoretical exact-line cross-book return at the observed prices, before stake limits, void rules, fees and line movement.',
      });
    }
  }

  candidates.sort((a, b) =>
    b.minimumReturnPct - a.minimumReturnPct ||
    b.decidedReturnPct - a.decidedReturnPct ||
    a.over.bookKey.localeCompare(b.over.bookKey) ||
    a.under.bookKey.localeCompare(b.under.bookKey)
  );
  return candidates[0] || null;
}

export function marketArbitrageLabel(candidate) {
  if (!candidate) return null;
  const pct = candidate.decidedReturnPct.toFixed(2);
  return candidate.possiblePush ? `ARB +${pct}% decided · push 0%` : `ARB +${pct}% min`;
}
