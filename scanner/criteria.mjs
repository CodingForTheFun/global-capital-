export const defaultCriteria = {
  minL5: Number(process.env.MIN_L5 || 80),
  minL10: Number(process.env.MIN_L10 || 75),
  minL15: Number(process.env.MIN_L15 || 75),
  minH2H: Number(process.env.MIN_H2H || 75),
  minExpectedOutcome: Number(process.env.MIN_EXPECTED_OUTCOME || 75),
  minFilterHitRate: Number(process.env.MIN_FILTER_HIT_RATE || 75),
  useH2H: true,
  requireWinLoss: true,
  strict: String(process.env.STRICT_MODE ?? 'true').toLowerCase() === 'true',
};

export function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

export function normalizeLineType(pick = {}) {
  const raw = String(pick.lineType || pick.modifier || pick.modifierLabel || (pick.regularLine ? 'REGULAR' : ''))
    .trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (/DEMON|RED_GOBLIN|BOOST|RED_LINE|^RED$/.test(raw)) return 'RED_GOBLIN';
  if (/GREEN_GOBLIN|GOBLIN|DISCOUNT|GREEN_LINE|^GREEN$/.test(raw)) return 'GREEN_GOBLIN';
  if (/REGULAR|MAIN|STANDARD/.test(raw)) return 'REGULAR';
  return 'UNKNOWN';
}

export function evaluatePick(pick, criteria = defaultCriteria) {
  const failures = [];
  const warnings = [];
  const lineType = normalizeLineType(pick);
  const special = lineType === 'GREEN_GOBLIN' || lineType === 'RED_GOBLIN';
  const sourceApp = String(pick.sourceApp || (pick.prizePicksConfirmed ? 'PrizePicks' : '')).trim();
  const sourceVerified = pick.sourceAppConfirmed === true || pick.prizePicksConfirmed === true;
  const isPrizePicks = pick.prizePicksConfirmed === true || /prize\s*picks/i.test(sourceApp);
  const modifierVerified = pick.modifierConfirmed !== false && lineType !== 'UNKNOWN';

  const required = [
    ['L5', pick.l5, criteria.minL5],
    ['L10', pick.l10, criteria.minL10],
    ['L15', pick.l15, criteria.minL15],
  ];
  if (criteria.requireWinLoss !== false) required.push(['Expected outcome', pick.expectedOutcomeRate, criteria.minExpectedOutcome]);
  if (criteria.useH2H !== false && pick.h2h !== null && pick.h2h !== undefined) required.push(['H2H', pick.h2h, criteria.minH2H]);

  for (const [label, value, floor] of required) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) failures.push(`${label} unverified`);
    else if (Number(value) < Number(floor)) failures.push(`${label} ${value}% < ${floor}%`);
  }

  if (!['OVER', 'UNDER'].includes(String(pick.pick || '').toUpperCase())) failures.push('Pick direction unverified');
  if (!Number.isFinite(Number(pick.line))) failures.push('Prop line unverified');
  if (!sourceVerified) failures.push('Sportsbook/app source unverified');
  if (!modifierVerified) failures.push('Line modifier unverified');
  // Goblin/Demon modifiers are PrizePicks products; do not infer them on another book.
  if (special && !isPrizePicks) failures.push('Goblin/Demon line is not verified as PrizePicks');
  if (pick.isToday !== true) failures.push('Game is not today');
  if (pick.detailPageVerified !== true) failures.push('Full detail page unverified');

  if (criteria.strict && Array.isArray(pick.filterAudit)) {
    for (const row of pick.filterAudit) {
      // If a dropdown destroys the line/analytics, it is rolled back and removed from scoring.
      if (row.removedBecauseDataDisappeared) {
        warnings.push(`${row.label} removed because it made the prop data disappear`);
        continue;
      }
      const floor = Number.isFinite(Number(row.floor)) ? Number(row.floor) : Number(criteria.minFilterHitRate ?? 75);
      const after = row.afterHitRate ?? row.hitRate;
      const missingRequired = row.required && (!row.verified || after === null || after === undefined || !Number.isFinite(Number(after)));
      const checkedButUnreadable = row.verified && row.enforceFloor !== false && (after === null || after === undefined || !Number.isFinite(Number(after)));
      const belowFloor = row.verified && row.enforceFloor !== false && Number.isFinite(Number(after)) && Number(after) < floor;
      if (missingRequired || checkedButUnreadable) failures.push(`${row.label}: unverified`);
      else if (belowFloor) failures.push(`${row.label}: ${after}% < ${floor}%`);
    }
  }

  const rates = [pick.l5, pick.l10, pick.l15]
    .concat(criteria.useH2H !== false ? [pick.h2h] : [])
    .concat(criteria.requireWinLoss !== false ? [pick.expectedOutcomeRate] : [])
    .filter((v) => Number.isFinite(Number(v)))
    .map(Number);
  const base = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
  const diffBonus = Number.isFinite(Number(pick.diff)) ? Math.min(Math.abs(Number(pick.diff)) * 1.5, 8) : 0;
  const confidence = clamp(Math.round(base * 0.95 + diffBonus));
  const qualified = failures.length === 0;

  return {
    ...pick,
    lineType,
    regularLine: lineType === 'REGULAR',
    goblinLine: lineType === 'GREEN_GOBLIN',
    demonLine: lineType === 'RED_GOBLIN',
    specialLine: special,
    sourceApp: sourceApp || 'Unknown',
    sourceAppConfirmed: sourceVerified,
    qualified,
    screenPassed: qualified,
    failures: [...new Set(failures)],
    warnings: [...new Set([...(pick.warnings || []), ...warnings])],
    confidence: qualified ? Math.max(1, confidence) : Math.min(confidence, 74),
    specialRankScore: special ? confidence / 100 : null,
    specialRankScorePct: special ? confidence : null,
    grade: !qualified ? 'OUT' : confidence >= 90 ? 'A' : confidence >= 82 ? 'B' : 'C',
  };
}

export function buildDiversifiedCard(picks, legs = 4) {
  // Keep the single-entry payout card internally coherent: verified regular PrizePicks legs only.
  // Multi-book regular lines and Goblins remain available/ranked on the research board.
  const qualified = picks
    .filter((p) => p.qualified)
    .filter((p) => normalizeLineType(p) === 'REGULAR')
    .filter((p) => p.prizePicksConfirmed === true || /prize\s*picks/i.test(String(p.sourceApp || '')))
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
  const card = [];
  const usedMatches = new Set();
  const usedPlayers = new Set();
  for (const pick of qualified) {
    const matchKey = pick.matchId || `${pick.sport}:${pick.opponent || pick.player}`;
    const playerKey = String(pick.player || '').toLowerCase();
    if (usedMatches.has(matchKey) || (playerKey && usedPlayers.has(playerKey))) continue;
    card.push(pick);
    usedMatches.add(matchKey);
    if (playerKey) usedPlayers.add(playerKey);
    if (card.length >= legs) break;
  }
  return card;
}
