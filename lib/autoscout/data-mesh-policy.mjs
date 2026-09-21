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
  };
}
