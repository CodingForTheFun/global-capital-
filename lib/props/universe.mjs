import { fromScanResult, toNumberOrNull } from './model.mjs';
import { fromSportsDataIoOffers } from './provider-model.mjs';
import { buildPropViewFrom } from './pipeline.mjs';
import { enrichProps } from '../data-sources/enrich.mjs';
import { normalizePlayerName } from '../data-sources/contract.mjs';
import { sportsDataIoPropBoard } from '../data-sources/sportsdataio/prop-board.mjs';
import { hydrateVisibleHistory } from './page-history.mjs';

function identityWithoutSource(prop = {}) {
  const line = toNumberOrNull(prop.line);
  return [
    String(prop.sport || '').toUpperCase(),
    normalizePlayerName(prop.playerName),
    String(prop.market || '').toLowerCase().replace(/\s+/g, ' ').trim(),
    line === null ? 'na' : Number(line).toFixed(2),
    String(prop.side || '').toUpperCase(),
  ].join('|');
}

/**
 * Unified prop universe.
 *
 * Provider-native real lines establish the broad All Props board. A PickFinder
 * row with the exact same sport/player/market/line/side replaces that row because
 * it carries richer verified research evidence. We never merge different lines,
 * different players, or different sides based on fuzzy similarity.
 */
export async function buildPropUniverse(scanResult, { sports = [], forceProvider = false } = {}) {
  const pickFinderProps = fromScanResult(scanResult);
  let providerBoard = null;
  let providerProps = [];
  let providerError = null;

  try {
    providerBoard = await sportsDataIoPropBoard.fetchBoard({
      sports: Array.isArray(sports) && sports.length ? sports : undefined,
      force: forceProvider,
    });
    providerProps = fromSportsDataIoOffers(providerBoard.offers, { fetchedAt: providerBoard.fetchedAt });
  } catch (error) {
    providerError = String(error?.code || error?.name || 'PROVIDER_BOARD_ERROR');
  }

  const merged = new Map();
  for (const prop of providerProps) merged.set(identityWithoutSource(prop), prop);
  for (const prop of pickFinderProps) merged.set(identityWithoutSource(prop), prop);

  return {
    props: [...merged.values()],
    meta: {
      total: merged.size,
      providerNative: providerProps.length,
      pickFinder: pickFinderProps.length,
      providerFetchedAt: providerBoard?.fetchedAt || null,
      providerLatencyMs: providerBoard?.latencyMs ?? null,
      providerCoverage: providerBoard?.coverage || [],
      providerError,
      sourceMode: providerProps.length ? 'provider-native' : 'pickfinder-fallback',
    },
  };
}

export async function buildUnifiedPropViewAsync(scanResult, options = {}) {
  const sports = Array.isArray(options?.filters?.sports) ? options.filters.sports : [];
  const universe = await buildPropUniverse(scanResult, { sports, forceProvider: options.forceProvider === true });
  let enriched = universe.props;
  let providers = [];
  try {
    const result = await enrichProps(universe.props);
    enriched = result.props;
    providers = result.providers;
  } catch {
    enriched = universe.props;
  }

  const view = buildPropViewFrom(enriched, {
    ...options,
    scannedAt: scanResult?.scannedAt || universe.meta.providerFetchedAt || null,
    providers,
  });

  // Historical game logs are intentionally hydrated only for the visible page.
  // This gives cards real L5/L10/L15/H2H data while preserving provider rate
  // limits; the shared HTTP client caches each player's game-log request.
  const hydratedProps = await hydrateVisibleHistory(view.props);
  return { ...view, props: hydratedProps, universe: universe.meta };
}
