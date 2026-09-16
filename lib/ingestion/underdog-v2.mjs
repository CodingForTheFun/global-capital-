import { http2JsonFetch } from './http2-json-fetch.mjs';

const SPORTS_URL = 'https://stats.underdogfantasy.com/v2/sports?product=fantasy';
const SEARCH_URL = 'https://api.underdogfantasy.com/v2/pickem_search/search_results';
const STATE_CONFIG_ID = process.env.AUTOSCOUT_UNDERDOG_STATE_CONFIG_ID || '8176bf5b-d026-4be0-b6b8-02f1f101a8c6';
const CLIENT_VERSION = process.env.AUTOSCOUT_UNDERDOG_CLIENT_VERSION || '2026.09.01';
const DEFAULT_PRIORITIES = ['NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB','CFB','CBB','TENNIS','ATP','WTA','SOCCER','GOLF','MMA'];
const V2_SEARCH_RESULT_GUARD = 100;
const text = value => String(value ?? '').trim();
const headers = Object.freeze({
  'client-type': 'web',
  'client-version': CLIENT_VERSION,
  origin: 'https://underdogfantasy.com',
  referer: 'https://underdogfantasy.com/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
});

function priorities() {
  const raw = text(process.env.AUTOSCOUT_UNDERDOG_SPORTS);
  return (raw ? raw.split(',') : DEFAULT_PRIORITIES).map(v => text(v).toUpperCase()).filter(Boolean);
}

function sportText(row) {
  return [row?.id,row?.name,row?.display_name,row?.title,row?.abbreviation].map(text).join(' ').toUpperCase();
}

function canonicalSportLabel(row) {
  const haystack = sportText(row);
  const aliases = [
    ['WNBA','WNBA'],['NFL','NFL'],['NBA','NBA'],['MLB','MLB'],['NHL','NHL'],
    ['NCAAF','NCAAF'],['CFB','NCAAF'],['COLLEGE FOOTBALL','NCAAF'],
    ['NCAAB','NCAAB'],['CBB','NCAAB'],['COLLEGE BASKETBALL','NCAAB'],
    ['TENNIS','TENNIS'],['ATP','TENNIS'],['WTA','TENNIS'],
  ];
  for (const [needle,label] of aliases) {
    if (haystack === needle || haystack.split(/\s+/).includes(needle) || haystack.includes(needle)) return label;
  }
  return text(row?.abbreviation || row?.name || row?.display_name || row?.title).toUpperCase();
}

function chooseSports(rows, limit = 16) {
  const desired = priorities();
  const ranked = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = text(row?.id);
    if (!id) continue;
    const haystack = sportText(row);
    let score = desired.length + 1;
    for (let i = 0; i < desired.length; i++) {
      const token = desired[i];
      if (haystack === token || haystack.split(/\s+/).includes(token)) { score = i; break; }
      if (haystack.includes(token)) score = Math.min(score, i + 0.25);
    }
    if (score <= desired.length) ranked.push({ id, score });
  }
  ranked.sort((a,b) => a.score - b.score || a.id.localeCompare(b.id));
  return [...new Set(ranked.map(r => r.id))].slice(0, limit);
}

