import { fetchPinnaclePublic as fetchExistingPinnaclePublic, pinnacleSupportedSports } from './pinnacle-public.mjs';

const PUBLIC_WEB_KEY = 'CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R';
const UA = process.env.AUTOSCOUT_PUBLIC_FEED_USER_AGENT || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Arcadia's guest API currently accepts the same compact header set used by
 * pinnacle.com's public web client. Some edge nodes reject requests carrying
 * synthetic device/client-hint headers, so try the minimal public contract first.
 * The existing adapter remains the fallback and still owns parsing/caching.
 */
async function minimalPublicFetch(url, options = {}) {
  return globalThis.fetch(url, {
    ...options,
    headers: {
      accept: 'application/json',
      'user-agent': UA,
      origin: 'https://www.pinnacle.com',
      referer: 'https://www.pinnacle.com/',
      'x-api-key': PUBLIC_WEB_KEY,
    },
    redirect: 'follow',
  });
}

export { pinnacleSupportedSports };

export async function fetchPinnaclePublic(sport, options = {}) {
  // Preserve injected transports used by adapter tests.
  if (options.fetcher && options.fetcher !== globalThis.fetch) {
    return fetchExistingPinnaclePublic(sport, options);
  }

  try {
    const value = await fetchExistingPinnaclePublic(sport, {
      ...options,
      fetcher: minimalPublicFetch,
      force: true,
    });
    return { ...value, transport: 'pinnacle-public-minimal' };
  } catch (minimalError) {
    try {
      return await fetchExistingPinnaclePublic(sport, { ...options, force: true });
    } catch (existingError) {
      // Keep the more informative HTTP status when one path reached the API.
      if (!existingError?.status && minimalError?.status) existingError.status = minimalError.status;
      throw existingError;
    }
  }
}
