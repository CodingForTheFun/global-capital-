// Pure coverage planning. No provider credentials, HTTP, timers, or UI state.
export const COVERAGE_VERSION = 2;
export const PRIORITY_BOOKS = Object.freeze(['prizepicks', 'underdog']);
const text = value => String(value ?? '').trim().toLowerCase();

export function marketCatalog(bookmakers, accepts) {
  const map = new Map();
  for (const book of bookmakers || []) {
    const priority = PRIORITY_BOOKS.includes(text(book?.key));
    // A duplicated market from one bookmaker is not extra coverage.
    const keys = new Set((book?.markets || []).map(m => text(m?.key)).filter(accepts));
    for (const key of keys) {
      const row = map.get(key) || { key, books: 0, priority: false };
      row.books += 1;
      row.priority ||= priority;
      map.set(key, row);
    }
  }
  return [...map.values()].sort((a, b) => Number(b.priority) - Number(a.priority) || b.books - a.books || a.key.localeCompare(b.key));
}

// Allocate scarce market slots across games, DFS markets first. One busy game
// cannot consume the entire refresh before the remaining games get a turn.
export function allocateMarkets(catalogs, { credits, billedRegions = 1, maxPerEvent = 100 }) {
  let slots = Math.max(0, Math.floor(credits / Math.max(1, billedRegions)));
  const selected = catalogs.map(() => []);
  const eligible = catalogs.map(rows => rows.slice(0, maxPerEvent));
  for (const priority of [true, false]) {
    const queues = eligible.map(rows => rows.filter(row => row.priority === priority));
    let progress = true;
    while (slots > 0 && progress) {
      progress = false;
      for (let i = 0; i < queues.length && slots > 0; i += 1) {
        const next = queues[i].shift();
        if (!next) continue;
        selected[i].push(next.key);
        slots -= 1;
        progress = true;
      }
    }
  }
  return selected;
}

// Shared by simultaneous sport refreshes in this process. Reservations are
// conservative: failures still consume the local estimate, never retry/spin.
export function createCreditLedger(readRemaining) {
  let pending = 0;
  return function refreshBudget(limit) {
    let committed = 0;
    const available = () => {
      const value = readRemaining();
      const remaining = value === null || value === undefined || value === '' ? Infinity : Number(value);
      const quota = Number.isFinite(remaining) ? Math.max(0, remaining - pending) : Infinity;
      return Math.max(0, Math.min(limit - committed, quota));
    };
    return {
      available,
      get committed() { return committed; },
      async run(cost, operation) {
        if (!Number.isFinite(cost) || cost < 0 || cost > available()) {
          throw Object.assign(new Error('Board coverage budget reached.'), { code: 'COVERAGE_BUDGET' });
        }
        committed += cost;
        pending += cost;
        try { return await operation(); }
        finally { pending -= cost; }
      },
    };
  };
}

export function summarizeCoverage({ availableEvents, catalogResults, results, lines, scope, fetchedAt }) {
  const reasons = new Set();
  if (availableEvents > catalogResults.length) reasons.add('event_limit');
  let checkedEvents = 0, discoveredMarketCount = 0, requestedMarketCount = 0;
  for (let i = 0; i < catalogResults.length; i += 1) {
    const discovery = catalogResults[i];
    const result = results[i];
    discoveredMarketCount += discovery.catalog.length;
    requestedMarketCount += result.marketKeys.length;
    if (discovery.error || result.error) reasons.add(discovery.error === 'COVERAGE_BUDGET' || result.error === 'COVERAGE_BUDGET' ? 'coverage_limit' : 'request_failed');
    if (result.marketKeys.length < discovery.catalog.length) reasons.add('market_limit');
    if (!discovery.error && !result.error && result.marketKeys.length === discovery.catalog.length) checkedEvents += 1;
  }
  const complete = reasons.size === 0;
  const platforms = Object.fromEntries(PRIORITY_BOOKS.map(bookmakerKey => {
    const rows = lines.filter(line => line.bookmakerKey === bookmakerKey);
    const times = rows.map(line => line.providerUpdatedAt).filter(value => value && Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(a) - Date.parse(b));
    const requested = scope.bookmakers.includes(bookmakerKey) || scope.regions.includes('us_dfs');
    return [bookmakerKey, {
      requested,
      status: !requested ? 'not_requested' : rows.length ? 'available' : complete ? 'no_lines_returned' : 'incomplete',
      lineCount: rows.length,
      propCount: new Set(rows.map(line => line.propId)).size,
      oldestUpdate: times[0] || null,
      newestUpdate: times.at(-1) || null,
    }];
  }));
  return {
    version: COVERAGE_VERSION,
    // This is coverage of the provider's returned event/market catalog, not a
    // claim to mirror every selection on the consumer apps.
    scope: 'provider-listed events and supported over/under markets',
    availableEvents, checkedEvents, discoveredMarketCount, requestedMarketCount,
    complete, reasons: [...reasons], checkedAt: fetchedAt, platforms,
  };
}

export function coverageWarning(coverage) {
  const labels = { prizepicks: 'PrizePicks', underdog: 'Underdog' };
  const parts = [];
  if (!coverage.complete) parts.push(`Partial board coverage: ${coverage.checkedEvents} of ${coverage.availableEvents} listed games fully checked.`);
  for (const key of PRIORITY_BOOKS) {
    const p = coverage.platforms[key];
    if (!p.requested) parts.push(`${labels[key]} is not included in this board's configured sources.`);
    else if (!p.lineCount) parts.push(`${labels[key]}: ${coverage.complete ? 'no regular lines returned for these games' : 'coverage incomplete; no regular lines loaded'}.`);
  }
  return parts.join(' ') || null;
}
