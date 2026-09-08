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

function normalizedLineType(pick) {
  const raw = String(pick.lineType || pick.modifier || (pick.regularLine ? 'REGULAR' : '')).toUpperCase();
  if (/DEMON|RED_GOBLIN|RED/.test(raw)) return 'RED_GOBLIN';
  if (/GOBLIN|GREEN/.test(raw)) return 'GREEN_GOBLIN';
  if (/REGULAR|MAIN|STANDARD/.test(raw)) return 'REGULAR';
  return 'UNKNOWN';
}

export function evaluatePick(pick, criteria = defaultCriteria) {
  const failures = [];
  const warnings = [];
  const lineType = normalizedLineType(pick);
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
  if (special && !isPrizePicks) failures.push('Goblin/Demon line is not verified as PrizePicks');
  if (!pick.isToday) failures.push('Game is not today');
  if (pick.detailPageVerified !== true) failures.push('Full detail page unverified');

  if (criteria.strict && Array.isArray(pick.filterAudit)) {
    for (const row of pick.filterAudit) {
      // A filter that destroys the prop data is intentionally rolled back and must not reject the prop.
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
    failures,
    warnings: [...(pick.warnings || []), ...warnings],
    confidence: qualified ? Math.max(1, confidence) : Math.min(confidence, 74),
    specialRankScore: special ? confidence / 100 : null,
    specialRankScorePct: special ? confidence : null,
    grade: !qualified ? 'OUT' : confidence >= 90 ? 'A' : confidence >= 82 ? 'B' : 'C',
  };
}

export function buildDiversifiedCard(picks, legs = 4) {
  // One-card payout math is intentionally kept to verified regular PrizePicks legs.
  // Goblin/Demon and sportsbook lines remain ranked on the board but are not mixed into this card.
  const qualified = picks
    .filter((p) => p.qualified)
    .filter((p) => normalizedLineType(p) === 'REGULAR')
    .filter((p) => p.prizePicksConfirmed === true || /prize\s*picks/i.test(String(p.sourceApp || '')))
    .sort((a, b) => b.confidence - a.confidence);
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
