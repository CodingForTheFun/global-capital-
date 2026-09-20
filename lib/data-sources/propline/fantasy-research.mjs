// Platform-specific settled fantasy values, never a guessed scoring formula.
// Contract: https://api.prop-line.com/openapi.json PlayerHistoryOut and
// https://prop-line.com/docs#player-game-log (reviewed 2026-09-20).
import { proplineConfigured, proplineGet } from './client.mjs';
import { proplineSportKey, matchProplineSport } from './markets.mjs';

const text = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const nameKey = value => text(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value
  : typeof value === 'string' && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim()) ? Number(value) : null;
const date = value => Number.isFinite(Date.parse(text(value))) ? new Date(value).toISOString() : null;
const list = value => Array.isArray(value) ? value : [];
const unavailable = (code, message, retryable = false) => ({ ok: true, available: false, code, message, gameLog: [], retryable, ...(!retryable ? { lineOnly: true } : {}) });

export function settledFantasySelection(params = {}) {
  const parts = text(params.providerMarketKey).toLowerCase().match(/^([a-z0-9_-]+):([a-z0-9_]+)$/);
  if (!parts || !/(?:^|_)fantasy_(?:score|points)(?:_|$)/.test(parts[2])) return null;
  if (/\s+\+\s+/.test(text(params.playerName)) || /\bcombo\b/i.test(text(params.market))) return null;
  if (params.period && !['full', 'full_game', 'game', 'match', 'single_stat'].includes(text(params.period).toLowerCase())) return null;
  // The history endpoint has no period selector. A period encoded in the market
  // key must not accidentally be compared with the full-game raw archive.
  if (/(?:^|_)(?:[1-9][hq]|[hq][1-9]|half|quarter|period|map[1-9]|1st|2nd|3rd|4th|season)(?:_|$)/.test(parts[2])) return null;
  return { book: parts[1], market: parts[2] };
}

