import { ProviderRegistry, PROVIDER_KINDS } from './contracts.mjs';
import { theOddsApiProvider } from './the-odds-api.mjs';

export const autoScoutProviders = new ProviderRegistry();
autoScoutProviders.register(PROVIDER_KINDS.ODDS, theOddsApiProvider);

export function primaryOddsProvider() {
  return autoScoutProviders.configured(PROVIDER_KINDS.ODDS)[0] || null;
}

export function providerCatalog() {
  return Object.values(PROVIDER_KINDS).map((kind) => ({
    kind,
    providers: autoScoutProviders.list(kind).map((provider) => ({
      id: provider.id,
      name: provider.name,
      configured: provider.isConfigured(),
      capabilities: [...(provider.capabilities || [])],
      supportedSports: [...(provider.supportedSports || [])],
    })),
  }));
}
