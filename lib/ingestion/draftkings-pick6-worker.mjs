import { fetchDraftKingsPick6Records } from './draftkings-pick6.mjs';
import { normalizedFeedBoard } from './normalize.mjs';
import { persistPublicSnapshot, recordPublicStatus } from './public-persistence.mjs';

export async function runDraftKingsPick6Cycle({ sports = ['NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB','TENNIS'] } = {}) {
  const results = [];
  for (const sport of sports) {
    const source = `draftkings:${sport}`;
    try {
      const records = await fetchDraftKingsPick6Records(sport);
      const observedAt = new Date().toISOString();
      const board = normalizedFeedBoard(records, { props: [] }, observedAt);
      const rows = board.props.filter(row => row.sportsbookKey === 'draftkings' && row.isAlternate === false);
      const outcome = await persistPublicSnapshot(source, rows, observedAt);
      const result = { source, persisted: true, rows: rows.length, written: Number(outcome?.written || 0), transport: 'draftkings-pick6-public' };
      await recordPublicStatus(source, { status: rows.length ? 'available' : 'no_props', rows: rows.length, written: result.written, fetchedAt: observedAt, transport: result.transport }).catch(() => {});
      results.push(result);
    } catch (error) {
      const code = String(error?.code || error?.message || 'DRAFTKINGS_PICK6_FAILED').slice(0, 80);
      await recordPublicStatus(source, { status: 'unavailable', retained: true, code, httpStatus: Number(error?.status) || null, transport: 'draftkings-pick6-public' }).catch(() => {});
      results.push({ source, persisted: false, retained: true, code, httpStatus: Number(error?.status) || null });
    }
  }
  return results;
}
