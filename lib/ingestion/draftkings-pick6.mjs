import { http2JsonFetch } from './http2-json-fetch.mjs';
import { record } from './normalize.mjs';

const LIST_URL = 'https://api.draftkings.com/sites/US-PSX/pick6/v1/pickgroups/main?showLive=false&appname=psxandroid&version=253542100&format=json';
const LEAGUE_URL = key => `https://api.draftkings.com/sites/US-PSX/pick6/v1/pickgroups/identifier?pillIdentifier=${encodeURIComponent(key)}&appname=psxandroid&version=260861600&format=json`;
const MARKET_URL = (groupId, categoryId = null) => {
  const url = new URL(`https://api.draftkings.com/sites/US-PSX/pick6/v1/pickgroups/${encodeURIComponent(groupId)}/category/pickcards`);
  if (categoryId != null) url.searchParams.set('pickCategoryId', String(categoryId));
  url.searchParams.set('appname','psxandroid');
  url.searchParams.set('version','260861600');
  url.searchParams.set('format','json');
  return url.href;
};
const text = value => value == null ? '' : String(value).trim();
const list = value => Array.isArray(value) ? value : [];
const number = value => Number.isFinite(Number(value)) ? Number(value) : null;
const SUPPORTED = new Set(['NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB','TENNIS']);
const UA_HEADERS = Object.freeze({
  'user-agent':'DraftKings/260861600 okhttp/4.12.0',
  accept:'application/json',
});

function sportKey(value) {
  const s = text(value).toUpperCase().replace(/[^A-Z0-9]/g,'');
  if (s.includes('WNBA')) return 'WNBA';
  if (s.includes('NCAAF') || s.includes('COLLEGEFOOTBALL') || s === 'CFB') return 'NCAAF';
  if (s.includes('NCAAB') || s.includes('COLLEGEBASKETBALL') || s.includes('MENS COLLEGEBASKETBALL') || s === 'CBB') return 'NCAAB';
  if (s.includes('TENNIS') || s.startsWith('ATP') || s.startsWith('WTA')) return 'TENNIS';
  if (s.includes('NFL')) return 'NFL';
  if (s.includes('NBA')) return 'NBA';
  if (s.includes('NHL')) return 'NHL';
  if (s.includes('MLB')) return 'MLB';
  return null;
}

function fullTeam(team) {
  if (!team) return '';
  const city = text(team.city), name = text(team.name);
  return city ? `${city} ${name}`.trim() : name;
}

function leagueMapping(payload) {
  const byCompetition = new Map();
  const groupId = text(payload?.mainPickGroupId);
  let leagueMeta = null;
  for (const group of list(payload?.pickGroups)) {
    for (const league of list(group?.leagues)) { if (!leagueMeta) leagueMeta = league; }
  }
  for (const competition of list(payload?.competitions)) {
    const id = text(competition?.competitionId);
    if (!id) continue;
    byCompetition.set(id, {
      ...(leagueMeta || {}),
      homeTeam: competition?.homeTeam || null,
      awayTeam: competition?.awayTeam || null,
      startTime: competition?.startTime || null,
      matchup: competition?.matchupDisplay || '',
    });
  }
  return { groupId, byCompetition };
}

