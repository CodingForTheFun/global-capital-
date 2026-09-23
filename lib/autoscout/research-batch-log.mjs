// One log line per /api/apex/research-batch request, so the reason the board's
// L5/L10/L15 cells are blank can be read from the deploy logs. It says only
// which sports were asked for and how each prop's research came back (its
// code), never player names, lines or anything tied to a user.

const SAFE_CODE = /^[A-Z0-9_]{1,60}$/;

function outcome(result) {
  if (!result) return 'NO_RESULT';
  if (result.available !== false && result.ok !== false) return 'OK';
  const code = String(result.code || (result.ok === false ? 'ERROR' : 'UNAVAILABLE'));
  return SAFE_CODE.test(code) ? code : 'OTHER';
}

/**
 * @param {Array<{key: string, params: {sport?: string}}>} entries
 * @param {Record<string, any>} results
 * @param {number} elapsedMs
 */
export function researchBatchSummary(entries, results, elapsedMs) {
  const bySport = {};
  for (const entry of entries) {
    const sport = String(entry?.params?.sport || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'UNKNOWN';
    const code = outcome(results?.[entry.key]);
    const counts = (bySport[sport] ||= {});
    counts[code] = (counts[code] || 0) + 1;
  }
  return { props: entries.length, elapsedMs: Math.round(elapsedMs), bySport };
}

export function researchBatchLogLine(entries, results, elapsedMs) {
  return `[research-batch] ${JSON.stringify(researchBatchSummary(entries, results, elapsedMs))}`;
}
