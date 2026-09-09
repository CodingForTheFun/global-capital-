const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export const AUTO_SCOUT_RULES_VERSION = 1;

export const DEFAULT_AUTO_SCOUT_RULES = Object.freeze({
  regularLinesOnly: true,
  minL5: 80,
  minL10: 75,
  minL15: 75,
  minH2H: 75,
  minExpectedOutcome: 75,
});

function check(id, label, status, detail, { required = true, actual = null, threshold = null } = {}) {
  return { id, label, status, detail, required, actual, threshold };
}

function thresholdCheck(id, label, actual, threshold) {
  const value = num(actual);
  if (value === null) return check(id, label, 'UNAVAILABLE', `${label} is not supplied by the current stats data source.`, { actual: null, threshold });
  const pass = value >= threshold;
  return check(id, label, pass ? 'PASS' : 'FAIL', `${value}% ${pass ? 'meets' : 'is below'} the ${threshold}% threshold.`, { actual: value, threshold });
}

function groupKey(row) {
  return [row?.sport, row?.eventId, row?.playerId || row?.playerName, row?.marketId || row?.market].join('|');
}

export function evaluateAutoScoutRow(row, groupRows = [], rules = DEFAULT_AUTO_SCOUT_RULES) {
  const checks = [];
  const isAlternate = row?.isAlternate === true;
  checks.push(check('regularLine', 'Main / regular line', !rules.regularLinesOnly || !isAlternate ? 'PASS' : 'FAIL', isAlternate ? 'Alternate market.' : 'Regular market.', { actual: !isAlternate }));

  const price = num(row?.price);
  checks.push(check('sportsbookPrice', 'Sportsbook price', price === null ? 'UNAVAILABLE' : 'PASS', price === null ? 'No price supplied for this selection.' : `American price ${price > 0 ? '+' : ''}${price}.`, { required: false, actual: price }));

  const books = new Set((groupRows || []).map((r) => r?.sportsbookKey).filter(Boolean)).size;
  checks.push(check('bookCoverage', 'Sportsbook coverage', books > 0 ? 'PASS' : 'UNAVAILABLE', books > 0 ? `${books} sportsbook${books === 1 ? '' : 's'} currently returned.` : 'No sportsbook coverage returned.', { required: false, actual: books }));

  checks.push(thresholdCheck('l5', 'L5 hit rate', row?.hitRates?.l5 ?? row?.l5HitRate, rules.minL5));
  checks.push(thresholdCheck('l10', 'L10 hit rate', row?.hitRates?.l10 ?? row?.l10HitRate, rules.minL10));
  checks.push(thresholdCheck('l15', 'L15 hit rate', row?.hitRates?.l15 ?? row?.l15HitRate, rules.minL15));
  checks.push(thresholdCheck('h2h', 'H2H hit rate', row?.hitRates?.h2h ?? row?.h2hHitRate, rules.minH2H));
  checks.push(thresholdCheck('expectedOutcome', 'Expected outcome', row?.expectedOutcomeRate, rules.minExpectedOutcome));

  const required = checks.filter((c) => c.required);
  const failed = required.filter((c) => c.status === 'FAIL');
  const unavailable = required.filter((c) => c.status === 'UNAVAILABLE');
  const passed = required.filter((c) => c.status === 'PASS');
  const classification = failed.length ? 'REJECTED' : unavailable.length ? 'UNAVAILABLE' : 'QUALIFIED';

  return {
    version: AUTO_SCOUT_RULES_VERSION,
    classification,
    qualified: classification === 'QUALIFIED',
    failedCount: failed.length,
    unavailableCount: unavailable.length,
    passedCount: passed.length,
    checks,
  };
}

export function decorateBoardWithScoutAudit(board, rules = DEFAULT_AUTO_SCOUT_RULES) {
  const rows = Array.isArray(board?.props) ? board.props : [];
  const groups = new Map();
  for (const row of rows) {
    const key = groupKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const props = rows.map((row) => ({ ...row, autoScout: evaluateAutoScoutRow(row, groups.get(groupKey(row)) || [], rules) }));
  const counts = props.reduce((acc, row) => {
    const key = row?.autoScout?.classification || 'UNAVAILABLE';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, { QUALIFIED: 0, REJECTED: 0, UNAVAILABLE: 0 });
  return {
    ...board,
    props,
    meta: {
      ...(board?.meta || {}),
      autoScoutRulesVersion: AUTO_SCOUT_RULES_VERSION,
      autoScoutCounts: counts,
      autoScoutResearchDataComplete: counts.UNAVAILABLE === 0,
    },
  };
}
