import { assertIngestionActive, withIngestionDeadline, INGESTION_BUDGET_MS as B } from './operation-deadline.mjs';
import { fetchDraftKingsPick6Records } from './draftkings-pick6.mjs';
import { normalizedFeedBoard } from './normalize.mjs';
import { persistPublicSnapshot, recordPublicStatus } from './public-persistence.mjs';

export async function runDraftKingsPick6Cycle({ sports = ['NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB','TENNIS'] } = {}) {
  const results = [];
  for (const sport of sports) {
    const source = `draftkings:${sport}`;
    try {
      const result = await withIngestionDeadline(`pick6:${sport}`, async () => {
        const records = await fetchDraftKingsPick6Records(sport);
        assertIngestionActive();
        const observedAt = new Date().toISOString();
        const board = normalizedFeedBoard(records, { props: [] }, observedAt);
        const rows = board.props.filter(row => row.sportsbookKey === 'draftkings' && row.isAlternate === false);
        const outcome = await persistPublicSnapshot(source, rows, observedAt);
        const result = { source, persisted: true, rows: rows.length, written: Number(outcome?.written || 0), transport: 'draftkings-pick6-public' };
        await withIngestionDeadline(`pick6-status:${sport}`, () => recordPublicStatus(source, { status: rows.length ? 'available' : 'no_props', rows: rows.length, written: result.written, fetchedAt: observedAt, transport: result.transport }), B.status).catch(() => {});
        return result;
      }, B.provider);
      results.push(result);
    } catch (error) {
      const code = String(error?.code || error?.message || 'DRAFTKINGS_PICK6_FAILED').slice(0, 80);
      await withIngestionDeadline(`pick6-status:${sport}`, () => recordPublicStatus(source, { status: 'unavailable', retained: true, code, httpStatus: Number(error?.status) || null, transport: 'draftkings-pick6-public' }), B.status).catch(() => {});
      results.push({ source, persisted: false, retained: true, code, httpStatus: Number(error?.status) || null });
    }
  }
  return results;
}
