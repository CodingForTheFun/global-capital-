// SportsDataIO betting metadata (lookup tables).
//
// The player-props payload identifies market, bet, outcome and period types by
// numeric ID. odds.mjs resolves those IDs through `metadata.*ById` maps and
// falls back to name fields on the payload when a map is absent. When the feed
// supplies IDs but no names, that fallback yields null, `side` and `market`
// come out empty, and offerFromOutcome drops EVERY offer — an empty board from
// a feed that answered 200.
//
// This module loads /{sport}/odds/json/BettingMetadata and builds those maps.
// It is deliberately additive: if the call fails or the shape is unfamiliar,
// it returns empty maps and normalisation behaves exactly as it does today.

const METADATA_TTL_MS = 12 * 60 * 60 * 1000; // reference data; changes rarely

const KEY_HINTS = Object.freeze({
  marketTypeById: [/^bettingmarkettypes?$/i, /markettypes?$/i],
  betTypeById: [/^bettingbettypes?$/i, /bettypes?$/i],
  outcomeTypeById: [/^bettingoutcometypes?$/i, /outcometypes?$/i],
  periodTypeById: [/^bettingperiodtypes?$/i, /periodtypes?$/i],
});

const ID_FIELDS = ['BettingMarketTypeID', 'BettingBetTypeID', 'BettingOutcomeTypeID', 'BettingPeriodTypeID', 'ID', 'Id', 'TypeID'];
const NAME_FIELDS = ['Name', 'Description', 'BettingMarketType', 'BettingBetType', 'BettingOutcomeType', 'BettingPeriodType', 'Type'];

const firstOf = (row, fields) => {
  for (const field of fields) {
    const value = row?.[field];
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
};

/** Turn a list of {id, name} rows into an id -> name map. */
export function toMap(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue;
    const id = firstOf(row, ID_FIELDS);
    const name = firstOf(row, NAME_FIELDS);
    if (id === null || name === null) continue;
    map.set(String(id), String(name));
  }
  return map;
}

/**
 * Build the four lookup maps from a BettingMetadata payload.
 * Handles the payload being an object of named arrays, or a flat array of
 * typed rows, without assuming one shape.
 */
export function buildMetadata(payload) {
  const out = { marketTypeById: new Map(), betTypeById: new Map(), outcomeTypeById: new Map(), periodTypeById: new Map() };
  if (!payload || typeof payload !== 'object') return out;

  if (!Array.isArray(payload)) {
    for (const [key, value] of Object.entries(payload)) {
      if (!Array.isArray(value)) continue;
      for (const [target, patterns] of Object.entries(KEY_HINTS)) {
        if (patterns.some((pattern) => pattern.test(key))) {
          const map = toMap(value);
          if (map.size) out[target] = map;
          break;
        }
      }
    }
    return out;
  }

  // A flat array: split rows by whichever typed ID field they carry.
  const buckets = { marketTypeById: [], betTypeById: [], outcomeTypeById: [], periodTypeById: [] };
  for (const row of payload) {
    if (row?.BettingMarketTypeID !== undefined) buckets.marketTypeById.push(row);
    else if (row?.BettingBetTypeID !== undefined) buckets.betTypeById.push(row);
    else if (row?.BettingOutcomeTypeID !== undefined) buckets.outcomeTypeById.push(row);
    else if (row?.BettingPeriodTypeID !== undefined) buckets.periodTypeById.push(row);
  }
  for (const [target, rows] of Object.entries(buckets)) {
    const map = toMap(rows);
    if (map.size) out[target] = map;
  }
  return out;
}

export function isEmptyMetadata(metadata) {
  return !metadata || Object.values(metadata).every((map) => !map || map.size === 0);
}

/**
 * Load and cache the metadata for one league.
 * Never throws: a failure returns empty maps and the caller proceeds unchanged.
 */
export function createMetadataLoader({ client, base }) {
  const cache = new Map(); // sport -> { at, metadata }

  return async function loadMetadata(sport, league) {
    const key = String(sport || '').toUpperCase();
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < METADATA_TTL_MS) return cached.metadata;

    const path = `${league.path}/odds/json/BettingMetadata`;
    let metadata = { marketTypeById: new Map(), betTypeById: new Map(), outcomeTypeById: new Map(), periodTypeById: new Map() };
    try {
      const result = await client.get(`${base}/${path}`, path, { ttlMs: METADATA_TTL_MS, sport });
      if (result.ok) metadata = buildMetadata(result.data);
    } catch {
      // Leave the empty maps in place; odds.mjs falls back to payload names.
    }
    cache.set(key, { at: Date.now(), metadata });
    return metadata;
  };
}
