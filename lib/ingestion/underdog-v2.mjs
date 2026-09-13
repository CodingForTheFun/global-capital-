import { http2JsonFetch } from './http2-json-fetch.mjs';

const SPORTS_URL = 'https://stats.underdogfantasy.com/v2/sports?product=fantasy';
const SEARCH_URL = 'https://api.underdogfantasy.com/v2/pickem_search/search_results';
const STATE_CONFIG_ID = process.env.AUTOSCOUT_UNDERDOG_STATE_CONFIG_ID || '8176bf5b-d026-4be0-b6b8-02f1f101a8c6';
const CLIENT_VERSION = process.env.AUTOSCOUT_UNDERDOG_CLIENT_VERSION || '2026.09.01';
const DEFAULT_PRIORITIES = ['NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB','CFB','CBB','TENNIS','ATP','WTA','SOCCER','GOLF','MMA'];
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

function adaptLine(row) {
  const overUnder = row?.over_under || {};
  const appearanceStat = overUnder?.appearance_stat || {};
  const displayStat = text(appearanceStat.display_stat || appearanceStat.stat || appearanceStat.name || overUnder.display_stat);
  const options = (Array.isArray(row?.options) ? row.options : []).map(option => {
    const choice = text(option?.choice).toLowerCase();
    return {
      ...option,
      choice: choice === 'better' ? 'higher' : choice === 'worse' ? 'lower' : choice,
      // A public pick'em payout modifier is not sportsbook price data.
      payout_multiplier: null,
    };
  });
  return {
    ...row,
    // The v2 API commonly places the standard threshold on the nested over_under.
    // Mirror it onto the legacy field so the existing canonical normalizer does not
    // discard every otherwise valid row for a missing top-level stat_value.
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

export async function fetchUnderdogV2Payload({ maxSports = 16 } = {}) {
  const leagueData = await http2JsonFetch(SPORTS_URL, { headers, timeoutMs: 15_000 });
  const ids = chooseSports(leagueData?.sports, maxSports);
  if (!ids.length) throw Object.assign(new Error('UNDERDOG_V2_NO_SPORTS'), { code: 'UNDERDOG_V2_NO_SPORTS' });

  const results = await mapLimit(ids, 3, async sportId => {
    const url = new URL(SEARCH_URL);
    url.searchParams.set('sport_id', sportId);
    url.searchParams.set('product', 'fantasy');
    url.searchParams.set('state_config_id', STATE_CONFIG_ID);
    try {
      const data = await http2JsonFetch(url.href, { headers, timeoutMs: 15_000 });
      return data && typeof data === 'object' ? data : null;
    } catch { return null; }
  });

  const merged = { players:[], appearances:[], games:[], solo_games:[], teams:[], over_under_lines:[] };
  for (const data of results.filter(Boolean)) {
    const soloGames = Array.isArray(data.solo_games) ? data.solo_games : [];
    merged.players = mergeById(merged.players, data.players);
    merged.appearances = mergeById(merged.appearances, data.appearances);
    // Legacy normalization joins appearances against games only. Include solo games
    // there as well so tennis and other individual matchups are not dropped.
    merged.games = mergeById(merged.games, [...(Array.isArray(data.games) ? data.games : []), ...soloGames]);
    merged.solo_games = mergeById(merged.solo_games, soloGames);
    merged.teams = mergeById(merged.teams, data.teams);
    merged.over_under_lines = mergeById(merged.over_under_lines, (data.over_under_lines || []).map(adaptLine));
  }
  if (!merged.over_under_lines.length) throw Object.assign(new Error('UNDERDOG_V2_NO_LINES'), { code: 'UNDERDOG_V2_NO_LINES' });
  return merged;
}
