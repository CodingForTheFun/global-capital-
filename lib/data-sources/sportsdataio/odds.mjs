// SportsDataIO betting-feed helpers.
//
// These helpers intentionally expose only normalized operator/offer metadata.
// Raw betting payloads never leave the provider layer. The first production
// use is runtime detection of whether the configured subscription actually
// contains PrizePicks offers, which determines whether Scout Pro can safely
// reduce its dependence on the PickFinder browser scanner.

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

function outcomeLooksUsable(outcome) {
  if (!outcome || typeof outcome !== 'object') return false;
  if (outcome.IsAvailable === false) return false;
  // Production only accepts core/main lines. An alternate outcome is never
  // allowed to prove that the API can replace PickFinder's regular-line check.
  if (outcome.IsAlternate === true) return false;
  return true;
}

/**
 * Recursively walk an odds payload and collect betting outcomes. SportsDataIO
 * may wrap the same BettingMarket/BettingOutcome objects in event containers,
 * so this avoids hard-coding one wrapper shape while still only trusting rows
 * with sportsbook metadata.
 */
export function collectBettingOutcomes(payload) {
  const found = [];
  const seen = new Set();

  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const item of node) visit(item); return; }

    const book = sportsbookFromOutcome(node);
    const looksLikeOutcome = book && (
      'BettingOutcomeType' in node || 'Value' in node || 'PayoutAmerican' in node || 'SportsbookOutcomeID' in node
    );
    if (looksLikeOutcome) {
      const identity = [
        node.BettingOutcomeID ?? '',
        node.SportsbookOutcomeID ?? '',
        normalizeSportsbookName(book),
        node.PlayerID ?? '',
        node.BettingOutcomeType ?? '',
        node.Value ?? '',
        node.Updated ?? node.Created ?? '',
      ].join('|');
      if (!seen.has(identity)) {
        seen.add(identity);
        found.push(node);
      }
    }

    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') visit(value);
    }
  }

  visit(payload);
  return found;
}

/**
 * Return only safe coverage metadata. No odds payload, URLs, provider secrets,
 * or auth data are returned.
 */
export function summarizeSportsbookCoverage(payload, target = 'PrizePicks') {
  const targetKey = normalizeSportsbookName(target);
  const outcomes = collectBettingOutcomes(payload).filter(outcomeLooksUsable);
  const operators = new Map();
  let targetOffers = 0;

  for (const outcome of outcomes) {
    const book = sportsbookFromOutcome(outcome);
    const key = normalizeSportsbookName(book);
    if (!key) continue;
    const display = typeof book === 'string'
      ? text(book)
      : text(book?.Name ?? book?.Key ?? book?.SportsbookName ?? book?.SportsBookName) || key;
    const row = operators.get(key) || { key, name: display, offers: 0 };
    row.offers++;
    operators.set(key, row);
    if (key === targetKey) targetOffers++;
  }

  return {
    target: target || 'PrizePicks',
    targetSeen: targetOffers > 0,
    targetOffers,
    totalCoreOffers: outcomes.length,
    operators: [...operators.values()].sort((a, b) => b.offers - a.offers || a.name.localeCompare(b.name)),
  };
}
