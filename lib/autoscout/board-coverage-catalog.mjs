// Serving-only coverage. These codes are observed in the existing public-feed
// store; adding them must never enlarge an upstream provider polling allowlist.
export const ADDITIONAL_PUBLIC_SPORTS = Object.freeze([
  'RL', 'KBO', 'NPB', 'UFC', 'TT', 'NASCAR', 'BANANA BALL', 'MOTORCYCLE',
]);

// Keep the original sport code and all event/player/line IDs. Collapsing these
// codes into a base sport before end-to-end scope-aware identity exists could
// combine first-half, full-game and season props, or attach full-game history.
// MLBLIVE alone does not identify an inning: do not invent one from the tag.
export const SCOPED_PUBLIC_SPORTS = Object.freeze({
  NFL1H: Object.freeze({ label: 'NFL · 1st half', marketPrefix: '1st half', period: 'h1' }),
  NFL1Q: Object.freeze({ label: 'NFL · 1st quarter', marketPrefix: '1st quarter', period: 'q1' }),
  WNBA1H: Object.freeze({ label: 'WNBA · 1st half', marketPrefix: '1st half', period: 'h1' }),
  WNBA1Q: Object.freeze({ label: 'WNBA · 1st quarter', marketPrefix: '1st quarter', period: 'q1' }),
  CFB1H: Object.freeze({ label: 'College football · 1st half', marketPrefix: '1st half', period: 'h1' }),
  MLBLIVE: Object.freeze({ label: 'MLB · Live / inning', marketPrefix: 'Live / inning market' }),
  NBASZN: Object.freeze({ label: 'NBA · Season', marketPrefix: 'Season', period: 'season' }),
  NHLSZN: Object.freeze({ label: 'NHL · Season', marketPrefix: 'Season', period: 'season' }),
});

export const BOARD_COVERAGE_LABELS = Object.freeze({
  RL: 'Rocket League',
  TT: 'Table tennis',
  BAD: 'Badminton',
  MOTORCYCLE: 'Motorcycle racing',
  'BANANA BALL': 'Banana Ball',
  ...Object.fromEntries(Object.entries(SCOPED_PUBLIC_SPORTS).map(([code, scope]) => [code, scope.label])),
});

// Pure aggregate diagnostic: no provider calls, identifiers, player details,
// credentials, or database mutations. Unknown future tags remain visible here
// rather than being automatically promoted into customer-facing coverage.
export function auditBoardCoverage(rows, supportedSports, now = Date.now()) {
  const at = typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(at)) throw new TypeError('A valid audit time is required.');
  const allowed = new Set(supportedSports);
  const missing = new Map();
  let active = 0, reachable = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const expiry = Date.parse(row?.expires_at ?? row?.expiresAt ?? '');
    if (!Number.isFinite(expiry) || expiry <= at) continue;
    active += 1;
    const sport = String(row?.sport ?? '').trim().toUpperCase();
    if (allowed.has(sport)) reachable += 1;
    else missing.set(sport || 'UNKNOWN', (missing.get(sport || 'UNKNOWN') || 0) + 1);
  }
  return {
    observedAt: new Date(at).toISOString(), active, reachable,
    unreachable: active - reachable,
    missingBySport: [...missing].map(([sport, count]) => ({ sport, count }))
      .sort((a, b) => b.count - a.count || a.sport.localeCompare(b.sport)),
  };
}
