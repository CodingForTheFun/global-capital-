/**
 * Pure checks for the hourly site QA run (scripts/site-qa/run.mjs).
 *
 * Every function takes plain data and returns findings; nothing here touches
 * the network or a browser, so tests/site-qa.test.mjs can drive each failure
 * kind with fixtures. A finding is { id, severity, area, message } where `id`
 * is stable across runs so the same break is reported once, not hourly.
 */

import { bookInfo } from '../../lib/constants/books.mjs';

export const STALE_PROP_MINUTES = 30;
export const DEDUPE_HOURS = 6;
const MAX_AMERICAN_ODDS = 10000;

const finding = (id, severity, area, message) => ({ id, severity, area, message });

/** Health endpoint: up, configured, and serving the commit that was merged. */
export function checkHealth(body, { expectedRevision = '' } = {}) {
  const out = [];
  if (!body || body.ok !== true) {
    out.push(finding('health:down', 'critical', 'health', '/api/health is not ok'));
    return out;
  }
  if (body.provider?.configured !== true) {
    out.push(finding('health:provider', 'critical', 'health', 'Props provider is not configured'));
  }
  if (expectedRevision && body.revision && body.revision !== expectedRevision) {
    out.push(finding(
      'health:revision',
      'high',
      'deploy',
      `Live revision ${String(body.revision).slice(0, 12)} is not the production-stable head ${expectedRevision.slice(0, 12)}; a deploy may be blocked or failed`,
    ));
  }
  return out;
}

/** News feed: articles present and every photo served through the same-origin relay. */
export function checkNews(body) {
  const articles = Array.isArray(body?.articles) ? body.articles : [];
  if (!articles.length) return [finding('news:empty', 'high', 'news', 'The news feed returned no articles')];
  const external = articles.filter((row) => row.imageUrl && !String(row.imageUrl).startsWith('/api/news/image?u='));
  return external.length
    ? [finding('news:external-images', 'high', 'news', `${external.length} news photos point off-site, which the CSP blocks`)]
    : [];
}

function americanOdds(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Props feed sanity. DFS and sweepstakes rows (PrizePicks, Underdog…) carry
 * no price by design; a sportsbook row with price 0 is the bug that printed
 * "0" as odds. Book types come from lib/constants/books.mjs.
 */
export function checkProps(sport, rows, { now = Date.now() } = {}) {
  const out = [];
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    out.push(finding(`props:${sport}:empty`, 'high', 'props', `${sport} board returned no props`));
    return out;
  }
  const isDfs = (row) => bookInfo(row.sportsbookKey || row.sportsbook).type !== 'sportsbook';

  const badLine = list.filter((row) => !Number.isFinite(Number(row.line)));
  if (badLine.length) out.push(finding(`props:${sport}:line`, 'high', 'props', `${badLine.length} ${sport} props have no numeric line`));

  const zeroPrice = list.filter((row) => !isDfs(row) && americanOdds(row.price) === 0);
  if (zeroPrice.length) out.push(finding(`props:${sport}:zero-price`, 'high', 'props', `${zeroPrice.length} ${sport} sportsbook props carry a price of 0`));

  const wildPrice = list.filter((row) => {
    const price = americanOdds(row.price);
    return price !== null && price !== 0 && Math.abs(price) > MAX_AMERICAN_ODDS;
  });
  if (wildPrice.length) out.push(finding(`props:${sport}:wild-price`, 'medium', 'props', `${wildPrice.length} ${sport} props have odds beyond ±${MAX_AMERICAN_ODDS}`));

  const newest = Math.max(...list.map((row) => Date.parse(row.providerUpdatedAt || row.updatedAt || '') || 0));
  if (!newest) {
    out.push(finding(`props:${sport}:no-timestamp`, 'medium', 'props', `${sport} props carry no update time`));
  } else if (now - newest > STALE_PROP_MINUTES * 60_000) {
    out.push(finding(
      `props:${sport}:stale`,
      'high',
      'props',
      `${sport} props were last updated ${Math.round((now - newest) / 60_000)} minutes ago`,
    ));
  }

  // The same quote twice is what renders as a duplicate player card.
  const seen = new Map();
  for (const row of list) {
    const key = [row.eventId, row.playerName, row.market, row.period, row.line, row.side, row.sportsbookKey || row.sportsbook]
      .map((part) => String(part ?? '').toLowerCase())
      .join('|');
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  const duplicates = [...seen.values()].filter((count) => count > 1).length;
  if (duplicates) out.push(finding(`props:${sport}:duplicates`, 'medium', 'props', `${duplicates} ${sport} quotes appear more than once`));

  return out;
}

/** Browser measurements for one page at one viewport (see run.mjs). */
export function checkPage(page) {
  const where = `${page.path} @${page.width}px`;
  const key = `page:${page.path}:${page.width}`;
  const out = [];
  if (page.status && page.status >= 400) out.push(finding(`${key}:status`, 'critical', 'page', `${where} returned HTTP ${page.status}`));
  if (page.errors?.length) out.push(finding(`${key}:errors`, 'high', 'page', `${where} threw: ${page.errors[0]}`));
  if (page.overflowX > 1) out.push(finding(`${key}:overflow`, 'medium', 'layout', `${where} scrolls sideways by ${page.overflowX}px`));
  if (!page.headerVisible) out.push(finding(`${key}:header`, 'medium', 'layout', `${where} has no visible header`));
  if (page.width < 1024 && page.navRows !== 1) out.push(finding(`${key}:dock`, 'medium', 'layout', `${where} phone nav wraps onto ${page.navRows} rows`));
  if (!page.fontsLoaded) out.push(finding(`${key}:fonts`, 'medium', 'layout', `${where} fell back from the brand fonts`));
  if (page.brokenImages > 0) out.push(finding(`${key}:images`, 'medium', 'content', `${where} shows ${page.brokenImages} broken images`));
  if (page.cspViolations?.length) out.push(finding(`${key}:csp`, 'high', 'security', `${where} hit ${page.cspViolations.length} CSP violations: ${page.cspViolations[0]}`));
  return out;
}

/**
 * Only alert on findings that are new, or last alerted longer ago than the
 * dedupe window. Returns the findings to alert on and the state to persist.
 */
export function dedupe(findings, previousState = {}, { now = Date.now(), hours = DEDUPE_HOURS } = {}) {
  const state = {};
  const fresh = [];
  for (const item of findings) {
    const last = Number(previousState[item.id]) || 0;
    if (!last || now - last >= hours * 3_600_000) {
      fresh.push(item);
      state[item.id] = now;
    } else {
      state[item.id] = last;
    }
  }
  // Anything no longer failing drops out of state, so a recurrence alerts again.
  return { fresh, state };
}

export function summarize(findings, { skipped = [] } = {}) {
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...findings].sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
  const lines = ['## Site QA', ''];
  lines.push(sorted.length ? `**${sorted.length} problem${sorted.length === 1 ? '' : 's'} found**` : '**All checks passed**');
  for (const item of sorted) lines.push(`- \`${item.severity}\` ${item.message}`);
  if (skipped.length) {
    lines.push('', '**Skipped**');
    for (const reason of skipped) lines.push(`- ${reason}`);
  }
  return lines.join('\n');
}
