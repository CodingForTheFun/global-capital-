import { chromium } from 'playwright';

const BASE = process.env.AUTOSCOUT_PUBLIC_URL || 'https://autoprop-live-production.up.railway.app';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth() {
  let last = null;
  for (let attempt = 1; attempt <= 18; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/api/health`, { cache: 'no-store' });
      const body = await response.json();
      if (response.ok && body?.ok === true && body?.service === 'autoscout-apex' && body?.theOddsApiConfigured === true) {
        return body;
      }
      last = `HTTP ${response.status} service=${body?.service || 'unknown'}`;
    } catch (error) {
      last = error?.message || String(error);
    }
    await sleep(10_000);
  }
  throw new Error(`Production health did not become ready: ${last || 'unknown error'}`);
}

function assertRealProp(row) {
  const requiredText = ['playerName', 'market', 'sportsbook', 'side'];
  for (const key of requiredText) {
    if (!String(row?.[key] || '').trim()) throw new Error(`Real prop missing ${key}`);
  }
  if (!['OVER', 'UNDER'].includes(row.side)) throw new Error(`Invalid prop side: ${row.side}`);
  if (!Number.isFinite(Number(row.line))) throw new Error('Real prop is missing a numeric line');
  if (!Number.isFinite(Number(row.price))) throw new Error('Real prop is missing sportsbook pricing');
  if (!row.providerUpdatedAt && !row.updatedAt) throw new Error('Real prop is missing provider timestamp');
  if (!row.ingestedAt) throw new Error('Real prop is missing Auto Scout ingestion timestamp');
}

async function verifyApi() {
  const sports = ['NFL', 'NBA', 'WNBA', 'MLB', 'NCAAF'];
  const results = [];
  let sample = null;
  for (const sport of sports) {
    const response = await fetch(`${BASE}/api/apex/props?sport=${encodeURIComponent(sport)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${sport} prop API returned HTTP ${response.status}`);
    const body = await response.json();
    results.push({
      sport,
      events: Number(body?.meta?.events || 0),
      markets: Array.isArray(body?.meta?.marketKeys) ? body.meta.marketKeys.length : 0,
      books: Number(body?.meta?.sportsbookCount || 0),
      lines: Number(body?.meta?.lineCount ?? body?.props?.length ?? 0),
      provider: body?.meta?.provider || null,
      cacheHit: body?.meta?.cacheHit === true,
    });
    if (!sample) sample = (body?.props || []).find((row) => row?.playerName && row?.sportsbook && Number.isFinite(Number(row?.line)) && Number.isFinite(Number(row?.price)) && ['OVER', 'UNDER'].includes(row?.side));
  }
  if (!sample) throw new Error('No supported sport exposed a complete real player prop through the public Auto Scout API');
  assertRealProp(sample);
  return { results, sample };
}

async function verifyBrowser() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const networkUrls = [];
    page.on('request', (request) => networkUrls.push(request.url()));
    const response = await page.goto(`${BASE}/apex`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (!response?.ok()) throw new Error(`Public /apex returned HTTP ${response?.status() || 'unknown'}`);
    await page.waitForSelector('.apx2Card', { timeout: 60_000 });
    const cardCount = await page.locator('.apx2Card').count();
    if (cardCount < 1) throw new Error('No visible prop card rendered in the production browser');
    const firstCard = (await page.locator('.apx2Card').first().innerText()).trim();
    if (!firstCard) throw new Error('First production prop card rendered with no content');
    if (networkUrls.some((url) => /apiKey=|THE_ODDS_API_KEY/i.test(url))) throw new Error('Provider credential appeared in browser network URLs');
    return { cardCount, firstCardPreview: firstCard.split('\n').slice(0, 6).join(' | ') };
  } finally {
    await browser.close();
  }
}

const health = await waitForHealth();
const api = await verifyApi();
const browser = await verifyBrowser();

console.log(JSON.stringify({
  ok: true,
  health: { service: health.service, provider: health.preferredProvider, supportedSports: health.supportedSports },
  sports: api.results,
  sample: {
    player: api.sample.playerName,
    market: api.sample.market,
    sportsbook: api.sample.sportsbook,
    side: api.sample.side,
    line: api.sample.line,
    price: api.sample.price,
    providerUpdatedAt: api.sample.providerUpdatedAt || api.sample.updatedAt,
    ingestedAt: api.sample.ingestedAt,
  },
  browser,
}, null, 2));
