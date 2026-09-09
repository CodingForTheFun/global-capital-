import {
  runLiveScan as runMasterpieceScan,
  disconnectPickFinder,
} from './masterpiece.mjs';
import { loadFullPickFinderBoard } from './board-v6.mjs';
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
    if (row.removedBecauseDataDisappeared) return { ...row, required: false, enforceFloor: false, floor: rules.minFilterHitRate };
    if (row.label === 'Full detail page') return { ...row, required: true, enforceFloor: false };
    return { ...row, required: Boolean(row.required || shouldRequire(row.label, pick, rules)), floor: Number(rules.minFilterHitRate) };
  }) : [];
  const labels = new Set(rows.map((row) => row.label));
  for (const label of ['Opponent', 'Season', 'Home/Away', 'Team']) {
    if (!labels.has(label) && shouldRequire(label, pick, rules)) {
      rows.push({ label, value: 'Required by active rule profile', beforeHitRate: null, hitRate: null, afterHitRate: null, delta: null, required: true, enforceFloor: true, floor: Number(rules.minFilterHitRate), verified: false, syntheticRequirement: true });
    }
  }
  return rows;
}

function reevaluate(pick, rules) {
  const next = evaluatePick({ ...pick, filterAudit: normalizeAudit(pick, rules) }, criteriaFromRules(rules));
  next.warnings = [...new Set(next.warnings || [])];
  next.failures = [...new Set(next.failures || [])];
  return next;
}

function keyOf(pick = {}) {
  return [pick.sourceUrl || '', pick.lineType || 'REGULAR'].join('|').toLowerCase();
}

function mergeBoardWithResearch(boardPicks, researchedPicks, rules) {
  const researched = new Map();
  for (const raw of researchedPicks || []) {
    const evaluated = reevaluate(raw, rules);
    const key = keyOf(evaluated);
    const existing = researched.get(key);
    if (!existing || (evaluated.detailPageVerified && !existing.detailPageVerified)) researched.set(key, evaluated);
  }
  return (boardPicks || []).map((board) => {
    const audited = researched.get(keyOf(board));
    if (!audited) {
      return {
        ...board,
        qualified: false,
        rulesApplied: true,
        rulesEnabled: true,
        ruleStatus: 'PENDING',
        researchStatus: 'BOARD_ONLY',
        failures: [],
        warnings: [],
      };
    }
    return {
      ...board,
      ...audited,
      boardLoaded: true,
      rulesApplied: true,
      rulesEnabled: true,
      ruleStatus: audited.qualified ? 'PASSED' : 'FAILED',
      researchStatus: audited.detailPageVerified ? 'RESEARCHED' : 'UNVERIFIED',
    };
  });
}

function rankType(picks, lineType, limit = 100) {
  return picks.filter((pick) => pick.lineType === lineType)
    .sort((a, b) => Number(b.qualified) - Number(a.qualified) || Number(b.confidence || 0) - Number(a.confidence || 0))
    .slice(0, limit);
}

function buildBestAvailable(picks, rules) {
  if (!rules.bestAvailable || !rules.rulesEnabled) return [];
  return picks
    .filter((pick) => pick.ruleStatus === 'FAILED' && pick.detailPageVerified === true)
    .filter((pick) => ['OVER', 'UNDER'].includes(String(pick.pick || '').toUpperCase()) && Number.isFinite(Number(pick.line)))
    .map((pick) => ({ ...pick, nearMisses: [...(pick.failures || [])], researchScore: Math.max(0, Math.round(Number(pick.confidence || 0) - Math.max(0, (pick.failures?.length || 0) - 1) * 4)) }))
    .sort((a, b) => (a.nearMisses?.length || 0) - (b.nearMisses?.length || 0) || Number(b.researchScore || 0) - Number(a.researchScore || 0))
    .slice(0, Number(rules.bestAvailableLimit || 12));
}

export async function runLiveScan(options = {}) {
  const rules = normalizeRules(options.rules || DEFAULT_RULES);
  options.onProgress?.({ stage: 'board', message: 'Loading the entire PickFinder prop board', reviewed: 0, total: 0 });
  const board = await loadFullPickFinderBoard(options);
  const boardPicks = board.picks || [];

  if (!rules.rulesEnabled) {
    const picks = boardPicks.map((pick) => ({
      ...pick,
      qualified: null,
      rulesApplied: false,
      rulesEnabled: false,
      ruleStatus: 'OFF',
      researchStatus: 'BOARD_ONLY',
      failures: [],
      warnings: [],
    }));
    return {
      ...board,
      scannerVersion: 'full-board-v6-rules-off',
      rulesApplied: rules,
      rulesEnabled: false,
      boardPropCount: picks.length,
      totalLoaded: picks.length,
      totalReviewed: picks.length,
      qualifiedCount: 0,
      rejectedCount: 0,
      picks,
      diversifiedCard: [],
      bestAvailable: [],
      greenGoblins: rankType(picks, 'GREEN_GOBLIN'),
      redGoblins: rankType(picks, 'RED_GOBLIN'),
      warnings: [...new Set([...(board.warnings || []), `Rules are OFF. Loaded ${picks.length} PickFinder props without qualification filtering.`])],
    };
  }

  options.onProgress?.({ stage: 'research', message: `Board loaded (${boardPicks.length}). Applying research rules without hiding any props…`, reviewed: 0, total: boardPicks.length });
  let research = null;
  let researchError = null;
  try {
    research = await runMasterpieceScan({ ...options, rules });
  } catch (error) {
    researchError = error;
  }

  const picks = mergeBoardWithResearch(boardPicks, research?.picks || [], rules);
  const qualified = picks.filter((pick) => pick.ruleStatus === 'PASSED').sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
  const rejected = picks.filter((pick) => pick.ruleStatus === 'FAILED');
  const pending = picks.filter((pick) => pick.ruleStatus === 'PENDING');
  const warnings = [...(board.warnings || []), ...(research?.warnings || [])];
  if (researchError) warnings.push(`The full board loaded successfully, but optional rule research had a problem: ${researchError.message || String(researchError)}`);
  if (pending.length) warnings.push(`${pending.length} board props are visible but have not completed full-detail rule research yet.`);

  return {
    ...board,
    mode: 'live',
    scannedAt: new Date().toISOString(),
    source: 'PickFinder full board + optional rule research overlay',
    scannerVersion: 'full-board-v6-rules-on',
    rulesApplied: rules,
    rulesEnabled: true,
    boardPropCount: boardPicks.length,
    totalLoaded: boardPicks.length,
    totalReviewed: boardPicks.length,
    qualifiedCount: qualified.length,
    rejectedCount: rejected.length,
    pendingRuleCount: pending.length,
    picks,
    diversifiedCard: buildDiversifiedCard(picks.filter((pick) => pick.ruleStatus === 'PASSED'), 4),
    greenGoblins: rankType(picks, 'GREEN_GOBLIN'),
    redGoblins: rankType(picks, 'RED_GOBLIN'),
    bestAvailable: buildBestAvailable(picks, rules),
    appInventory: board.appInventory,
    warnings: [...new Set(warnings)],
  };
}
