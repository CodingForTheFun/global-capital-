const text = (value) => String(value ?? '').trim();
const truthy = (value) => ['1','true','yes','on'].includes(text(value).toLowerCase());

export const MESH_CAPABILITIES = Object.freeze({
  quotes: Object.freeze(['sportsgameodds','propline']),
  dfsContext: Object.freeze(['propline','sportsgameodds']),
  schedules: Object.freeze(['sportradar','sportsgameodds','espn']),
  identities: Object.freeze(['sportradar','sportsgameodds','espn']),
  rosters: Object.freeze(['sportradar','sportsgameodds','espn','sportsdataio-research']),
  injuries: Object.freeze(['sportradar','sportsdataio-research']),
  history: Object.freeze([
    'sportradar',
    'espn',
    'clearsports',
    'sportsgameodds',
    'sport-specific-archives',
    'sportsdataio-research',
  ]),
  images: Object.freeze(['sportradar-images','existing-artwork-cache']),
});

export function meshProviderConfiguration(env = process.env) {
  return {
    sportsgameodds: Boolean(text(env.SPORTS_ODDS_API_KEY_HEADER || env.SPORTSGAMEODDS_API_KEY || env.SPORTS_GAME_ODDS_API_KEY)),
    propline: Boolean(text(env.PROPLINE_API_KEY)),
    sportradar: Boolean(text(env.SPORTRADAR_API_KEY)),
    clearsports: Boolean(text(env.CLEARSPORTS_API_KEY)),
    sportsdataioResearch: Boolean(text(env.SPORTSDATAIO_API_KEY)) && env.AUTOSCOUT_SPORTSDATAIO_RESEARCH_ONLY === 'true',
    theOddsApi: Boolean(text(env.THE_ODDS_API_KEY)) && !truthy(env.THE_ODDS_API_PAUSED),
    espn: true,
  };
}

/**
 * Fields in this policy that nothing reads.
 *
 * `meshPolicy()` is called in exactly two places, both of which publish it in
 * the health payload, and each key below has no consumer anywhere else in the
 * tree. They are hand-written descriptions of intent, and published beside
 * `configured` — which is read from the environment and is true — they read
 * like live configuration. `quoteOverwrite: { sportsgameodds: true }` in
 * particular has already been taken for an active merge rule and reasoned about
 * as a risk to customer-facing lines; nothing consults it.
 *
 * Naming them here is cheaper than deleting them: the intent is worth keeping
 * where the behaviour is still wanted, and a reader of /api/apex/health should
 * not have to grep the repository to find out which half is real.
 *
 * To re-check, search for each key outside this file.
 */
export const ADVISORY_FIELDS = Object.freeze([
  'quoteOverwrite',
  'researchParallel',
  'noFabrication',
  'publicFeedRole',
  'capabilities',
]);

export function meshPolicy(env = process.env) {
  const configured = meshProviderConfiguration(env);
  return {
    mode: 'mesh',
    quotePrimary: 'sportsgameodds',
    quoteFallbacks: ['propline'],
    quoteOverwrite: Object.freeze({
      sportsgameodds: true,
      propline: false,
    }),
    researchParallel: true,
    noFabrication: true,
    publicFeedRole: 'off',
    capabilities: MESH_CAPABILITIES,
    configured,
    // Which of the above describe intent rather than behaviour. `configured`,
    // `quotePrimary` and `quoteFallbacks` are excluded because they are read.
    advisory: ADVISORY_FIELDS,
  };
}
