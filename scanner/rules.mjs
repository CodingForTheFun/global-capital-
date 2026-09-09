export const DEFAULT_RULES = Object.freeze({
  rulesEnabled: false,
  preset: 'strict',
  minL5: 80,
  minL10: 75,
  minL15: 75,
  minH2H: 75,
  minExpectedOutcome: 75,
  minFilterHitRate: 75,
  useH2H: true,
  requireOpponent: true,
  requireSeason: true,
  requireHomeAway: true,
  requireTeam: true,
  requireWinLoss: true,
  requireAdvancedAvailable: true,
  bestAvailable: true,
  bestAvailableLimit: 12,
});

export const RULE_PRESETS = Object.freeze({
  strict: { ...DEFAULT_RULES, preset: 'strict', rulesEnabled: true },
  balanced: {
    ...DEFAULT_RULES,
    preset: 'balanced',
    rulesEnabled: true,
    minL5: 70,
    minL10: 70,
    minL15: 70,
    minH2H: 65,
    minExpectedOutcome: 65,
    minFilterHitRate: 65,
    requireAdvancedAvailable: false,
  },
  flexible: {
    ...DEFAULT_RULES,
    preset: 'flexible',
    rulesEnabled: true,
    minL5: 60,
    minL10: 60,
    minL15: 60,
    minH2H: 50,
    minExpectedOutcome: 55,
    minFilterHitRate: 55,
    requireSeason: false,
    requireHomeAway: false,
    requireTeam: false,
    requireAdvancedAvailable: false,
  },
});

const clamp = (value, fallback, min = 0, max = 100) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
};
const bool = (value, fallback) => typeof value === 'boolean' ? value : fallback;

export function normalizeRules(input = {}) {
  const requestedPreset = ['strict', 'balanced', 'flexible', 'custom'].includes(String(input.preset || '').toLowerCase())
    ? String(input.preset).toLowerCase()
    : 'custom';
  const base = requestedPreset !== 'custom' && RULE_PRESETS[requestedPreset]
    ? RULE_PRESETS[requestedPreset]
    : DEFAULT_RULES;

  return {
    rulesEnabled: bool(input.rulesEnabled, base.rulesEnabled),
    preset: requestedPreset,
    minL5: clamp(input.minL5, base.minL5),
    minL10: clamp(input.minL10, base.minL10),
    minL15: clamp(input.minL15, base.minL15),
    minH2H: clamp(input.minH2H, base.minH2H),
    minExpectedOutcome: clamp(input.minExpectedOutcome, base.minExpectedOutcome),
    minFilterHitRate: clamp(input.minFilterHitRate, base.minFilterHitRate),
    useH2H: bool(input.useH2H, base.useH2H),
    requireOpponent: bool(input.requireOpponent, base.requireOpponent),
    requireSeason: bool(input.requireSeason, base.requireSeason),
    requireHomeAway: bool(input.requireHomeAway, base.requireHomeAway),
    requireTeam: bool(input.requireTeam, base.requireTeam),
    requireWinLoss: bool(input.requireWinLoss, base.requireWinLoss),
    requireAdvancedAvailable: bool(input.requireAdvancedAvailable, base.requireAdvancedAvailable),
    bestAvailable: bool(input.bestAvailable, base.bestAvailable),
    bestAvailableLimit: clamp(input.bestAvailableLimit, base.bestAvailableLimit, 1, 25),
    verifiedSourcesOnly: true,
    todayOnly: true,
  };
}

export function criteriaFromRules(rules = DEFAULT_RULES) {
  const r = normalizeRules({ ...rules, preset: rules.preset || 'custom' });
  return {
    minL5: r.minL5,
    minL10: r.minL10,
    minL15: r.minL15,
    minH2H: r.minH2H,
    minExpectedOutcome: r.minExpectedOutcome,
    minFilterHitRate: r.minFilterHitRate,
    useH2H: r.useH2H,
    requireWinLoss: r.requireWinLoss,
    strict: true,
  };
}
