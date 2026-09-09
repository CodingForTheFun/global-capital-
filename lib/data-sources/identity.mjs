// Cross-provider entity identity.
//
// Attaching one player's projection to another player's prop is the worst
// failure this system can have: it looks like real analysis and is wrong. So
// matching is deliberately conservative.
//
// Preference order:
//   1. Provider IDs, when both sides carry one (exact, confidence 1.0).
//   2. Normalised name PLUS corroborating context (team, opponent, league).
//   3. Nothing. An unmatched prop is enriched with nothing at all.
//
// A name that resolves to more than one candidate is AMBIGUOUS and is refused
// even when one candidate looks likelier. No enrichment beats wrong enrichment.

import { normalizePlayerName } from './contract.mjs';

export const MATCH = Object.freeze({
  PROVIDER_ID: 'provider-id',
  NAME_AND_GAME: 'name+game',
  NAME_AND_TEAM: 'name+team',
  NAME_AND_OPPONENT: 'name+opponent',
  NAME_AND_LEAGUE: 'name+league',
  NAME_UNIQUE_IN_FEED: 'name-unique-in-feed',
  AMBIGUOUS: 'ambiguous',
  NOT_FOUND: 'not-found',
});

const CONFIDENCE = Object.freeze({
  [MATCH.PROVIDER_ID]: 1,
  [MATCH.NAME_AND_GAME]: 0.95,
  [MATCH.NAME_AND_TEAM]: 0.9,
  [MATCH.NAME_AND_OPPONENT]: 0.85,
  // A league-scoped feed that carries no team/opponent at all (the injury list,
  // for example) cannot corroborate. A UNIQUE name in such a feed is still a
  // safe match, because two same-name players would be caught as ambiguous.
  [MATCH.NAME_UNIQUE_IN_FEED]: 0.85,
  [MATCH.NAME_AND_LEAGUE]: 0.6,
});

/** Minimum confidence a match needs before its data is allowed onto a prop. */
export const MIN_CONFIDENCE = 0.85;

const team = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Team abbreviations differ slightly between providers; compare loosely. */
export function sameTeam(a, b) {
  const left = team(a);
  const right = team(b);
  if (!left || !right) return null;   // unknown, not a contradiction
  return left === right || left.startsWith(right) || right.startsWith(left);
}

/**
 * Build a searchable index of provider rows.
 * Rows sharing a normalised name are kept together so collisions are visible
 * rather than silently resolved by insertion order.
 */
export function buildIndex(rows = [], {
  nameOf = (row) => row?.Name,
  idOf = (row) => row?.PlayerID,
  teamOf = (row) => row?.Team,
  opponentOf = (row) => row?.Opponent,
} = {}) {
  const byId = new Map();
  const byName = new Map();
  for (const row of rows) {
    const id = idOf(row);
    if (id !== null && id !== undefined && id !== '') byId.set(String(id), row);
    const name = normalizePlayerName(nameOf(row));
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(row);
  }
  return { byId, byName, teamOf, opponentOf, size: rows.length };
}

/**
 * Resolve one prop against an index.
 *
 * @returns {{row: object|null, method: string, confidence: number, reason: string, candidates: number}}
 */
export function resolvePlayer(prop, index) {
  if (!index || !prop) return { row: null, method: MATCH.NOT_FOUND, confidence: 0, reason: 'no index', candidates: 0 };

  // 1. Provider id, when the prop carries one from a previous resolution.
  const providerId = prop.providerPlayerId ?? prop.playerId ?? null;
  if (providerId !== null && providerId !== undefined && index.byId.has(String(providerId))) {
    return { row: index.byId.get(String(providerId)), method: MATCH.PROVIDER_ID, confidence: 1, reason: 'matched on provider player id', candidates: 1 };
  }

  const name = normalizePlayerName(prop.playerName);
  const candidates = name ? (index.byName.get(name) || []) : [];
  if (!candidates.length) {
    return { row: null, method: MATCH.NOT_FOUND, confidence: 0, reason: 'no candidate with this name', candidates: 0 };
  }

  // 2. A single candidate still needs its context to agree where both sides
  //    know it. A contradiction means this is a different player, not a match.
  if (candidates.length === 1) {
    const row = candidates[0];
    const teamAgrees = prop.team ? sameTeam(index.teamOf(row), prop.team) : null;
    const opponentAgrees = prop.opponent ? sameTeam(index.opponentOf(row), prop.opponent) : null;

    if (teamAgrees === false || opponentAgrees === false) {
      return { row: null, method: MATCH.NOT_FOUND, confidence: 0, reason: 'name matched but team/opponent contradicts', candidates: 1 };
    }
    if (teamAgrees === true && opponentAgrees === true) {
      return { row, method: MATCH.NAME_AND_GAME, confidence: CONFIDENCE[MATCH.NAME_AND_GAME], reason: 'name, team and opponent all agree', candidates: 1 };
    }
    if (teamAgrees === true) return { row, method: MATCH.NAME_AND_TEAM, confidence: CONFIDENCE[MATCH.NAME_AND_TEAM], reason: 'name and team agree', candidates: 1 };
    if (opponentAgrees === true) return { row, method: MATCH.NAME_AND_OPPONENT, confidence: CONFIDENCE[MATCH.NAME_AND_OPPONENT], reason: 'name and opponent agree', candidates: 1 };

    // The provider row carries no context to check against. Because the name is
    // unique within this league-scoped feed, this is still a safe match.
    const rowHasNoContext = !index.teamOf(row) && !index.opponentOf(row);
    if (rowHasNoContext) {
      return { row, method: MATCH.NAME_UNIQUE_IN_FEED, confidence: CONFIDENCE[MATCH.NAME_UNIQUE_IN_FEED], reason: 'unique name in a league-scoped feed that carries no team context', candidates: 1 };
    }

    // Name alone, with nothing to corroborate it. Below MIN_CONFIDENCE, so the
    // caller will refuse it — deliberately, because same-name players exist.
    return { row, method: MATCH.NAME_AND_LEAGUE, confidence: CONFIDENCE[MATCH.NAME_AND_LEAGUE], reason: 'name only, no corroborating context', candidates: 1 };
  }

  // 3. Several players share this name. Context must isolate exactly one.
  const narrowed = candidates.filter((row) => {
    const teamAgrees = prop.team ? sameTeam(index.teamOf(row), prop.team) : null;
    const opponentAgrees = prop.opponent ? sameTeam(index.opponentOf(row), prop.opponent) : null;
    if (teamAgrees === false || opponentAgrees === false) return false;
    return teamAgrees === true || opponentAgrees === true;
  });

  if (narrowed.length === 1) {
    return { row: narrowed[0], method: MATCH.NAME_AND_GAME, confidence: CONFIDENCE[MATCH.NAME_AND_GAME], reason: `context isolated 1 of ${candidates.length} same-name players`, candidates: candidates.length };
  }

  return {
    row: null,
    method: MATCH.AMBIGUOUS,
    confidence: 0,
    reason: `${candidates.length} players share this name and context did not isolate one`,
    candidates: candidates.length,
  };
}

/** True when a resolution is trustworthy enough to enrich a prop. */
export function isTrustworthy(resolution) {
  return Boolean(resolution?.row) && Number(resolution.confidence) >= MIN_CONFIDENCE;
}