function mergeById(target, rows, key = 'id') {
  const map = new Map(target.map(row => [text(row?.[key]) || JSON.stringify(row), row]));
  for (const row of Array.isArray(rows) ? rows : []) map.set(text(row?.[key]) || JSON.stringify(row), row);
  return [...map.values()];
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

function standardOption(option) {
  const raw = option?.payout_multiplier;
  if (raw == null || raw === '') return true;
  const value = Number(raw);
  return Number.isFinite(value) && value === 1;
}

function adaptLine(row) {
  const overUnder = row?.over_under || {};
  const appearanceStat = overUnder?.appearance_stat || {};
  const displayStat = text(appearanceStat.display_stat || appearanceStat.stat || appearanceStat.name || overUnder.display_stat);
  const options = (Array.isArray(row?.options) ? row.options : [])
    .filter(standardOption)
    .map(option => {
      const choice = text(option?.choice).toLowerCase();
      return {
        ...option,
        choice: choice === 'better' ? 'higher' : choice === 'worse' ? 'lower' : choice,
      };
    });
  return {
    ...row,
    period: null,
    stat_value: row?.stat_value ?? row?.line ?? overUnder?.stat_value ?? overUnder?.line,
    updated_at: row?.updated_at ?? overUnder?.updated_at,
    options,
    over_under: {
      ...overUnder,
      appearance_stat: {
        ...appearanceStat,
        stat: displayStat || appearanceStat.stat,
        display_stat: displayStat || appearanceStat.display_stat,
      },
    },
  };
}

function logStructure(merged) {
  const appearances = new Map(merged.appearances.map(row => [text(row?.id), row]));
  const players = new Map(merged.players.map(row => [text(row?.id), row]));
  const games = new Map(merged.games.map(row => [text(row?.id), row]));
  const counts = { lines: merged.over_under_lines.length, appearanceId:0, appearanceMatch:0, playerMatch:0, gameMatch:0, startTime:0, lineValue:0, market:0, standardOptions:0 };
  const sports = new Set(), periods = new Set();
  for (const row of merged.over_under_lines) {
    const ou = row?.over_under || {}, stat = ou?.appearance_stat || {};
    const aid = text(stat.appearance_id);
    if (aid) counts.appearanceId++;
    const appearance = appearances.get(aid);
    if (appearance) counts.appearanceMatch++;
    const player = players.get(text(appearance?.player_id));
    if (player) { counts.playerMatch++; if (player.sport_id) sports.add(text(player.sport_id)); }
    const game = games.get(text(appearance?.match_id || appearance?.game_id));
    if (game) counts.gameMatch++;
    if (game?.scheduled_at || game?.starts_at || game?.start_time || ou?.starts_at || row?.starts_at) counts.startTime++;
    if (row?.stat_value != null) counts.lineValue++;
    if (text(stat.display_stat || stat.stat || stat.name)) counts.market++;
    if ((row.options || []).some(option => ['higher','lower'].includes(text(option?.choice).toLowerCase()))) counts.standardOptions++;
    if (row?.period != null) periods.add(text(row.period));
  }
  console.log('[Underdog v2 structure]', JSON.stringify({ ...counts, sports:[...sports].slice(0,20), periods:[...periods].slice(0,20) }));
}

export async function fetchUnderdogV2Payload({ maxSports = 16, fetchJson = http2JsonFetch } = {}) {
  const leagueData = await fetchJson(SPORTS_URL, { headers, timeoutMs: 15_000 });
  const sportRows = new Map((Array.isArray(leagueData?.sports) ? leagueData.sports : []).map(row => [text(row?.id), row]).filter(([id]) => id));
  const ids = chooseSports(leagueData?.sports, maxSports);
  if (!ids.length) throw Object.assign(new Error('UNDERDOG_V2_NO_SPORTS'), { code: 'UNDERDOG_V2_NO_SPORTS' });

  const results = await mapLimit(ids, 3, async sportId => {
    const url = new URL(SEARCH_URL);
    url.searchParams.set('sport_id', sportId);
    url.searchParams.set('product', 'fantasy');
    url.searchParams.set('state_config_id', STATE_CONFIG_ID);
    try {
      const data = await fetchJson(url.href, { headers, timeoutMs: 15_000 });
      return data && typeof data === 'object' ? { data, sportId } : null;
    } catch { return null; }
  });

  const successfulResults = results.filter(Boolean);
  if (successfulResults.length !== ids.length) {
    throw Object.assign(new Error('UNDERDOG_V2_PARTIAL_SPORTS'), {
      code: 'UNDERDOG_V2_PARTIAL_SPORTS',
      expectedSports: ids.length,
      loadedSports: successfulResults.length,
    });
  }
  const saturatedSports = successfulResults.filter(result => Array.isArray(result.data?.over_under_lines) && result.data.over_under_lines.length >= V2_SEARCH_RESULT_GUARD);
  if (saturatedSports.length) {
    throw Object.assign(new Error('UNDERDOG_V2_TRUNCATED_SPORTS'), {
      code: 'UNDERDOG_V2_TRUNCATED_SPORTS',
      saturatedSports: saturatedSports.length,
      limitGuard: V2_SEARCH_RESULT_GUARD,
    });
  }

  const merged = { _autoscout_v2:true, players:[], appearances:[], games:[], solo_games:[], teams:[], over_under_lines:[] };
  for (const result of successfulResults) {
    const data = result.data;
    const label = canonicalSportLabel(sportRows.get(result.sportId) || { id: result.sportId });
    const soloGames = Array.isArray(data.solo_games) ? data.solo_games : [];
    const players = (Array.isArray(data.players) ? data.players : []).map(player => ({ ...player, sport_id: label || player.sport_id }));
    const games = (Array.isArray(data.games) ? data.games : []).map(game => ({ ...game, sport_id: label || game.sport_id }));
    const normalizedSoloGames = soloGames.map(game => ({ ...game, sport_id: label || game.sport_id }));
    merged.players = mergeById(merged.players, players);
    merged.appearances = mergeById(merged.appearances, data.appearances);
    merged.games = mergeById(merged.games, [...games, ...normalizedSoloGames]);
    merged.solo_games = mergeById(merged.solo_games, normalizedSoloGames);
    merged.teams = mergeById(merged.teams, data.teams);
    merged.over_under_lines = mergeById(merged.over_under_lines, (data.over_under_lines || []).map(adaptLine));
  }
  if (!merged.over_under_lines.length) throw Object.assign(new Error('UNDERDOG_V2_NO_LINES'), { code: 'UNDERDOG_V2_NO_LINES' });
  logStructure(merged);
  return merged;
}
