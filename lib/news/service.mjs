const CACHE_TTL_MS = 5 * 60_000;
const FORCE_FLOOR_MS = 60_000;
const STALE_FALLBACK_MS = 30 * 60_000;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_ITEMS_PER_FEED = 30;

const feed = (id, publisher, sport, url, hosts, attribution) => Object.freeze({ id, publisher, sport, url, hosts, attribution });

export const NEWS_SOURCES = Object.freeze([
  feed('espn-top', 'ESPN', 'ALL', 'https://www.espn.com/espn/rss/news', ['espn.com'], 'Provided by ESPN'),
  feed('espn-nfl', 'ESPN', 'NFL', 'https://www.espn.com/espn/rss/nfl/news', ['espn.com'], 'Provided by ESPN'),
  feed('espn-nba', 'ESPN', 'NBA', 'https://www.espn.com/espn/rss/nba/news', ['espn.com'], 'Provided by ESPN'),
  feed('espn-mlb', 'ESPN', 'MLB', 'https://www.espn.com/espn/rss/mlb/news', ['espn.com'], 'Provided by ESPN'),
  feed('espn-nhl', 'ESPN', 'NHL', 'https://www.espn.com/espn/rss/nhl/news', ['espn.com'], 'Provided by ESPN'),
  feed('espn-soccer', 'ESPN', 'SOCCER', 'https://www.espn.com/espn/rss/soccer/news', ['espn.com'], 'Provided by ESPN'),
  feed('espn-tennis', 'ESPN', 'TENNIS', 'https://www.espn.com/espn/rss/tennis/news', ['espn.com'], 'Provided by ESPN'),
  feed('espn-ncaaf', 'ESPN', 'NCAAF', 'https://www.espn.com/espn/rss/ncf/news', ['espn.com'], 'Provided by ESPN'),
  feed('espn-ncaab', 'ESPN', 'NCAAB', 'https://www.espn.com/espn/rss/ncb/news', ['espn.com'], 'Provided by ESPN'),
  feed('cbs-top', 'CBS Sports', 'ALL', 'https://www.cbssports.com/rss/headlines/', ['cbssports.com'], 'CBS Sports'),
  feed('cbs-nfl', 'CBS Sports', 'NFL', 'https://www.cbssports.com/rss/headlines/nfl', ['cbssports.com'], 'CBS Sports'),
  feed('cbs-nba', 'CBS Sports', 'NBA', 'https://www.cbssports.com/rss/headlines/nba', ['cbssports.com'], 'CBS Sports'),
  feed('cbs-mlb', 'CBS Sports', 'MLB', 'https://www.cbssports.com/rss/headlines/mlb', ['cbssports.com'], 'CBS Sports'),
  feed('cbs-nhl', 'CBS Sports', 'NHL', 'https://www.cbssports.com/rss/headlines/nhl', ['cbssports.com'], 'CBS Sports'),
  feed('cbs-soccer', 'CBS Sports', 'SOCCER', 'https://www.cbssports.com/rss/headlines/soccer', ['cbssports.com'], 'CBS Sports'),
  feed('cbs-tennis', 'CBS Sports', 'TENNIS', 'https://www.cbssports.com/rss/headlines/tennis', ['cbssports.com'], 'CBS Sports'),
  feed('cbs-ncaaf', 'CBS Sports', 'NCAAF', 'https://www.cbssports.com/rss/headlines/college-football', ['cbssports.com'], 'CBS Sports'),
  feed('cbs-ncaab', 'CBS Sports', 'NCAAB', 'https://www.cbssports.com/rss/headlines/college-basketball', ['cbssports.com'], 'CBS Sports'),
  feed('cbs-golf', 'CBS Sports', 'GOLF', 'https://www.cbssports.com/rss/headlines/golf', ['cbssports.com'], 'CBS Sports'),
  feed('cbs-boxing', 'CBS Sports', 'BOXING', 'https://www.cbssports.com/rss/headlines/boxing', ['cbssports.com'], 'CBS Sports'),
  feed('cbs-mma', 'CBS Sports', 'MMA', 'https://www.cbssports.com/rss/headlines/mma', ['cbssports.com'], 'CBS Sports'),
]);

