import { ProviderRegistry, PROVIDER_KINDS } from './contracts.mjs';
import { theOddsApiProvider } from './the-odds-api.mjs';
import { proplineProvider } from './propline.mjs';

const truthy = value => ['1','true','yes','on'].includes(String(value ?? '').trim().toLowerCase());
const oddsPaused = () => truthy(process.env.THE_ODDS_API_PAUSED);

export const autoScoutProviders = new ProviderRegistry();
autoScoutProviders.register(PROVIDER_KINDS.ODDS, theOddsApiProvider);
// Registered, not preferred. Without PROPLINE_API_KEY it reports unconfigured,
// so primaryOddsProvider() keeps returning exactly what it returned before.
autoScoutProviders.register(PROVIDER_KINDS.ODDS, proplineProvider);

const proplinePromoted = () => truthy(process.env.PROPLINE_PRIMARY);

// Adding a PropLine key must not move the board onto PropLine by itself. The
// registry returns providers in registration order, so a configured PropLine
// would otherwise become primary the moment a key appeared - swapping the data
// behind every prop on the site as a side effect of setting a variable.
// Promotion is its own explicit decision.
export function primaryOddsProvider() {
  if (proplinePromoted() && proplineProvider.isConfigured()) return proplineProvider;
  if (oddsPaused()) return null;
  return autoScoutProviders.configured(PROVIDER_KINDS.ODDS).find((provider) => provider.id !== 'propline') || null;
}

export function providerCatalog() {
  return Object.values(PROVIDER_KINDS).map((kind) => ({
    kind,
    providers: autoScoutProviders.list(kind).map((provider) => ({
      id: provider.id,
      name: provider.name,
      configured: oddsPaused() && provider.id === 'the-odds-api' ? false : provider.isConfigured(),
      paused: provider.id === 'the-odds-api' ? oddsPaused() : false,
      capabilities: [...(provider.capabilities || [])],
      supportedSports: [...(provider.supportedSports || [])],
    })),
  }));
}
