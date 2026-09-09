// Merge provider enrichment into normalized props.
//
// Guarantees:
//  - PickFinder's verified fields are never overwritten by a provider.
//  - Only fields a provider declared as a capability are accepted.
//  - Every enriched field records which provider supplied it, so score
//    transparency and the prop detail view can cite the source.
//  - A provider that throws, times out or returns nothing degrades to
//    un-enriched props. Enrichment failure never fails a scan.

import { enrichmentKey, sanitizeEnrichment, sameTeam } from './contract.mjs';
import { listProviders, recordSuccess, recordFailure, PROVIDER_STATUS, providerStatus } from './registry.mjs';

const DEFAULT_TIMEOUT_MS = 8000;

async function withTimeout(promise, ms, onTimeout) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(onTimeout()), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask every active provider to enrich this population.
 *
 * @returns {Promise<{props: object[], providers: object[], enrichedCount: number}>}
 */
export async function enrichProps(props = [], { timeoutMs = DEFAULT_TIMEOUT_MS, log = console } = {}) {
  const active = listProviders().filter((adapter) => {
    try { return adapter.isConfigured() === true; } catch { return false; }
  });

  if (!active.length || !props.length) {
    return { props, providers: providerStatus(), enrichedCount: 0 };
  }

  // Provider order is registration order; later providers fill gaps left by
  // earlier ones rather than overwriting them, so the first configured
  // provider for a field wins deterministically.
  const merged = new Map();
  for (const adapter of active) {
    const started = Date.now();
    try {
      const result = await withTimeout(
        adapter.fetchEnrichment({ props, signal: undefined }),
        timeoutMs,
        () => Object.assign(new Error('provider timeout'), { code: 'PROVIDER_TIMEOUT' }),
      );
      const rows = result instanceof Map ? result : new Map(Object.entries(result || {}));
      for (const [key, raw] of rows) {
        // An adapter that could not identify the player confidently returns a
        // refusal. Record why, and attach nothing: an unmatched prop is
        // enriched with nothing rather than with someone else's data.
        if (raw?.__identity && raw.__identity.matched === false) {
          const existing = merged.get(key) || { values: {}, sources: {}, opponents: {}, meta: {} };
          existing.meta[adapter.id] = { matched: false, ...raw.__identity, fetchedAt: raw.__fetchedAt ?? null };
          merged.set(key, existing);
          continue;
        }
        const clean = sanitizeEnrichment(raw, adapter.capabilities);
        if (!Object.keys(clean).length) continue;
        const existing = merged.get(key) || { values: {}, sources: {}, opponents: {}, meta: {} };
        if (raw?.__opponent) existing.opponents[adapter.id] = raw.__opponent;
        if (raw?.__identity || raw?.__fetchedAt) {
          existing.meta[adapter.id] = { matched: true, ...(raw.__identity || {}), fetchedAt: raw.__fetchedAt ?? null };
        }
        for (const [field, value] of Object.entries(clean)) {
          if (field in existing.values) continue; // first provider wins
          existing.values[field] = value;
          existing.sources[field] = adapter.id;
        }
        merged.set(key, existing);
      }
      recordSuccess(adapter.id, Date.now() - started);
    } catch (error) {
      // Detail to the server log only; the dashboard sees provider status.
      recordFailure(adapter.id);
      log?.error?.('[AutoProp provider] enrichment failed', JSON.stringify({
        provider: adapter.id,
        code: error?.code || null,
        message: String(error?.message || error).slice(0, 500),
      }));
    }
  }

  let enrichedCount = 0;
  const stamp = new Date().toISOString();
  const enriched = props.map((prop) => {
    const row = merged.get(enrichmentKey(prop));
    if (!row) return prop;
    // Carry the refusal onto the prop so the UI can say "player analytics
    // unavailable" instead of silently showing nothing.
    if (!Object.keys(row.values).length) {
      return Object.keys(row.meta || {}).length ? { ...prop, enrichment: { at: stamp, providers: row.meta } } : prop;
    }
    // Guard against a same-name player in a different game: if a provider told
    // us the opponent and it contradicts the prop, drop the match entirely
    // rather than attaching another player's projection.
    const contradicts = Object.values(row.opponents).some((opponent) => !sameTeam(opponent, prop.opponent));
    if (contradicts) return prop;
    enrichedCount++;
    return {
      ...prop,
      ...row.values,
      // Provenance per field, so nothing enriched is ever presented as if the
      // primary source verified it.
      enrichedBy: row.sources,
      enrichment: { at: stamp, providers: row.meta || {} },
    };
  });

  return { props: enriched, providers: providerStatus(), enrichedCount };
}

/** True when at least one provider is connected and answering. */
export function hasActiveProvider() {
  return providerStatus().some((row) => row.status === PROVIDER_STATUS.ACTIVE);
}
