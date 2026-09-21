import { ProviderRegistry, PROVIDER_KINDS } from './contracts.mjs';
import { theOddsApiProvider } from './the-odds-api.mjs';
import { proplineProvider } from './propline.mjs';
import { sportradarProvider } from './sportradar.mjs';
import { sportsGameOddsProvider } from './sportsgameodds.mjs';
import { propProviderMode, providerRouting } from '../provider-mode.mjs';

const truthy = value => ['1','true','yes','on'].includes(String(value ?? '').trim().toLowerCase());
const oddsPaused = () => truthy(process.env.THE_ODDS_API_PAUSED);

export const autoScoutProviders = new ProviderRegistry();
autoScoutProviders.register(PROVIDER_KINDS.ODDS, theOddsApiProvider);
autoScoutProviders.register(PROVIDER_KINDS.ODDS, proplineProvider);
autoScoutProviders.register(PROVIDER_KINDS.ODDS, sportradarProvider);
autoScoutProviders.register(PROVIDER_KINDS.ODDS, sportsGameOddsProvider);

const proplinePromoted = () => truthy(process.env.PROPLINE_PRIMARY);

function configuredProvider(id) {
  const provider = autoScoutProviders.get(PROVIDER_KINDS.ODDS, id);
  return provider?.isConfigured?.() ? provider : null;
}

export function primaryOddsProvider() {
  const mode = propProviderMode();

  if (mode !== 'auto') {
    const routing = providerRouting();
    for (const id of [routing.primary, ...routing.fallback]) {
      const provider = configuredProvider(id);
      if (provider) return provider;
    }
    if (!oddsPaused()) return configuredProvider('the-odds-api');
    return null;
  }

  // AUTO preserves the legacy production behavior so merely removing the
  // switch cannot unexpectedly move the board to a different paid provider.
  if (proplinePromoted()) {
    const propline = configuredProvider('propline');
    if (propline) return propline;
  }
  if (!oddsPaused()) {
    const legacy = configuredProvider('the-odds-api');
    if (legacy) return legacy;
  }
  return configuredProvider('sportradar')
    || configuredProvider('sportsgameodds')
    || configuredProvider('propline')
    || null;
}

export function providerCatalog() {
  const mode = propProviderMode();
  const routing = providerRouting();
  return Object.values(PROVIDER_KINDS).map((kind) => ({
    kind,
    mode,
    primary: kind === PROVIDER_KINDS.ODDS ? routing.primary : null,
    providers: autoScoutProviders.list(kind).map((provider) => ({
      id: provider.id,
      name: provider.name,
      configured: oddsPaused() && provider.id === 'the-odds-api' ? false : provider.isConfigured(),
      paused: provider.id === 'the-odds-api' ? oddsPaused() : false,
      selected: kind === PROVIDER_KINDS.ODDS && routing.primary === provider.id,
      capabilities: [...(provider.capabilities || [])],
      supportedSports: [...(provider.supportedSports || [])],
    })),
  }));
}
