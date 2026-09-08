import { searchLiveProps as legacySearch, scanLiveProp as legacyScan } from './focused.mjs';
import { evaluatePick } from './criteria.mjs';

const TZ = process.env.SCAN_TIME_ZONE || 'America/Chicago';

function todayKey() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}${get('month')}${get('day')}`;
}

function sourceParts(sourceUrl = '') {
  try {
    const url = new URL(sourceUrl);
    const prop = decodeURIComponent(url.searchParams.get('prop') || '').split(':');
    const sport = url.pathname.match(/\/players\/([^/]+)/i)?.[1]?.toUpperCase() || 'UNKNOWN';
    return { sport, matchId: prop[2] || '' };
  } catch {
    return { sport: 'UNKNOWN', matchId: '' };
  }
}

function isTodayFromMatchId(matchId = '') {
  const prefix = String(matchId).match(/^(\d{8})/)?.[1];
  return prefix ? prefix === todayKey() : null;
}

export async function searchLiveProps(query) {
  const result = await legacySearch(query);
  return {
    ...result,
    results: (result?.results || []).map((row) => {
      const parsed = sourceParts(row.sourceUrl);
      return {
        ...row,
        sport: String(row.sport || '').toUpperCase() === 'UNKNOWN' ? parsed.sport : row.sport,
        matchId: row.matchId || parsed.matchId,
      };
    }),
  };
}

export async function scanLiveProp(selection = {}) {
  const result = await legacyScan(selection);
  if (!result?.pick) return result;
  const parsed = sourceParts(result.pick.sourceUrl || selection.sourceUrl);
  const derivedToday = isTodayFromMatchId(result.pick.matchId || parsed.matchId);
  const corrected = {
    ...result.pick,
    sport: String(result.pick.sport || '').toUpperCase() === 'UNKNOWN' ? parsed.sport : result.pick.sport,
    matchId: result.pick.matchId || parsed.matchId,
    isToday: derivedToday === null ? result.pick.isToday === true : derivedToday,
  };
  return {
    ...result,
    pick: evaluatePick(corrected),
    dateVerifiedFromMatchId: derivedToday !== null,
  };
}
