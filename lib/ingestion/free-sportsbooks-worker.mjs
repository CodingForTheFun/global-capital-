import { normalizedFeedBoard } from './normalize.mjs';
import { fetchFanDuelPublic, fanDuelSupportedSports } from './fanduel-public.mjs';
import { fetchPinnaclePublic, pinnacleSupportedSports } from './pinnacle-public.mjs';
import { fetchBetRiversPublic, betRiversSupportedSports } from './betrivers-public.mjs';
import { fetchBovadaPublic, bovadaSupportedSports } from './bovada-public.mjs';
import { fetchDraftKingsSportsbookPublic, draftKingsSportsbookSupportedSports } from './draftkings-sportsbook-public.mjs';
import { fetchBetMgmPublic, betMgmSupportedSports } from './betmgm-public.mjs';
import { persistPublicSnapshot, recordPublicStatus } from './public-persistence.mjs';

const text = (value) => String(value ?? '').trim();
const NO_PROPS_COOLDOWN_MS = 15 * 60_000;
const ERROR_COOLDOWN_MS = 30 * 60_000;
const nextAttemptAt = new Map();
function enabled(name, fallback = true) {
  const value = text(process.env[name]).toLowerCase();
  if (!value) return fallback;
  return !['0', 'false', 'no', 'off'].includes(value);
}
function publicRows(records, observedAt, book) {
  return normalizedFeedBoard(Array.isArray(records) ? records : [], { props: [] }, observedAt).props
    .filter((row) => row.sportsbookKey === book && row.isAlternate === false)
    .map((row) => ({ ...row, payoutType: 'sportsbook' }));
}
async function status(source, state) {
  try { await recordPublicStatus(source, state); } catch {}
}
async function ingest(book, sport, fetcher, source = `${book}:${sport}`) {
  const nextAt = Number(nextAttemptAt.get(source) || 0);
  if (nextAt > Date.now()) return { source, skipped: true, retryAt: new Date(nextAt).toISOString(), creditsCost: 0 };
  try {
    const snapshot = await fetcher(sport);
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
    return { source, persisted: true, rows: rows.length, written, transport: snapshot?.transport || `${book}-public`, creditsCost: 0 };
  } catch (error) {
    nextAttemptAt.set(source, Date.now() + ERROR_COOLDOWN_MS);
    await status(source, {
      status: 'unavailable', retained: true, code: text(error?.code || `${book.toUpperCase()}_PUBLIC_FAILED`).slice(0, 80),
      httpStatus: Number(error?.status) || null, creditsCost: 0,
    });
    return { source, persisted: false, retained: true, code: text(error?.code || `${book.toUpperCase()}_PUBLIC_FAILED`), httpStatus: Number(error?.status) || null, creditsCost: 0 };
  }
}

export async function runFreeSportsbooksCycle() {
  const results = [];
  if (enabled('AUTOSCOUT_FANDUEL_PUBLIC_ENABLED', true)) {
    for (const sport of fanDuelSupportedSports()) results.push(await ingest('fanduel', sport, fetchFanDuelPublic));
  }
  if (enabled('AUTOSCOUT_PINNACLE_PUBLIC_ENABLED', true)) {
    for (const sport of pinnacleSupportedSports()) results.push(await ingest('pinnacle', sport, fetchPinnaclePublic));
  }
  if (enabled('AUTOSCOUT_BETRIVERS_PUBLIC_ENABLED', true)) {
    for (const sport of betRiversSupportedSports()) results.push(await ingest('betrivers', sport, fetchBetRiversPublic));
  }
  if (enabled('AUTOSCOUT_BOVADA_PUBLIC_ENABLED', true)) {
    for (const sport of bovadaSupportedSports()) results.push(await ingest('bvda', sport, fetchBovadaPublic));
  }
  if (enabled('AUTOSCOUT_DRAFTKINGS_SPORTSBOOK_PUBLIC_ENABLED', true)) {
    for (const sport of draftKingsSportsbookSupportedSports()) {
      results.push(await ingest('draftkings', sport, fetchDraftKingsSportsbookPublic, `draftkings:${sport}:sportsbook`));
    }
  }
  if (enabled('AUTOSCOUT_BETMGM_PUBLIC_ENABLED', true)) {
    for (const sport of betMgmSupportedSports()) results.push(await ingest('betmgm', sport, fetchBetMgmPublic));
  }
  return { configured: true, results };
}
