import { chromium } from 'playwright';

const BASE = process.env.AUTOSCOUT_PUBLIC_URL || 'https://autoprop-live-production.up.railway.app';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth() {
  let last = null;
  for (let attempt = 1; attempt <= 18; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/api/health`, { cache: 'no-store' });
      const body = await response.json();
      if (response.ok && body?.ok === true && body?.service === 'autoscout-apex' && body?.provider?.configured === true) return body;
      last = `HTTP ${response.status} service=${body?.service || 'unknown'}`;
    } catch (error) {
      last = error?.message || String(error);
    }
    await sleep(10_000);
  }
  throw new Error(`Production health did not become ready: ${last || 'unknown error'}`);
}

function assertRealProp(row) {
  for (const key of ['playerName', 'market', 'sportsbook', 'side']) {
    if (!String(row?.[key] || '').trim()) throw new Error(`Real prop missing ${key}`);
  }
  if (!['OVER', 'UNDER'].includes(row.side)) throw new Error(`Invalid prop side: ${row.side}`);
  if (!Number.isFinite(Number(row.line))) throw new Error('Real prop is missing a numeric line');
  if (!Number.isFinite(Number(row.price))) throw new Error('Real prop is missing sportsbook pricing');
  if (!row.providerUpdatedAt && !row.updatedAt) throw new Error('Real prop is missing provider timestamp');
  if (!row.ingestedAt) throw new Error('Real prop is missing Auto Scout ingestion timestamp');
  if (!row.autoScout || !Array.isArray(row.autoScout.checks) || row.autoScout.checks.length < 1) throw new Error('Real prop is missing the auditable Auto Scout rule result');
  if (!['QUALIFIED', 'REJECTED', 'UNAVAILABLE'].includes(row.autoScout.classification)) throw new Error(`Invalid Auto Scout classification: ${row.autoScout.classification}`);
  for (const check of row.autoScout.checks) {
    if (!['PASS', 'FAIL', 'UNAVAILABLE'].includes(check.status)) throw new Error(`Invalid rule status: ${check.status}`);
  }
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
      ruleAudit: Boolean(body?.props?.[0]?.autoScout?.checks?.length),
      databaseConfigured: body?.persistence?.configured === true,
    });
    if (!sample) sample = (body?.props || []).find((row) => row?.playerName && row?.sportsbook && Number.isFinite(Number(row?.line)) && Number.isFinite(Number(row?.price)) && ['OVER', 'UNDER'].includes(row?.side));
  }
  if (!sample) throw new Error('No supported sport exposed a complete real player prop through the public Auto Scout API');
  assertRealProp(sample);

  const researchUrl = new URL(`${BASE}/api/apex/research`);
  researchUrl.searchParams.set('sport', sample.sport || 'NFL');
  researchUrl.searchParams.set('playerName', sample.playerName);
  researchUrl.searchParams.set('market', sample.market);
  researchUrl.searchParams.set('line', String(sample.line));
  researchUrl.searchParams.set('side', sample.side);
  researchUrl.searchParams.set('team', sample.team || '');
  researchUrl.searchParams.set('homeTeam', sample.homeTeam || '');
  researchUrl.searchParams.set('awayTeam', sample.awayTeam || '');
  researchUrl.searchParams.set('games', '20');
  const researchResponse = await fetch(researchUrl, { cache: 'no-store' });
  if (!researchResponse.ok) throw new Error(`Research API returned HTTP ${researchResponse.status}`);
  const research = await researchResponse.json();
  if (research?.ok !== true) throw new Error(`Research API returned an unsafe failure shape: ${research?.code || 'unknown'}`);
  if (research.available === true) {
    if (!Array.isArray(research.gameLog) || !research.gameLog.length) throw new Error('Available research response is missing game-log rows');
    if (!research.windows || typeof research.windows !== 'object') throw new Error('Available research response is missing rolling windows');
  } else if (!String(research?.code || research?.message || '').trim()) {
    throw new Error('Unavailable research response did not explain why data is unavailable');
  }

  return { results, sample, research };
}

async function verifyBrowser() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const networkUrls = [];
    page.on('request', (request) => networkUrls.push(request.url()));
    const response = await page.goto(`${BASE}/apex`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (!response?.ok()) throw new Error(`Public /apex returned HTTP ${response?.status() || 'unknown'}`);

    await page.waitForSelector('#as5', { timeout: 60_000 });
    await page.waitForSelector('.asRow', { timeout: 60_000 });
    const cardCount = await page.locator('.asRow').count();
    if (cardCount < 1) throw new Error('No visible v5 research prop row rendered in production');

    for (const selector of ['#asSports', '#asSearch', '#asMarket', '#asBook', '#asSide', '#asSort', '#asSummary', '#asList', '.asHeaderRow', '.asBookRail', '.asAvatar img', '.asResearchState']) {
      if (await page.locator(selector).count() < 1) throw new Error(`Auto Scout v5 control or data surface missing in production: ${selector}`);
    }

    const headerText = (await page.locator('.asHeaderRow').innerText()).trim();
    for (const label of ['Projection', 'L5', 'L10', 'L15', 'Season', 'H2H', 'Average', 'Books']) {
      if (!headerText.toLowerCase().includes(label.toLowerCase())) throw new Error(`Research column missing from v5 desktop table: ${label}`);
    }

    const firstCard = (await page.locator('.asRow').first().innerText()).trim();
    if (!firstCard) throw new Error('First production research row rendered with no content');
    if (!/OVER|UNDER/i.test(firstCard)) throw new Error('Production research row is missing its selected side');

    const avatarSources = await page.locator('.asAvatar img').evaluateAll((nodes) => nodes.slice(0, 10).map((node) => node.getAttribute('src')).filter(Boolean));
    let artworkResponses = 0;
    for (const src of avatarSources) {
      const artwork = await fetch(new URL(src, BASE), { cache: 'no-store' });
      if (artwork.ok && String(artwork.headers.get('content-type') || '').toLowerCase().startsWith('image/')) artworkResponses += 1;
    }
    if (artworkResponses < 1) throw new Error('Player artwork endpoint did not return a usable image response');

    await page.locator('.asRow').first().click();
    await page.waitForSelector('#asDrawerBg.on', { timeout: 10_000 });
    await page.waitForSelector('#asDrawerBody', { timeout: 10_000 });
    await page.waitForFunction(() => {
      const body = document.querySelector('#asDrawerBody');
      if (!body) return false;
      return Boolean(body.querySelector('.asSection') || body.querySelector('.asError'));
    }, null, { timeout: 30_000 });

    const drawerText = (await page.locator('#asDrawerBody').innerText()).trim();
    if (!drawerText) throw new Error('Research drawer rendered with no content');
    const hasResearchControls = await page.locator('#asMarketSwitch, #asLineMinus, #asLinePlus').count() >= 1;
    const hasAvailabilityMessage = /research availability|historical research|game logs/i.test(drawerText);
    if (hasResearchControls) {
      for (const side of ['OVER', 'UNDER']) {
        if (await page.getByRole('button', { name: side, exact: true }).count() < 1) throw new Error('Research controls are missing side: ' + side);
      }
    }
    if (!hasResearchControls && !hasAvailabilityMessage) throw new Error('Research drawer exposes neither research controls nor an honest availability state');

    if (networkUrls.some((url) => /apiKey=|THE_ODDS_API_KEY|CLEARSPORTS_API_KEY|SPORTSDATAIO_API_KEY/i.test(url))) {
      throw new Error('Provider credential appeared in browser network URLs');
    }

    return {
      cardCount,
      firstCardPreview: firstCard.split('\n').slice(0, 14).join(' | '),
      researchDrawerVerified: true,
      researchControlsAvailable: hasResearchControls,
      avatarResponsesVerified: artworkResponses,
    };
  } finally {
    await browser.close();
  }
}

const health = await waitForHealth();
const api = await verifyApi();
const browser = await verifyBrowser();

console.log(JSON.stringify({
  ok: true,
  phase: 'Auto Scout v5 prop research',
  health: {
    service: health.service,
    provider: health.provider?.id,
    supportedSports: health.supportedSports,
    databaseConfigured: health?.persistence?.configured === true,
  },
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
    autoScoutClassification: api.sample.autoScout?.classification || null,
  },
  research: {
    available: api.research.available === true,
    source: api.research.source || null,
    code: api.research.code || null,
    gamesReturned: Number(api.research?.coverage?.gamesReturned || api.research?.gameLog?.length || 0),
  },
  browser,
}, null, 2));
