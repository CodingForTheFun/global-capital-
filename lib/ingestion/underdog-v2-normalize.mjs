import { record } from './normalize.mjs';

const list = value => Array.isArray(value) ? value : [];
const text = value => value == null ? '' : String(value).trim();
const index = rows => new Map(list(rows).map(row => [text(row?.id), row]).filter(([id]) => id));
const invalid = row => !row || row.active === false || row.is_active === false || row.is_live === true || row.live === true || /^(suspended|closed|settled|removed|in_progress|unavailable)$/i.test(text(row.status));
const special = row => row?.is_promotional === true || row?.is_alternate === true || row?.promotion != null || row?.boost != null || /goblin|demon|boost|discount|promo|alternate/i.test([row?.odds_type,row?.type,row?.label].map(text).join(' '));
const side = choice => ({higher:'OVER',better:'OVER',lower:'UNDER',worse:'UNDER'}[text(choice).toLowerCase()] || null);

function teamName(team) {
  return text(team?.abbr || team?.abbreviation || team?.name);
}

export function normalizeUnderdogV2(payload) {
  if (!Array.isArray(payload?.over_under_lines) || !Array.isArray(payload?.players) || !Array.isArray(payload?.appearances)) {
    throw Object.assign(new Error('INVALID_UNDERDOG_V2_SCHEMA'), { code: 'INVALID_UNDERDOG_V2_SCHEMA' });
  }
  const players = index(payload.players);
  const appearances = index(payload.appearances);
  const games = index(payload.games);
  const soloGames = index(payload.solo_games);
  const teams = index(payload.teams);
  const output = [];

  for (const row of payload.over_under_lines) {
    const ou = row?.over_under || {};
    const stat = ou?.appearance_stat || {};
    const appearance = appearances.get(text(stat.appearance_id));
    const player = players.get(text(appearance?.player_id));
    if (!appearance || !player || invalid(row) || invalid(ou) || invalid(player) || special(row) || special(ou)) continue;

    const matchId = text(appearance.match_id || appearance.game_id);
    const matchType = text(appearance.match_type).toLowerCase();
    const game = matchType === 'sologame' ? soloGames.get(matchId) : (games.get(matchId) || soloGames.get(matchId));
    if (!game) continue;

    const market = text(stat.display_stat || stat.stat || stat.name || ou.display_stat || ou.stat);
    if (!market || /(?:\b1h\b|\b2h\b|\b[1-4]q\b|first half|second half|quarter|period|1st inning)/i.test(market)) continue;

    const availableOptions = list(row.options).filter(option => !invalid(option) && !special(option) && side(option.choice));
    if (!availableOptions.length) continue;
    const sides = [...new Set(availableOptions.map(option => side(option.choice)).filter(Boolean))];
    if (!sides.length) continue;

    const home = teams.get(text(game.home_team_id));
    const away = teams.get(text(game.away_team_id));
    const playerTeam = teams.get(text(appearance.team_id || player.team_id));
    const playerName = text(player.full_name) || [player.first_name,player.last_name].map(text).filter(Boolean).join(' ');
    const sport = text(player.sport_id || game.sport_id || game.league_id);
    const start = game.scheduled_at || game.starts_at || game.start_time || ou.starts_at || row.starts_at;

    const normalized = record({
      sourceId: text(row.id),
      book: 'underdog',
      nativePlayerId: text(player.id),
      playerName,
      sport,
      market,
      line: row.stat_value ?? row.line ?? ou.line,
      team: teamName(playerTeam) || text(player.team),
      opponent: '',
      nativeEventId: text(game.id || matchId),
      homeTeam: teamName(home),
      awayTeam: teamName(away),
      gameStartTime: start,
      updatedAt: row.updated_at || ou.updated_at,
      headshot: player.image_url,
      position: appearance.position_id || player.position,
      sides,
    });
    if (normalized) output.push(normalized);
  }
  return output;
}
