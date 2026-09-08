export const defaultCriteria = {
  minL5: Number(process.env.MIN_L5 || 80),
  minL10: Number(process.env.MIN_L10 || 75),
  minL15: Number(process.env.MIN_L15 || 75),
  minH2H: Number(process.env.MIN_H2H || 75),
  minExpectedOutcome: Number(process.env.MIN_EXPECTED_OUTCOME || 75),
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
  const explicit = String(pick.lineType || pick.modifierType || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (['REGULAR', 'MAIN', 'STANDARD'].includes(explicit)) return 'REGULAR';
  if (['GREEN_GOBLIN', 'GREEN', 'GOBLIN', 'DISCOUNT', 'DISCOUNTED'].includes(explicit)) return 'GREEN_GOBLIN';
  if (['RED_GOBLIN', 'RED', 'DEMON', 'BOOST', 'BOOSTED'].includes(explicit)) return 'RED_GOBLIN';
  if (pick.regularLine === true) return 'REGULAR';
  return 'UNKNOWN';
}

function allowedLineTypes() {
  return String(process.env.ALLOWED_LINE_TYPES || 'REGULAR,GREEN_GOBLIN,RED_GOBLIN')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
}

export function evaluatePick(pick, criteria = defaultCriteria) {
  const failures = [];
  const required = [
    ['L5', pick.l5, criteria.minL5],
    ['L10', pick.l10, criteria.minL10],
    ['L15', pick.l15, criteria.minL15],
    ['Expected outcome', pick.expectedOutcomeRate, criteria.minExpectedOutcome],
  ];
  if (pick.h2h !== null && pick.h2h !== undefined) required.push(['H2H', pick.h2h, criteria.minH2H]);

  for (const [label, value, floor] of required) {
    if (value === null || value === undefined) failures.push(`${label} unverified`);
    else if (Number(value) < floor) failures.push(`${label} ${value}% < ${floor}%`);
  }

  const lineType = normalizeLineType(pick);
  if (!['OVER', 'UNDER'].includes(String(pick.pick || '').toUpperCase())) failures.push('Pick direction unverified');
  if (!Number.isFinite(Number(pick.line))) failures.push('Prop line unverified');
  if (!pick.prizePicksConfirmed && !pick.sourceAppConfirmed) failures.push('Source app not confirmed');
  if (!allowedLineTypes().includes(lineType)) failures.push(`Modifier ${lineType === 'UNKNOWN' ? 'unverified' : `not allowed (${lineType})`}`);
  if (!pick.isToday) failures.push('Game is not today');

  if (criteria.strict && Array.isArray(pick.filterAudit)) {
    for (const row of pick.filterAudit) {
      const floor = Number.isFinite(Number(row.floor)) ? Number(row.floor) : Number(process.env.MIN_FILTER_HIT_RATE || 75);
      if (row.removedBecauseDataDisappeared) continue;
      const missingRequired = row.required && (!row.verified || row.hitRate === null || row.hitRate === undefined);
      const checkedButUnreadable = row.verified && row.enforceFloor !== false && (row.hitRate === null || row.hitRate === undefined);
      const belowFloor = row.verified && row.enforceFloor !== false && Number.isFinite(Number(row.hitRate)) && Number(row.hitRate) < floor;
      if (missingRequired || checkedButUnreadable) failures.push(`${row.label}: unverified`);
      else if (belowFloor) failures.push(`${row.label}: ${row.hitRate}% < ${floor}%`);
    }
  }

  const rates = [pick.l5, pick.l10, pick.l15, pick.h2h, pick.expectedOutcomeRate]
    .filter((v) => Number.isFinite(Number(v))).map(Number);
  const base = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
  const diffBonus = Number.isFinite(Number(pick.diff)) ? Math.min(Math.abs(Number(pick.diff)) * 1.5, 8) : 0;
  const confidence = clamp(Math.round(base * 0.95 + diffBonus));

  return {
    ...pick,
    lineType,
    regularLine: lineType === 'REGULAR',
    qualified: failures.length === 0,
    failures,
    confidence: failures.length === 0 ? Math.max(75, confidence) : Math.min(confidence, 74),
  };
}

export function buildDiversifiedCard(picks, legs = 4) {
  const qualified = picks.filter((p) => p.qualified).sort((a, b) => b.confidence - a.confidence);
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
