// PropLine as the primary source for player game history.
//
// The research drawer used to be ESPN-first for every league ESPN covers, with
// ClearSports behind it. PropLine now carries its own graded game logs, keyed
// to the same market vocabulary the board already prices in, so it is asked
// first and ESPN becomes the backup rather than the default.
//
// Three rules keep that swap from making the product worse:
//
//   * Identity is verified, never assumed. PropLine resolves a player by name.
//     A name lookup can land on the wrong person, so the returned player name
//     and - when the caller knows it - the team must agree before any row is
//     used. A disagreement falls through to ESPN instead of answering with
//     somebody else's numbers.
//
//   * The market must map to a real stat key. statForMarket reads PropLine's
//     own stats object; when the key is absent the answer is "not covered",
//     not a zero. Nothing here computes a stat PropLine did not grade.
//
//   * Too little history is treated as no history. A hit rate over two games
//     is noise, and ESPN usually has the full season, so a thin PropLine
//     answer defers rather than displacing a complete one.
//
// Any failure at all - network, shape, identity, coverage - returns an
// unavailable result, and the caller continues down the existing chain. This
// module can only add a source; it can never remove one.
import { fetchPlayerGames, statForMarket } from './insights.mjs';
import { proplineSportKey } from './markets.mjs';
import { proplineConfigured } from './client.mjs';

const text = (value) => String(value ?? '').trim();
const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

// Enough games for a hit rate to mean something. Below this ESPN's fuller
// history is the better answer even though PropLine replied.
const MIN_GRADED_GAMES = 5;

// Name comparison has to survive punctuation and suffixes without becoming so
// loose that two different players collapse into one.
function nameKey(value) {
  return text(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.'`]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function sameName(a, b) {
  const left = nameKey(a);
  const right = nameKey(b);
  if (!left || !right) return false;
  return left === right;
}

// Team labels arrive as abbreviations from PropLine and as anything at all from
// the board. Compare on containment of the longer token set rather than exact
// equality, and treat "unknown" as agreement so a missing abbreviation does not
// reject an otherwise correct player.
function sameTeam(a, b) {
  const left = nameKey(a);
  const right = nameKey(b);
  if (!left || !right) return true;
  if (left === right) return true;
  return left.includes(right) || right.includes(left);
}

function seasonOf(dateIso) {
  const year = new Date(dateIso).getUTCFullYear();
  return Number.isFinite(year) ? year : null;
}

function gameResult(scoreFor, scoreAgainst) {
  if (scoreFor === null || scoreAgainst === null) return null;
  if (scoreFor > scoreAgainst) return 'W';
  if (scoreFor < scoreAgainst) return 'L';
  return 'T';
}

function unavailable(code, message) {
  return { ok: true, available: false, code, message };
}

/**
 * PropLine-sourced player history in the shape finalizePublicHistory consumes.
 *
 * Returns null when PropLine is not a candidate at all (not configured, sport
 * not carried), so the caller can tell "no opinion" apart from "asked and
 * came back empty".
 */
export async function fetchProplineResearch(params = {}) {
  if (!proplineConfigured()) return null;

  const sport = text(params.sport).toUpperCase();
  const playerName = text(params.playerName);
  const marketKey = text(params.providerMarketKey) || text(params.market);
  if (!sport || !playerName || !marketKey) return null;
  if (!proplineSportKey(sport)) return null;

  let payload = null;
  try {
    payload = await fetchPlayerGames(sport, playerName);
  } catch {
    // fetchPlayerGames already swallows transport failures; this is belt and
    // braces so a shape change cannot take the drawer down.
    return unavailable('PROPLINE_UNAVAILABLE', 'PropLine history is unavailable for this selection.');
  }
  if (!payload || !Array.isArray(payload.games) || !payload.games.length) {
    return unavailable('PROPLINE_NO_GAMES', 'PropLine returned no games for this player.');
  }

  // Identity gate. PropLine echoes the name it resolved; when it differs from
  // the name asked for, this is a different player.
  if (payload.playerName && !sameName(payload.playerName, playerName)) {
    return unavailable('PROPLINE_PLAYER_MISMATCH', 'PropLine resolved a different player.');
  }

  const wantedTeam = text(params.team);
  const rows = [];
  let graded = 0;
  let teamConflict = false;

  for (const game of payload.games) {
    const value = statForMarket(game, marketKey);
    if (value === null) continue;
    graded += 1;

    const rowTeam = game.team || game.teamAbbr || null;
    if (wantedTeam && rowTeam && !sameTeam(rowTeam, wantedTeam)) {
      // One stray row is a trade or a typo; the check below decides on the
      // whole sample rather than on any single game.
      teamConflict = true;
    }

    const scoreFor = game.isHome ? num(game.homeScore) : num(game.awayScore);
    const scoreAgainst = game.isHome ? num(game.awayScore) : num(game.homeScore);

    rows.push({
      // Neutral id shapes, matching the ones the ESPN path already emits. A
      // vendor name in an id would survive the public sanitizer, which only
      // scrubs known label keys and known vendor words.
      gameId: `${sport.toLowerCase()}:${game.eventId || game.date}`,
      date: game.date,
      opponent: game.opponent || null,
      opponentName: game.opponent || null,
      opponentId: game.opponent ? `${sport}:${game.opponent}` : null,
      team: rowTeam,
      teamName: rowTeam,
      isHome: typeof game.isHome === 'boolean' ? game.isHome : null,
      scoreFor,
      scoreAgainst,
      gameResult: gameResult(scoreFor, scoreAgainst),
      value,
      season: seasonOf(game.date),
      statKind: marketKey,
    });
  }

  if (!graded) {
    return unavailable('PROPLINE_MARKET_NOT_GRADED', 'PropLine does not grade this market for this player.');
  }
  // If the majority of graded rows belong to a team the caller did not expect,
  // the name lookup found the wrong person.
  if (teamConflict && wantedTeam) {
    const agreeing = rows.filter((row) => !row.team || sameTeam(row.team, wantedTeam)).length;
    if (agreeing * 2 < rows.length) {
      return unavailable('PROPLINE_PLAYER_MISMATCH', 'PropLine resolved a player on a different team.');
    }
  }
  if (rows.length < MIN_GRADED_GAMES) {
    return unavailable('PROPLINE_THIN_HISTORY', 'PropLine has too few graded games for a hit rate.');
  }

  const latest = rows[0];
  const matchupOpponent = text(params.opponent) || null;
  const isHome = typeof params.isHome === 'boolean'
    ? params.isHome
    : null;

  return {
    ok: true,
    available: true,
    source: 'PropLine',
    cached: false,
    isHome,
    opponent: matchupOpponent,
    opponentId: matchupOpponent ? `${sport}:${matchupOpponent}` : null,
    player: {
      playerName: payload.playerName || playerName,
      providerPlayerId: `history:${sport}:${nameKey(payload.playerName || playerName).replace(/\s+/g, '-')}`,
      team: wantedTeam || latest.team || null,
      sport,
    },
    gameLog: rows,
    marketDisplayName: null,
    entityType: 'player',
    statKind: marketKey,
    season: latest.season,
    coverage: {
      seasonComplete: false,
      gradedGames: rows.length,
      returnedGames: payload.games.length,
    },
  };
}
