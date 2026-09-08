import {
  runLiveScan as runMasterpieceScan,
  disconnectPickFinder,
} from './masterpiece.mjs';
import { verifyPickFinderConnection } from './auth-v3.mjs';
import { evaluatePick, buildDiversifiedCard } from './criteria.mjs';
import { DEFAULT_RULES, normalizeRules, criteriaFromRules } from './rules.mjs';

export { verifyPickFinderConnection, disconnectPickFinder };

const TEAM_SPORTS = new Set(['NBA', 'WNBA', 'NHL', 'MLB', 'NFL', 'CFB', 'CBB']);
const ESPORTS = new Set(['VAL', 'CS2', 'LOL', 'DOTA2', 'COD']);
const ADVANCED_LABELS = new Set(['Days Rest', 'Rank', 'Spread', 'Minutes Played', 'LAN/Online', 'Opponent Hand', 'Opponent Rank', 'Match Format', 'Sets Played']);

function shouldRequire(label, pick, rules) {
  const sport = String(pick.sport || '').toUpperCase();
  if (label === 'Opponent') return Boolean(rules.requireOpponent);
  if (label === 'Season') return Boolean(rules.requireSeason && (TEAM_SPORTS.has(sport) || sport === 'TENNIS'));
  if (label === 'Home/Away') return Boolean(rules.requireHomeAway && TEAM_SPORTS.has(sport));
  if (label === 'Team') return Boolean(rules.requireTeam && (TEAM_SPORTS.has(sport) || ESPORTS.has(sport)));
  if (label === 'Win/Loss') return Boolean(rules.requireWinLoss);
  if (ADVANCED_LABELS.has(label)) return Boolean(rules.requireAdvancedAvailable);
  return false;
}

function normalizeAudit(pick, rules) {
  const rows = Array.isArray(pick.filterAudit) ? pick.filterAudit.map((row) => {
    if (row.removedBecauseDataDisappeared) {
      return {
        ...row,
        required: false,
        enforceFloor: false,
        floor: rules.minFilterHitRate,
        note: row.note || 'Filter removed automatically because applying it made this prop data disappear.',
      };
    }
    if (row.label === 'Full detail page') return { ...row, required: true, enforceFloor: false };
    return {
      ...row,
      required: Boolean(row.required || shouldRequire(row.label, pick, rules)),
      floor: Number(rules.minFilterHitRate),
    };
  }) : [];

  const labels = new Set(rows.map((row) => row.label));
  const requiredCandidates = ['Opponent', 'Season', 'Home/Away', 'Team'];
  for (const label of requiredCandidates) {
    if (!labels.has(label) && shouldRequire(label, pick, rules)) {
      rows.push({
        label,
        value: 'Required by active rule profile',
        beforeHitRate: null,
        hitRate: null,
        afterHitRate: null,
        delta: null,
        required: true,
        enforceFloor: true,
        floor: Number(rules.minFilterHitRate),
        verified: false,
        syntheticRequirement: true,
      });
    }
  }
  return rows;
}

function reevaluate(pick, rules) {
  const criteria = criteriaFromRules(rules);
  const next = evaluatePick({ ...pick, filterAudit: normalizeAudit(pick, rules) }, criteria);
  next.warnings = [...new Set(next.warnings || [])];
  next.failures = [...new Set(next.failures || [])];
  return next;
}

function rankType(picks, lineType, limit = 20) {
  return picks
    .filter((pick) => pick.lineType === lineType)
    .sort((a, b) => Number(b.qualified) - Number(a.qualified)
      || Number(b.specialRankScorePct || b.confidence || 0) - Number(a.specialRankScorePct || a.confidence || 0))
    .slice(0, limit);
}

function buildBestAvailable(picks, rules) {
  if (!rules.bestAvailable) return [];
  return picks
    .filter((pick) => !pick.qualified)
    .filter((pick) => pick.detailPageVerified === true && pick.sourceAppConfirmed === true && pick.isToday === true)
    .filter((pick) => ['OVER', 'UNDER'].includes(String(pick.pick || '').toUpperCase()) && Number.isFinite(Number(pick.line)))
    .map((pick) => ({
      ...pick,
      nearMisses: [...(pick.failures || [])],
      researchScore: Math.max(0, Math.round(Number(pick.confidence || 0) - Math.max(0, (pick.failures?.length || 0) - 1) * 4)),
    }))
    .sort((a, b) => (a.nearMisses?.length || 0) - (b.nearMisses?.length || 0)
      || Number(b.researchScore || 0) - Number(a.researchScore || 0))
    .slice(0, Number(rules.bestAvailableLimit || 12));
}

export async function runLiveScan(options = {}) {
  const rules = normalizeRules(options.rules || DEFAULT_RULES);
  const raw = await runMasterpieceScan({ ...options, rules });
  const picks = (raw.picks || []).map((pick) => reevaluate(pick, rules));
  const qualified = picks.filter((pick) => pick.qualified).sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
  const warnings = [...new Set(raw.warnings || [])];
  if (!qualified.length) warnings.push('No props passed every active verification rule; Best Available contains researched near-misses only.');

  return {
    ...raw,
    mode: 'live',
    scannerVersion: 'masterpiece-2',
    rulesApplied: rules,
    totalReviewed: picks.length,
    qualifiedCount: qualified.length,
    rejectedCount: picks.length - qualified.length,
    picks,
    diversifiedCard: buildDiversifiedCard(picks, 4),
    greenGoblins: rankType(picks, 'GREEN_GOBLIN'),
    redGoblins: rankType(picks, 'RED_GOBLIN'),
    bestAvailable: buildBestAvailable(picks, rules),
    warnings: [...new Set(warnings)],
  };
}
