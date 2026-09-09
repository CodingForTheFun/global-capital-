import { fetchTheOddsApiBoard, theOddsApiHealth } from './the-odds-api.mjs';
import { fetchUnifiedBoard as fetchLegacyBoard, providerHealth as legacyProviderHealth } from './provider.mjs';

const text = (value) => String(value ?? '').trim();

export async function fetchUnifiedBoard(league, { signal, force = false } = {}) {
  // The Odds API is the preferred production feed. The $30 plan is quota-based,
  // so browser refreshes intentionally do not bypass the server-side API cache.
  if (text(process.env.THE_ODDS_API_KEY)) {
    try {
      return await fetchTheOddsApiBoard(league, { signal, force: false });
    } catch (error) {
      const fallback = await fetchLegacyBoard(league, { signal, force }).catch(() => null);
      if (fallback) {
        return {
          ...fallback,
          meta: {
            ...(fallback.meta || {}),
            warning: `The Odds API is connected but unavailable right now: ${String(error?.message || error)}`,
            preferredProvider: 'The Odds API',
          },
        };
      }
      throw error;
    }
  }
  return fetchLegacyBoard(league, { signal, force });
}

export function providerHealth() {
  const theOdds = theOddsApiHealth();
  const legacy = legacyProviderHealth();
  return {
    theOddsApiConfigured: theOdds.configured,
    sportsGameOddsConfigured: legacy.sportsGameOddsConfigured,
    sportsDataIoConfigured: legacy.sportsDataIoConfigured,
    preferredProvider: theOdds.configured ? 'The Odds API' : legacy.preferredProvider,
    theOddsApi: theOdds,
    time: new Date().toISOString(),
  };
}
