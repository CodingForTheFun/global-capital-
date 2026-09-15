import { normalizedFeedBoard } from './normalize.mjs';
import { fetchFanDuelPublic, fanDuelSupportedSports } from './fanduel-public.mjs';
import { fetchPinnaclePublic, pinnacleSupportedSports } from './pinnacle-public.mjs';
import { fetchBetRiversPublic, betRiversSupportedSports } from './betrivers-public.mjs';
import { fetchBovadaPublic, bovadaSupportedSports } from './bovada-public.mjs';
import { fetchDraftKingsSportsbookPublic, draftKingsSportsbookSupportedSports } from './draftkings-edge-fallback.mjs';
import { fetchBetMgmPublic, betMgmSupportedSports } from './betmgm-edge-fallback.mjs';
import { isVerifiedPlayerPropRow } from './player-prop-integrity.mjs';
import { persistPublicSnapshot, recordPublicStatus } from './public-persistence.mjs';

const text = (value) => String(value ?? '').trim();
const NO_PROPS_COOLDOWN_MS = 3 * 60_000;
const ERROR_COOLDOWN_MS = 10 * 60_000;
const FEED_TIMEOUT_MS = Math.min(30_000, Math.max(5_000, Number(process.env.AUTOSCOUT_PUBLIC_PROVIDER_TIMEOUT_MS) || 15_000));
const nextAttemptAt = new Map();

function enabled(name, fallback = true) {
  const value = text(process.env[name]).toLowerCase();
  if (!value) return fallback;
  return !['0', 'false', 'no', 'off'].includes(value);
}
function publicRows(records, observedAt, book) {
  return normalizedFeedBoard(Array.isArray(records) ? records : [], { props: [] }, observedAt).props
    .filter((row) => row.sportsbookKey === book && row.isAlternate === false && isVerifiedPlayerPropRow(row))
    .map((row) => ({ ...row, payoutType: 'sportsbook' }));
}
async function status(source, state) {
  try { await recordPublicStatus(source, state); } catch {}
}
async function withDeadline(task, source) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`PUBLIC_FEED_TIMEOUT:${source}`), {
      code: 'PUBLIC_FEED_TIMEOUT',
    })), FEED_TIMEOUT_MS);
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function ingest(book, sport, fetcher, source = `${book}:${sport}`) {
  const nextAt = Number(nextAttemptAt.get(source) || 0);
  if (nextAt > Date.now()) return { source, skipped: true, retryAt: new Date(nextAt).toISOString(), creditsCost: 0 };
  try {
    // This worker owns the three-minute public cadence, so bypass each adapter's
    // longer in-process cache. A hard deadline keeps one blocked provider from
    // stalling every other book while preserving last-known-good rows.
    const snapshot = await withDeadline(
      Promise.resolve().then(() => fetcher(sport, { force: true })),
      source,
    );
    const observedAt = snapshot?.fetchedAt || new Date().toISOString();
    const rows = publicRows(snapshot?.records || [], observedAt, book);
    if (!rows.length) {
      nextAttemptAt.set(source, Date.now() + NO_PROPS_COOLDOWN_MS);
      await status(source, {
        status: 'no_props', retained: true, rows: 0, fetchedAt: observedAt,
        transport: snapshot?.transport || `${book}-public`, endpoint: snapshot?.endpoint || null,
        eventsChecked: Number(snapshot?.eventsChecked || 0), creditsCost: 0,
      });
      return { source, persisted: false, retained: true, rows: 0, transport: snapshot?.transport || `${book}-public`, creditsCost: 0 };
    }
    nextAttemptAt.delete(source);
    const result = await persistPublicSnapshot(source, rows, observedAt);
    const written = Number(result?.written || 0);
    await status(source, {
      status: 'available', retained: false, rows: rows.length, written, fetchedAt: observedAt,
      transport: snapshot?.transport || `${book}-public`, endpoint: snapshot?.endpoint || null,
      eventsChecked: Number(snapshot?.eventsChecked || 0), creditsCost: 0,
    });
    return { source, persisted: true, rows: rows.length, written, transport: snapshot?.transport || `${book}-public`, endpoint: snapshot?.endpoint || null, creditsCost: 0 };
  } catch (error) {
    nextAttemptAt.set(source, Date.now() + ERROR_COOLDOWN_MS);
    await status(source, {
      status: 'unavailable', retained: true, code: text(error?.code || `${book.toUpperCase()}_PUBLIC_FAILED`).slice(0, 80),
      httpStatus: Number(error?.status) || null, creditsCost: 0,
    });
    return { source, persisted: false, retained: true, code: text(error?.code || `${book.toUpperCase()}_PUBLIC_FAILED`), httpStatus: Number(error?.status) || null, creditsCost: 0 };
  }
}
async function runProvider(book, sports, fetcher, sourceFor = (sport) => `${book}:${sport}`) {
  const results = [];
  for (const sport of sports) results.push(await ingest(book, sport, fetcher, sourceFor(sport)));
  return results;
}

export async function runFreeSportsbooksCycle() {
  // Providers run independently so a degraded endpoint cannot hold the entire
  // sportsbook refresh hostage. Sports within one provider stay sequential to
  // avoid bursty traffic and accidental provider-side throttling.
  const providers = [];
  if (enabled('AUTOSCOUT_FANDUEL_PUBLIC_ENABLED', true)) {
    providers.push(runProvider('fanduel', fanDuelSupportedSports(), fetchFanDuelPublic));
  }
  if (enabled('AUTOSCOUT_PINNACLE_PUBLIC_ENABLED', true)) {
    providers.push(runProvider('pinnacle', pinnacleSupportedSports(), fetchPinnaclePublic));
  }
  if (enabled('AUTOSCOUT_BETRIVERS_PUBLIC_ENABLED', true)) {
    providers.push(runProvider('betrivers', betRiversSupportedSports(), fetchBetRiversPublic));
  }
  if (enabled('AUTOSCOUT_BOVADA_PUBLIC_ENABLED', true)) {
    providers.push(runProvider('bvda', bovadaSupportedSports(), fetchBovadaPublic));
  }
  if (enabled('AUTOSCOUT_DRAFTKINGS_SPORTSBOOK_PUBLIC_ENABLED', true)) {
    providers.push(runProvider(
      'draftkings',
      draftKingsSportsbookSupportedSports(),
      fetchDraftKingsSportsbookPublic,
      (sport) => `draftkings:${sport}:sportsbook`,
    ));
  }
  if (enabled('AUTOSCOUT_BETMGM_PUBLIC_ENABLED', true)) {
    providers.push(runProvider('betmgm', betMgmSupportedSports(), fetchBetMgmPublic));
  }

  const groups = await Promise.all(providers);
  return { configured: true, results: groups.flat() };
}
