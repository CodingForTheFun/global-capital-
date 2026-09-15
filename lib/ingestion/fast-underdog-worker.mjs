import { fetchUnderdogV2Payload } from './underdog-v2.mjs';
import { normalizeUnderdog, normalizedFeedBoard } from './normalize.mjs';
import { persistPublicSnapshot, recordPublicStatus } from './public-persistence.mjs';

const text = (value) => String(value ?? '').trim();

export function createFastUnderdogRunner({
  fetchPayload = fetchUnderdogV2Payload,
  persistSnapshot = persistPublicSnapshot,
  recordStatus = recordPublicStatus,
  now = Date.now,
} = {}) {
  return async function run() {
    try {
      const payload = await fetchPayload();
      const records = normalizeUnderdog(payload);
      const observedAt = new Date(now()).toISOString();
      const rows = normalizedFeedBoard(records, { props: [] }, observedAt).props
        .filter((row) => row.sportsbookKey === 'underdog' && row.isAlternate === false);

      if (!rows.length) {
        await recordStatus('underdog', {
          status: 'no_props', retained: true, rows: 0, fetchedAt: observedAt,
          transport: 'http2-v2-fast-public', endpoint: 'api.underdogfantasy.com/v2', creditsCost: 0,
        }).catch(() => {});
        return { source: 'underdog', persisted: false, retained: true, rows: 0, creditsCost: 0 };
      }

      const result = await persistSnapshot('underdog', rows, observedAt);
      const written = Number(result?.written || 0);
      await recordStatus('underdog', {
        status: 'available', retained: false, rows: rows.length, written, fetchedAt: observedAt,
        transport: 'http2-v2-fast-public', endpoint: 'api.underdogfantasy.com/v2', creditsCost: 0,
      }).catch(() => {});
      return {
        source: 'underdog', persisted: true, rows: rows.length, written,
        transport: 'http2-v2-fast-public', creditsCost: 0,
      };
    } catch (error) {
      const code = text(error?.code || error?.message || 'UNDERDOG_FAST_REFRESH_FAILED').slice(0, 80);
      await recordStatus('underdog', {
        status: 'unavailable', retained: true, code,
        httpStatus: Number(error?.status) || null, transport: 'http2-v2-fast-public', creditsCost: 0,
      }).catch(() => {});
      return {
        source: 'underdog', persisted: false, retained: true, code,
        httpStatus: Number(error?.status) || null, creditsCost: 0,
      };
    }
  };
}

const runner = createFastUnderdogRunner();
export async function runFastUnderdogCycle() {
  return runner();
}