function normalizeMarketDocument(payload, mapping, requestedSport) {
  const playerInfo = payload?.entityInfoByDkId || {};
  const markets = payload?.pickSixMarketById || {};
  const competitions = payload?.competitionById || {};
  const grouped = new Map();

  for (const pickable of Object.values(payload?.pickCardByPickableId || {})) {
    const entity = list(pickable?.entities)[0];
    if (!entity) continue;
    const competitionId = text(list(entity?.compIds)[0]);
    const game = mapping.byCompetition.get(competitionId);
    if (!game || !game.startTime) continue;
    const dkId = text(entity?.dkId);
    const playerName = text(playerInfo?.[dkId]?.fullName || playerInfo?.[dkId]?.name);
    if (!dkId || !playerName) continue;

    const competition = competitions?.[competitionId] || {};
    const playerTeamId = text(competition?.entityCompByDkId?.[dkId]?.teamId);
    const home = game.homeTeam || {}, away = game.awayTeam || {};
    const team = [home,away].find(t => text(t?.teamId) === playerTeamId);
    const sport = requestedSport || sportKey(game.leagueAbbreviation || game.leagueName);
    if (!sport) continue;

    for (const market of list(pickable?.activePickableMarkets)) {
      if (market?.isPaused === true) continue;
      const marketInfo = markets?.[text(market?.pickSixMarketId)] || {};
      const marketName = text(marketInfo?.name);
      const line = number(market?.targetValue);
      if (!marketName || line === null) continue;

      const sides = [];
      for (const selection of list(market?.activeSelections)) {
        // Keep standard Pick6 selections only. Modified multipliers are boosts/
        // reduced payouts and must not be presented as the regular line.
        if (Number(selection?.standingsMultiplier) !== 1) continue;
        const prop = String(selection?.statLinePropositionId);
        if (prop === '1') sides.push('OVER');
        if (prop === '2') sides.push('UNDER');
      }
      const uniqueSides = [...new Set(sides)];
      if (!uniqueSides.length) continue;

      const key = [competitionId,dkId,marketName,line].join('|');
      const normalized = record({
        sourceId: `${mapping.groupId}:${key}`,
        book: 'draftkings',
        nativePlayerId: dkId,
        playerName,
        sport,
        market: marketName,
        line,
        team: fullTeam(team),
        opponent: '',
        nativeEventId: competitionId,
        homeTeam: fullTeam(home),
        awayTeam: fullTeam(away),
        gameStartTime: game.startTime,
        updatedAt: null,
        position: text(playerInfo?.[dkId]?.position),
        sides: uniqueSides,
      });
      if (normalized) grouped.set(key, normalized);
    }
  }
  return [...grouped.values()];
}

async function mapLimit(items, limit, mapper) {
  const output = new Array(items.length); let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++; if (i >= items.length) return;
      output[i] = await mapper(items[i], i);
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,Math.max(1,items.length))},worker));
  return output;
}

async function fetchLeagueRecords(match, requested) {
  const league = await http2JsonFetch(LEAGUE_URL(match.sportLeagueKey), { headers: UA_HEADERS, timeoutMs: 15_000 });
  const mapping = leagueMapping(league);
  if (!mapping.groupId || !mapping.byCompetition.size) return [];
  const main = await http2JsonFetch(MARKET_URL(mapping.groupId), { headers: UA_HEADERS, timeoutMs: 15_000 });
  const categoryIds = Object.keys(main?.pickCategoryById || {});
  const docs = [main];
  if (categoryIds.length > 1) {
    const extra = await mapLimit(categoryIds, 3, async id => {
      try { return await http2JsonFetch(MARKET_URL(mapping.groupId,id), { headers: UA_HEADERS, timeoutMs: 15_000 }); }
      catch { return null; }
    });
    docs.push(...extra.filter(Boolean));
  }
  const merged = new Map();
  for (const doc of docs) for (const row of normalizeMarketDocument(doc,mapping,requested)) {
    merged.set([row.nativeEventId,row.nativePlayerId,row.market,row.line].join('|'),row);
  }
  return [...merged.values()];
}

export async function fetchDraftKingsPick6Records(sport) {
  const requested = text(sport).toUpperCase();
  if (!SUPPORTED.has(requested)) return [];
  const root = await http2JsonFetch(LIST_URL, { headers: UA_HEADERS, timeoutMs: 15_000 });
  const active = list(root?.sportLeagues).filter(row => row?.hasPicksAvailable === true && text(row?.sportLeagueKey));
  const matches = active.filter(row => sportKey(row.sportLeagueKey) === requested || sportKey(row.name || row.displayName) === requested);
  if (!matches.length) return [];
  // ATP and WTA can be separate active leagues. Merge every matching league into
  // one TENNIS source instead of silently taking the first tour only.
  const batches = await mapLimit(matches, 2, async match => {
    try { return await fetchLeagueRecords(match, requested); }
    catch { return []; }
  });
  const merged = new Map();
  for (const rows of batches) for (const row of rows) {
    merged.set([row.nativeEventId,row.nativePlayerId,row.market,row.line].join('|'),row);
  }
  return [...merged.values()];
}
