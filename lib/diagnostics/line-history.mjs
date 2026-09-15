/**
 * Line-history health analysis.
 *
 * `line_snapshots` is a change-log, not a poll log: its unique constraint on
 * (prop_id, bookmaker_key, side, line, price, provider_updated_at) means a row
 * exists only when a quote actually moved. So "is line history working?" is not
 * answered by a row count. A table can hold thousands of rows and still be
 * useless if every one was written in a single burst -- that is exactly the
 * failure this project already hit once, where 1,274 rows carried a longest
 * tracked span of 00:00:00 and averaged 1.02 snapshots per series.
 *
 * The question that matters is whether individual series are being observed
 * repeatedly over time, because a series with one row proves nothing moved and
 * a series with many rows spanning hours is the movement the product sells.
 *
 * This module is pure: it takes rows and returns a verdict, so it can be tested
 * without a database.
 */

/** A series is one quote stream: this prop, at this book, on this side. */
export function seriesKey(row) {
  return `${row?.prop_id ?? ''}|${row?.bookmaker_key ?? ''}|${row?.side ?? ''}`;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Milliseconds for a row's observation time.
 *
 * `created_at` is when this service recorded the change and is always present.
 * `provider_updated_at` is the upstream stamp and is nullable, so it is never
 * used as the time axis -- an absent value must not silently become epoch 0.
 */
function observedAt(row) {
  const parsed = Date.parse(row?.created_at ?? row?.ingested_at ?? '');
  return Number.isFinite(parsed) ? parsed : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * @param rows  line_snapshots rows: prop_id, bookmaker_key, side, created_at.
 * @param now   evaluation time, injectable so tests are not clock-dependent.
 * @param windowDays  how far back the caller asked for.
 */
export function analyzeLineHistory(rows = [], { now = Date.now(), windowDays = 7 } = {}) {
  const usable = (Array.isArray(rows) ? rows : []).filter((row) => observedAt(row) !== null);
  const series = new Map();
  for (const row of usable) {
    const key = seriesKey(row);
    const at = observedAt(row);
    const entry = series.get(key) || { count: 0, first: at, last: at };
    entry.count += 1;
    if (at < entry.first) entry.first = at;
    if (at > entry.last) entry.last = at;
    series.set(key, entry);
  }

  const spans = [...series.values()].map((entry) => entry.last - entry.first);
  const counts = [...series.values()].map((entry) => entry.count);
  const trackedSeries = counts.filter((count) => count > 1).length;
  const longestSpanMs = spans.length ? Math.max(...spans) : 0;

  // One bucket per UTC day, so a week of runs shows whether writing is
  // continuous or stopped on a particular day.
  const byDay = new Map();
  for (const row of usable) {
    const key = new Date(observedAt(row)).toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) || 0) + 1);
  }
  const daysCovered = byDay.size;
  const newestAt = usable.length ? Math.max(...usable.map(observedAt)) : null;
  const oldestAt = usable.length ? Math.min(...usable.map(observedAt)) : null;

  const failures = [];
  if (!usable.length) failures.push('no snapshots in the window');
  else {
    // A table of single-observation series is the flat-line failure: rows exist,
    // history does not.
    if (!trackedSeries) failures.push('every series has exactly one snapshot, so nothing is being tracked over time');
    if (longestSpanMs < HOUR) failures.push('longest tracked series spans under an hour');
    // Writing must be current. A week of history that stopped two days ago is
    // a stopped writer, not a healthy one.
    if (newestAt !== null && now - newestAt > 6 * HOUR) failures.push('newest snapshot is more than 6 hours old');
  }

  return {
    ok: failures.length === 0,
    failures,
    windowDays,
    evaluatedAt: new Date(now).toISOString(),
    rows: usable.length,
    rowsIgnored: (Array.isArray(rows) ? rows.length : 0) - usable.length,
    series: series.size,
    trackedSeries,
    singletonSeries: counts.filter((count) => count === 1).length,
    maxSnapshotsPerSeries: counts.length ? Math.max(...counts) : 0,
    medianSnapshotsPerSeries: median(counts),
    longestSpanMs,
    longestSpanHours: Number((longestSpanMs / HOUR).toFixed(2)),
    daysCovered,
    perDay: Object.fromEntries([...byDay.entries()].sort()),
    oldestAt: oldestAt === null ? null : new Date(oldestAt).toISOString(),
    newestAt: newestAt === null ? null : new Date(newestAt).toISOString(),
    // The week-long claim is only earned once observations actually span a week.
    provenForWindow: daysCovered >= windowDays && longestSpanMs >= (windowDays - 1) * DAY,
  };
}

/** One-screen summary for a terminal or a log line. */
export function formatLineHistoryReport(report) {
  const lines = [];
  lines.push(`Line history — ${report.ok ? 'HEALTHY' : 'FAILING'} (window ${report.windowDays}d, evaluated ${report.evaluatedAt})`);
  lines.push('');
  lines.push(`  snapshots            ${report.rows}${report.rowsIgnored ? ` (+${report.rowsIgnored} unusable)` : ''}`);
  lines.push(`  series               ${report.series}`);
  lines.push(`  tracked (>1 snap)    ${report.trackedSeries}`);
  lines.push(`  single-snapshot      ${report.singletonSeries}`);
  lines.push(`  snapshots/series     median ${report.medianSnapshotsPerSeries ?? 'n/a'}, max ${report.maxSnapshotsPerSeries}`);
  lines.push(`  longest span         ${report.longestSpanHours}h`);
  lines.push(`  days covered         ${report.daysCovered}/${report.windowDays}`);
  lines.push(`  oldest / newest      ${report.oldestAt ?? 'n/a'}  ..  ${report.newestAt ?? 'n/a'}`);
  if (Object.keys(report.perDay).length) {
    lines.push('');
    lines.push('  per day:');
    for (const [day, count] of Object.entries(report.perDay)) lines.push(`    ${day}  ${count}`);
  }
  if (!report.ok) {
    lines.push('');
    lines.push('  failing because:');
    for (const reason of report.failures) lines.push(`    - ${reason}`);
  }
  lines.push('');
  lines.push(`  week-long claim earned: ${report.provenForWindow ? 'YES' : 'not yet'}`);
  return lines.join('\n');
}
