export const providerRegistry = [
  {
    id: 'pickfinder',
    name: 'PickFinder',
    status: 'active',
    capabilities: ['props', 'sportsbooks', 'dfs', 'filters', 'line-movement', 'focused-search'],
    auth: 'encrypted-session',
    adapter: 'scanner/masterpiece.mjs',
  },
  {
    id: 'outlier',
    name: 'Outlier',
    status: 'account-required',
    capabilities: ['props', 'sportsbooks', 'hit-rates', 'ev', 'line-shopping'],
    auth: 'future-authorized-account-or-api',
  },
  {
    id: 'props-cash',
    name: 'Props.Cash',
    status: 'account-required',
    capabilities: ['props', 'hit-rates', 'filters', 'odds-comparison'],
    auth: 'future-authorized-account-or-api',
  },
  {
    id: 'oddsjam',
    name: 'OddsJam',
    status: 'account-required',
    capabilities: ['sportsbooks', 'odds', 'ev', 'arbitrage', 'line-shopping'],
    auth: 'future-authorized-account-or-api',
  },
  {
    id: 'picklabs',
    name: 'PickLabs',
    status: 'account-required',
    capabilities: ['props', 'models', 'hit-rates', 'slip-builder'],
    auth: 'future-authorized-account-or-api',
  },
];

export function activeProviders() {
  return providerRegistry.filter((provider) => provider.status === 'active');
}
