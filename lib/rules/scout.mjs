import { isSetNumber, toNumberOrNull } from '../props/model.mjs';

export const DEFAULT_SCOUT_RULES = Object.freeze({
  l5: 80,
  l10: 75,
  l15: 75,
  h2h: 75,
  expectedOutcomeRate: 75,
});

function evidence(id, label, value, minimum, { required = true, source = null } = {}) {
  const numeric = toNumberOrNull(value);
  if (numeric === null) {
    return {
      id, label, required, available: false, value: null, minimum,
      passed: required ? false : null,
      reason: required ? `${label} evidence is missing` : `${label} is unavailable`,
      source,
    };
  }
  const passed = numeric >= minimum;
  return {
    id, label, required, available: true, value: numeric, minimum, passed,
    reason: passed ? `${label} ${numeric}% meets ${minimum}%` : `${label} ${numeric}% is below ${minimum}%`,
    source,
  };
}

/**
 * Canonical Scout rule audit. Missing required evidence is an explicit failure,
 * never a pass. Hard line-validity protections apply before statistical rules.
 */
export function evaluateScoutRules(prop, rules = DEFAULT_SCOUT_RULES) {
  const audit = [];
  const hard = [
    {
      id: 'mainLine', label: 'Main line', required: true, available: true,
      value: prop?.isMainLine ?? prop?.verification?.regularLine ?? null,
      passed: (prop?.isMainLine === true || prop?.verification?.regularLine === true) && prop?.isPromotional !== true,
      reason: prop?.isPromotional === true ? 'Promotional/alternate line excluded' : 'Main-line validation',
      source: prop?.provider || null,
    },
  ];
  audit.push(...hard);

  const rates = prop?.hitRates || {};
  audit.push(evidence('l5', 'L5', rates.l5, rules.l5, { source: prop?.enrichment?.historicalSource || prop?.provider || null }));
  audit.push(evidence('l10', 'L10', rates.l10, rules.l10, { source: prop?.enrichment?.historicalSource || prop?.provider || null }));
  audit.push(evidence('l15', 'L15', rates.l15, rules.l15, { source: prop?.enrichment?.historicalSource || prop?.provider || null }));
  audit.push(evidence('h2h', 'H2H', rates.h2h, rules.h2h, { source: prop?.provider || null }));
  audit.push(evidence('expectedOutcomeRate', 'Expected outcome', prop?.expectedOutcomeRate, rules.expectedOutcomeRate, { source: prop?.provider || null }));

  const required = audit.filter((row) => row.required);
  const failures = required.filter((row) => row.passed !== true);
  const passes = required.filter((row) => row.passed === true);
  const available = required.filter((row) => row.available !== false);
  const coverage = required.length ? Math.round((available.length / required.length) * 100) : 0;

  return {
    qualified: failures.length === 0,
    passedCount: passes.length,
    totalCount: required.length,
    evidenceCoverage: coverage,
    failures: failures.map((row) => row.reason),
    audit,
  };
}

/** Preserve an explicit upstream qualified result; otherwise calculate safely. */
export function applyScoutRuleAudit(prop, rules = DEFAULT_SCOUT_RULES) {
  if (!prop || typeof prop !== 'object') return prop;
  // PickFinder's fully verified detail page already owns its explicit rule
  // result. Still attach a canonical audit when possible, but never turn a
  // scanner-qualified pick into a failure because a normalized optional field
  // is absent from an older record.
  if (String(prop.provider || '').toLowerCase() === 'pickfinder' && prop.ruleResults?.qualified === true) {
    const calculated = evaluateScoutRules(prop, rules);
    return {
      ...prop,
      ruleResults: {
        ...prop.ruleResults,
        audit: calculated.audit,
        evidenceCoverage: calculated.evidenceCoverage,
      },
      qualificationStatus: 'QUALIFIED',
      qualificationReasons: calculated.audit.filter((row) => row.passed === true).map((row) => row.reason),
      rejectionReasons: [],
    };
  }

  const result = evaluateScoutRules(prop, rules);
  return {
    ...prop,
    ruleResults: result,
    qualificationStatus: result.qualified ? 'QUALIFIED' : 'UNQUALIFIED',
    qualificationScore: isSetNumber(prop.score) ? Number(prop.score) : null,
    qualificationReasons: result.audit.filter((row) => row.passed === true).map((row) => row.reason),
    rejectionReasons: result.failures.slice(),
  };
}
