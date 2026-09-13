import { ProviderRegistry, PROVIDER_KINDS } from './contracts.mjs';
import { theOddsApiProvider } from './the-odds-api.mjs';

const truthy = value => ['1','true','yes','on'].includes(String(value ?? '').trim().toLowerCase());
const oddsPaused = () => truthy(process.env.THE_ODDS_API_PAUSED);

export const autoScoutProviders = new ProviderRegistry();
autoScoutProviders.register(PROVIDER_KINDS.ODDS, theOddsApiProvider);

export function primaryOddsProvider() {
  if (oddsPaused()) return null;
  return autoScoutProviders.configured(PROVIDER_KINDS.ODDS)[0] || null;
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
