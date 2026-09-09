// The stats-provider adapter contract.
//
// PickFinder supplies the prop universe (player, market, line, side, hit rates).
// A stats provider ENRICHES those props with data PickFinder does not publish:
// projections, injury status, expected minutes, usage, pace, opponent strength,
// game start times, player images, live status.
//
// Enrichment is strictly additive and always optional. If a provider is not
// configured, is rate-limited, or fails, Scout Pro shows the un-enriched props
// and reports the provider as unavailable. It never substitutes an estimate.

/** Fields a stats provider may contribute. Anything not listed is ignored. */
export const ENRICHABLE_FIELDS = Object.freeze([
  'projection',
  'projectionSource',
  'team',
  'playerImage',
  'gameStartTime',
  'injuryStatus',      // ACTIVE | QUESTIONABLE | DOUBTFUL | OUT | null
  'isStarter',
  'expectedMinutes',
  'usageRate',
  'teamPace',
  'opponentRank',
  'liveStatus',        // SCHEDULED | LIVE | FINAL | null
  'seasonHitRate',
  'l20HitRate',
  // Sports-intelligence fields supplied by a stats provider.
  'injuryDetail',
  'actualMinutes',
  'depthChartOrder',        // 1 = first on the depth chart at that position
  'lineupStatus',           // CONFIRMED | PROJECTED | null
  'opponentPositionRank',
  'opponentPointsAllowed',
  'liveStat',               // in-play value for this prop's own market
  'seasonAverage',          // per-game season baseline for this market
  // Identity and game context.
  'providerPlayerId',
  'providerTeamId',
  'providerGameId',
  'playerPosition',
  'venue',
  'isHome',
  'gamePeriod',
  'gameClock',
  'homeScore',
  'awayScore',
  'projectionUpdatedAt',
  'injuryNotes',
  'injuryUpdatedAt',
]);

export const LINEUP_STATUSES = Object.freeze(['CONFIRMED', 'PROJECTED']);

/** Fields PickFinder verifies itself. A provider may never overwrite these. */
export const PROTECTED_FIELDS = Object.freeze([
  'id', 'provider', 'sport', 'playerName', 'market', 'line', 'side',
  'hitRates', 'contextSplits', 'verification', 'ruleResults', 'sourceUrl',
]);

export const INJURY_STATUSES = Object.freeze(['ACTIVE', 'QUESTIONABLE', 'DOUBTFUL', 'OUT']);
export const LIVE_STATUSES = Object.freeze(['SCHEDULED', 'LIVE', 'FINAL']);

/**
 * A stats provider adapter must expose:
 *
 *   id            string, stable
 *   name          string, for the UI
 *   capabilities  subset of ENRICHABLE_FIELDS this provider can actually supply
 *   isConfigured()          -> boolean   (are its env vars present?)
 *   fetchEnrichment(request) -> Promise<Map<string, object>>
 *
 * `request` is { props, signal }. The returned Map is keyed by enrichmentKey().
 * Adapters must read credentials from process.env only — never from a request,
 * never from a file the frontend can reach, and never hard-coded.
 */
export function validateAdapter(adapter) {
  const problems = [];
  if (!adapter || typeof adapter !== 'object') return ['Adapter is not an object'];
  if (!adapter.id || typeof adapter.id !== 'string') problems.push('Missing string id');
  if (!adapter.name || typeof adapter.name !== 'string') problems.push('Missing string name');
  if (typeof adapter.isConfigured !== 'function') problems.push('Missing isConfigured()');
  if (typeof adapter.fetchEnrichment !== 'function') problems.push('Missing fetchEnrichment()');
  const capabilities = Array.isArray(adapter.capabilities) ? adapter.capabilities : [];
  if (!capabilities.length) problems.push('Declares no capabilities');
  for (const capability of capabilities) {
    if (!ENRICHABLE_FIELDS.includes(capability)) problems.push(`Unknown capability: ${capability}`);
  }
  return problems;
}

/**
 * Stable join key between a prop and provider data.
 *
 * Deliberately sport + player only. Provider game ids live in different
 * namespaces (PickFinder's matchId is not SportsDataIO's GameID), so including
 * one would guarantee a miss. A player appears at most once per slate, and
 * enrich.mjs additionally rejects a match whose opponent contradicts the prop,
 * which catches the rare same-name collision.
 */
export function normalizePlayerName(value) {
  return String(value || '')
    // Strip accents so "Jokic" and "Jokić" join.
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Apostrophes vanish ("D'Angelo" -> "dangelo"); hyphens, periods and other
    // punctuation become spaces, so "Gilgeous-Alexander" joins with
    // "Gilgeous Alexander". Providers are inconsistent about both.
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    // Suffixes are written inconsistently ("Jr.", "Jr", "JR").
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function enrichmentKey({ playerName, sport } = {}) {
  return [String(sport || '').toUpperCase(), normalizePlayerName(playerName)].join('|');
}

/** Team abbreviations differ slightly between providers; compare loosely. */
export function sameTeam(a, b) {
  const clean = (value) => String(value || '').toUpperCase().replace(/[^A-Z]/g, '');
  const left = clean(a);
  const right = clean(b);
  if (!left || !right) return true; // unknown on either side is not a contradiction
  return left === right || left.startsWith(right) || right.startsWith(left);
}

/**
 * Strip an adapter's response down to fields it declared AND is allowed to set.
 * A provider that returns extra keys (or tries to overwrite verified PickFinder
 * data) has those keys dropped rather than trusted.
 */
export function sanitizeEnrichment(raw, capabilities = []) {
  if (!raw || typeof raw !== 'object') return {};
  const allowed = new Set(capabilities.filter((field) => ENRICHABLE_FIELDS.includes(field)));
  const clean = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!allowed.has(key)) continue;
    if (PROTECTED_FIELDS.includes(key)) continue;
    if (value === null || value === undefined || value === '') continue;
    if (key === 'injuryStatus' && !INJURY_STATUSES.includes(String(value).toUpperCase())) continue;
    if (key === 'liveStatus' && !LIVE_STATUSES.includes(String(value).toUpperCase())) continue;
    if (key === 'lineupStatus' && !LINEUP_STATUSES.includes(String(value).toUpperCase())) continue;
    clean[key] = ['injuryStatus', 'liveStatus', 'lineupStatus'].includes(key) ? String(value).toUpperCase() : value;
  }
  return clean;
}
