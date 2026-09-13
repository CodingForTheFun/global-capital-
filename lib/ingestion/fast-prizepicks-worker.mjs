import { http2JsonFetch } from './http2-json-fetch.mjs';
import { normalizePrizePicks, normalizedFeedBoard } from './normalize.mjs';
import { persistPublicSnapshot, recordPublicStatus } from './public-persistence.mjs';

const ROOTS = Object.freeze([
  'https://partner-api.prizepicks.com/projections?per_page=250',
  'https://api.prizepicks.com/projections?per_page=250',
]);

const text = (value) => String(value ?? '').trim();

async function fetchAll(root, fetchJson) {
  let current = root;
  let combined = null;
  const seen = new Set();
  for (let page = 0; page < 30; page++) {
    if (seen.has(current)) throw Object.assign(new Error('PRIZEPICKS_PAGINATION_LOOP'), { code: 'PRIZEPICKS_PAGINATION_LOOP' });
    seen.add(current);
    const data = await fetchJson(current);
    if (!Array.isArray(data?.data) || !Array.isArray(data?.included)) {
      throw Object.assign(new Error('INVALID_PRIZEPICKS_SCHEMA'), { code: 'INVALID_PRIZEPICKS_SCHEMA' });
    }
    combined = combined ? {
      ...data,
      data: [...combined.data, ...data.data],
      included: [...new Map([...combined.included, ...data.included].map((row) => [`${row.type}:${row.id}`, row])).values()],
    } : data;
    const next = typeof data.links?.next === 'string' ? data.links.next : data.links?.next?.href;
    if (!next) return combined;
    const target = new URL(next, current);
    const base = new URL(root);
    if (target.origin !== base.origin || target.pathname !== base.pathname) {
      throw Object.assign(new Error('PRIZEPICKS_BAD_NEXT'), { code: 'PRIZEPICKS_BAD_NEXT' });
    }
    current = target.href;
  }
  throw Object.assign(new Error('PRIZEPICKS_TOO_MANY_PAGES'), { code: 'PRIZEPICKS_TOO_MANY_PAGES' });
}

export function createFastPrizePicksRunner({
  fetchJson = http2JsonFetch,
  persistSnapshot = persistPublicSnapshot,
  recordStatus = recordPublicStatus,
  now = Date.now,
} = {}) {
  return async function run() {
    let lastError = null;
    for (const root of ROOTS) {
      try {
        const payload = await fetchAll(root, fetchJson);
        const records = normalizePrizePicks(payload);
        const observedAt = new Date(now()).toISOString();
        const rows = normalizedFeedBoard(records, { props: [] }, observedAt).props
          .filter((row) => row.sportsbookKey === 'prizepicks' && row.isAlternate === false);
        if (!rows.length) {
          await recordStatus('prizepicks', {
            status: 'no_props', retained: true, rows: 0, fetchedAt: observedAt,
            transport: 'http2-fast-public', endpoint: new URL(root).host, creditsCost: 0,
          }).catch(() => {});
          return { source: 'prizepicks', persisted: false, retained: true, rows: 0, creditsCost: 0 };
        }
        const result = await persistSnapshot('prizepicks', rows, observedAt);
        const written = Number(result?.written || 0);
        await recordStatus('prizepicks', {
          status: 'available', retained: false, rows: rows.length, written, fetchedAt: observedAt,
          transport: 'http2-fast-public', endpoint: new URL(root).host, creditsCost: 0,
        }).catch(() => {});
        return { source: 'prizepicks', persisted: true, rows: rows.length, written, transport: 'http2-fast-public', creditsCost: 0 };
      } catch (error) {
        lastError = error;
      }
    }
    const code = text(lastError?.code || lastError?.message || 'PRIZEPICKS_FAST_REFRESH_FAILED').slice(0, 80);
    await recordStatus('prizepicks', {
      status: 'unavailable', retained: true, code,
      httpStatus: Number(lastError?.status) || null, transport: 'http2-fast-public', creditsCost: 0,
    }).catch(() => {});
    return { source: 'prizepicks', persisted: false, retained: true, code, httpStatus: Number(lastError?.status) || null, creditsCost: 0 };
  };
}

const runner = createFastPrizePicksRunner();
export async function runFastPrizePicksCycle() {
  return runner();
}