const state = { payload: null, expiresAt: 0, fetchedAtMs: 0, lastStartedAt: 0, inflight: null };

function decodeXml(value = '') {
  return String(value)
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/i, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .trim();
}

function tagValue(block, tag) {
  const escaped = String(tag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(block).match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function itemLink(block) {
  const plain = tagValue(block, 'link');
  if (plain) return plain;
  const atom = String(block).match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?\s*>/i);
  return atom ? decodeXml(atom[1]) : '';
}

function safeArticleUrl(raw, source) {
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!source.hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function publishedDate(block) {
  for (const tag of ['pubDate', 'published', 'updated', 'dc:date']) {
    const raw = tagValue(block, tag);
    if (!raw) continue;
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return null;
}

export function classifyNewsTitle(title = '') {
  const value = String(title).toLowerCase();
  if (/\b(rumou?r|linked with|linked to|interest in|eyeing|could pursue)\b/.test(value)) return 'RUMOR';
  if (/\b(injur|injured|ruled out|questionable|doubtful|concussion|injured reserve|placed on ir|\bir\b|\bil\b|surgery|torn|sprain|strain|hamstring|acl|mcl|day-to-day)\b/.test(value)) return 'INJURY';
  if (/\b(trade|traded|trades|acquire|acquires|acquired|dealt)\b/.test(value)) return 'TRADE';
  if (/\b(re-sign|re-signed|re-signs|signing|signs|signed|contract extension|agrees to (?:a )?deal|agreed to (?:a )?deal)\b/.test(value)) return 'SIGNING';
  if (/\b(waived|released|claimed|activated|optioned|recalled|designated for assignment|suspended|transaction)\b/.test(value)) return 'TRANSACTION';
  if (/^(sources?|report):|\bsources say\b|\breportedly\b/.test(value)) return 'REPORT';
  return 'NEWS';
}

function inferSport(title, fallback) {
  if (fallback !== 'ALL') return fallback;
  const value = String(title).toUpperCase();
  for (const sport of ['WNBA', 'NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'UFC', 'MMA']) {
    if (new RegExp(`\\b${sport}\\b`).test(value)) return sport === 'UFC' ? 'MMA' : sport;
  }
  if (/\b(PREMIER LEAGUE|CHAMPIONS LEAGUE|MLS|NWSL|SOCCER)\b/.test(value)) return 'SOCCER';
  if (/\b(TENNIS|ATP|WTA|US OPEN|WIMBLEDON|ROLAND GARROS)\b/.test(value)) return 'TENNIS';
  return 'ALL';
}

export function parseFeedItems(xml, source, { limit = MAX_ITEMS_PER_FEED } = {}) {
  const body = String(xml || '');
  const rss = [...body.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  const atom = rss.length ? [] : [...body.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].map((match) => match[1]);
  const blocks = rss.length ? rss : atom;
  const items = [];
  for (const block of blocks.slice(0, Math.max(1, limit))) {
    const title = tagValue(block, 'title');
    const link = safeArticleUrl(itemLink(block), source);
    if (!title || !link) continue;
    items.push({
      id: `${source.id}:${Buffer.from(link).toString('base64url').slice(0, 64)}`,
      title,
      url: link,
      publisher: source.publisher,
      attribution: source.attribution,
      sourceId: source.id,
      sport: inferSport(title, source.sport),
      category: classifyNewsTitle(title),
      publishedAt: publishedDate(block),
    });
  }
  return items;
}

async function fetchSource(source, { fetchImpl = (...args) => fetch(...args) } = {}) {
  const started = Date.now();
  try {
    const response = await fetchImpl(source.url, {
      redirect: 'follow',
      headers: {
        accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.2',
        'user-agent': 'ObligeProps/1.0 (+https://www.obligeprops.com; sports-news-aggregator)',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, source, status: response.status, items: [], latencyMs: Date.now() - started };
    const xml = await response.text();
    const items = parseFeedItems(xml, source);
    return { ok: true, source, status: response.status, items, latencyMs: Date.now() - started };
  } catch {
    return { ok: false, source, status: 0, items: [], latencyMs: Date.now() - started };
  }
}

function itemTime(item) {
  const ms = item.publishedAt ? Date.parse(item.publishedAt) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeTitle(title) {
  return String(title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function buildPayload(results, now = Date.now()) {
  const sourceStatus = results.map((result) => ({
    id: result.source.id,
    publisher: result.source.publisher,
    sport: result.source.sport,
    ok: result.ok,
    status: result.status,
    itemCount: result.items.length,
    latencyMs: result.latencyMs,
  }));
  const seenUrl = new Set();
  const seenExact = new Set();
  const items = [];
  for (const result of results) {
    for (const item of result.items) {
      const titleKey = `${item.publisher}:${normalizeTitle(item.title)}`;
      if (seenUrl.has(item.url) || seenExact.has(titleKey)) continue;
      seenUrl.add(item.url);
      seenExact.add(titleKey);
      items.push(item);
    }
  }
  items.sort((a, b) => itemTime(b) - itemTime(a) || a.title.localeCompare(b.title));
  return {
    ok: sourceStatus.some((row) => row.ok),
    fetchedAt: new Date(now).toISOString(),
    items,
    sourceStatus,
  };
}

async function refresh(options = {}) {
  if (state.inflight) return state.inflight;
  state.lastStartedAt = Date.now();
  state.inflight = (async () => {
    const results = await Promise.all(NEWS_SOURCES.map((source) => fetchSource(source, options)));
    const next = buildPayload(results);
    const hadAny = next.items.length > 0;
    if (hadAny || !state.payload || Date.now() - state.fetchedAtMs > STALE_FALLBACK_MS) {
      state.payload = next;
      state.fetchedAtMs = Date.now();
    } else {
      state.payload = { ...state.payload, stale: true, sourceStatus: next.sourceStatus, refreshFailedAt: next.fetchedAt };
    }
    state.expiresAt = Date.now() + CACHE_TTL_MS;
    return state.payload;
  })().finally(() => { state.inflight = null; });
  return state.inflight;
}

function selectedSet(values = []) {
  return new Set((Array.isArray(values) ? values : []).map((value) => String(value).trim().toUpperCase()).filter(Boolean));
}

function filteredPayload(payload, { sports = [], categories = [], publishers = [], limit = 180, sinceHours = 72 } = {}) {
  const sportSet = selectedSet(sports);
  const categorySet = selectedSet(categories);
  const publisherSet = new Set((Array.isArray(publishers) ? publishers : []).map((value) => String(value).trim().toLowerCase()).filter(Boolean));
  const cutoff = Date.now() - Math.min(168, Math.max(1, Number(sinceHours) || 72)) * 3_600_000;
  let items = payload.items.filter((item) => {
    if (sportSet.size && !sportSet.has(item.sport)) return false;
    if (categorySet.size && !categorySet.has(item.category)) return false;
    if (publisherSet.size && !publisherSet.has(item.publisher.toLowerCase())) return false;
    const ms = item.publishedAt ? Date.parse(item.publishedAt) : NaN;
    return !Number.isFinite(ms) || ms >= cutoff;
  });
  items = items.slice(0, Math.min(250, Math.max(1, Number(limit) || 180)));
  const counts = { total: items.length, bySport: {}, byCategory: {}, byPublisher: {} };
  for (const item of items) {
    counts.bySport[item.sport] = (counts.bySport[item.sport] || 0) + 1;
    counts.byCategory[item.category] = (counts.byCategory[item.category] || 0) + 1;
    counts.byPublisher[item.publisher] = (counts.byPublisher[item.publisher] || 0) + 1;
  }
  return { ...payload, items, counts };
}

export const newsService = Object.freeze({
  async snapshot(filters = {}, options = {}) {
    const now = Date.now();
    const force = Boolean(filters.force) && now - state.lastStartedAt >= FORCE_FLOOR_MS;
    const payload = !state.payload || state.expiresAt <= now || force ? await refresh(options) : state.payload;
    return filteredPayload(payload, filters);
  },
  health() {
    return {
      cached: Boolean(state.payload),
      fetchedAt: state.payload?.fetchedAt || null,
      sourceCount: NEWS_SOURCES.length,
      publishers: [...new Set(NEWS_SOURCES.map((source) => source.publisher))],
    };
  },
});