export function normalizeSettledFantasyHistory(payload, archive, params, sportKey, now = Date.now()) {
  const selection = settledFantasySelection(params);
  const failed = message => unavailable('FANTASY_SETTLEMENT_INCOMPLETE', message);
  if (!selection) return null;
  if (payload?.sport_key !== sportKey || archive?.sport_key !== sportKey
      || nameKey(payload?.player_name) !== nameKey(params.playerName)
      || nameKey(archive?.player_name) !== nameKey(params.playerName)
      || payload?.market !== selection.market || payload?.redacted === true || archive?.redacted === true) {
    return failed('The platform, player, sport or fantasy market could not be verified for these historical results.');
  }
  if (payload.player_id && archive.player_id && text(payload.player_id) !== text(archive.player_id)) return failed('Historical player identifiers conflict.');
  const requestedId = text(params.providerPlayerId).replace(/^propline:/, '');
  const returnedIds = [payload.player_id, archive.player_id, ...list(archive.games).map(row => row.player_id), ...list(payload.entries).map(row => row.player_id)].map(text).filter(Boolean);
  if (requestedId && returnedIds.some(id => id !== requestedId)) return failed('Historical player identifiers conflict.');
  const start = Date.parse(text(params.gameStartTime));
  const cutoff = Math.min(now, Number.isFinite(start) ? start : now);
  const selectedEvent = text(params.eventId).replace(/^propline:/, '');
  const games = new Map(), conflicts = new Set();
  for (const row of list(archive.games).slice(0, 100)) {
    const id = text(row.event_id), when = date(row.commence_time);
    if (!id || id === selectedEvent || !when || Date.parse(when) >= cutoff || row.status !== 'final') continue;
    if (row.redacted === true || row.did_not_play === true || row.dnp === true || row.played === false || row.walkover === true || row.retired === true) continue;
    if (row.player_name && nameKey(row.player_name) !== nameKey(params.playerName)) continue;
    if (row.player_id && archive.player_id && text(row.player_id) !== text(archive.player_id)) continue;
    if (sportKey.startsWith('basketball_') && numeric(row.stats?.minutes) === 0) continue;
    const item = { gameId: id, date: when, opponent: text(row.opponent) || null, isHome: typeof row.is_home === 'boolean' ? row.is_home : null, season: row.season ?? null, seasonType: row.season_type ?? null };
    if (games.has(id) && JSON.stringify(games.get(id)) !== JSON.stringify(item)) conflicts.add(id);
    else games.set(id, item);
  }
  const sample = [...games.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, Math.max(1, Math.min(40, Number(params.games) || 20)));
  if (!sample.length || sample.some(row => conflicts.has(row.gameId))) return failed('A complete recent-game sample could not be verified for this fantasy selection.');

  const values = new Map(), invalid = new Set();
  for (const row of list(payload.entries).slice(0, 100)) {
    if (row.bookmaker !== selection.book) continue;
    const id = text(row.event_id), game = games.get(id), value = numeric(row.actual_value);
    if (!game) continue;
    const resolved = Date.parse(text(row.resolved_at)), when = date(row.commence_time);
    const historicalLine = numeric(row.line);
    const grades = [row.over_result, row.under_result].filter(v => v !== null && v !== undefined && v !== '');
    if (row.redacted === true || value === null || historicalLine === null || when !== game.date || !Number.isFinite(resolved)
        || resolved > now || resolved < Date.parse(when) || !grades.length
        || grades.some(grade => !['won', 'lost', 'push'].includes(grade))) { invalid.add(id); continue; }
    const expectedOver = value === historicalLine ? 'push' : value > historicalLine ? 'won' : 'lost';
    const expectedUnder = value === historicalLine ? 'push' : value < historicalLine ? 'won' : 'lost';
    if ((row.over_result && row.over_result !== expectedOver) || (row.under_result && row.under_result !== expectedUnder)) { invalid.add(id); continue; }
    if (values.has(id) && values.get(id) !== value) invalid.add(id);
    else values.set(id, value);
  }
  if (sample.some(row => !values.has(row.gameId) || invalid.has(row.gameId))) {
    return failed('The provider has not returned a settled fantasy score from this platform for every game in the recent sample.');
  }
  return {
    ok: true, available: true, source: 'PropLine platform-specific settled fantasy scores',
    player: { playerName: text(archive.player_name), providerPlayerId: archive.player_id ? `propline:${archive.player_id}` : null },
    gameLog: sample.map(row => ({ ...row, value: values.get(row.gameId), fantasyScore: values.get(row.gameId) })),
    marketDisplayName: text(params.market) || 'Fantasy Score', statKind: `fantasy:settled:${selection.book}`,
    fantasyScoring: { platform: selection.book, exact: true, method: 'settled_platform_values', note: 'Actual settled scores from this platform, matched to completed games. No scoring formula is inferred.' },
    coverage: { seasonComplete: false, fantasyGamesScored: sample.length, fantasyGamesExcluded: 0, basis: 'completed_games_matched_to_platform_settlements' },
  };
}

export async function fetchSettledFantasyResearch(params = {}, options = {}) {
  const selection = settledFantasySelection(params);
  if (!selection || !(options.read || proplineConfigured())) return null;
  const read = options.read || proplineGet;
  try {
    let sportKey = proplineSportKey(params.sport);
    if (!sportKey) {
      const payload = await read('/v1/sports', {}, { ttlSeconds: 1800 });
      const sport = text(params.sport).toUpperCase();
      const matches = list(Array.isArray(payload) ? payload : payload?.sports).filter(row => {
        const key = text(row.key ?? row.sport_key);
        return /^[a-z0-9_]{1,90}$/.test(key) && (key.toUpperCase() === sport || matchProplineSport(key) === sport);
      });
      if (matches.length !== 1) return unavailable('FANTASY_SPORT_UNVERIFIED', 'An exact historical sport source is not available for this fantasy selection.');
      sportKey = text(matches[0].key ?? matches[0].sport_key);
    }
    const path = `/v1/sports/${sportKey}/players/${encodeURIComponent(text(params.playerName))}`;
    const payload = await read(path + '/history', { market: selection.market, bookmaker: selection.book, limit: 100 }, { ttlSeconds: 900 });
    if (!list(payload?.entries).length) return unavailable('FANTASY_SETTLEMENT_UNAVAILABLE', 'No settled fantasy scores have been returned for this platform, sport and player yet.');
    const archive = await read(path + '/games', { limit: 100 }, { ttlSeconds: 900 });
    return normalizeSettledFantasyHistory(payload, archive, params, sportKey, options.now?.() ?? Date.now());
  } catch {
    return unavailable('RESEARCH_PROVIDER_ERROR', 'Historical fantasy results are temporarily unavailable. Please retry.', true);
  }
}
