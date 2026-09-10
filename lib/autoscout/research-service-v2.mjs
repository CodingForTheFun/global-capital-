import { researchPlayerProp as researchSportsDataIO, researchHealth as sportsDataIOHealth } from './research-service.mjs';
import { clearSportsConfigured, clearSportsHealth, fetchClearSportsResearch } from '../data-sources/clearsports/research.mjs';
import { rollingAnalytics } from '../analytics/rolling.mjs';
import { sameTeam } from '../data-sources/contract.mjs';

const text = (value) => String(value ?? '').trim();
const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function cleanSide(value) {
  return text(value).toUpperCase() === 'UNDER' ? 'UNDER' : 'OVER';
}

function inferOpponent({ team, homeTeam, awayTeam, opponent }) {
  if (text(opponent)) return text(opponent);
  if (!text(team)) return null;
  if (sameTeam(team, homeTeam)) return text(awayTeam) || null;
  if (sameTeam(team, awayTeam)) return text(homeTeam) || null;
  return null;
}

function beats(value, line, side) {
  if (value === line) return null;
  return side === 'UNDER' ? value < line : value > line;
}

function decorateGameLog(rows, line, side) {
  const lineValue = num(line);
  return rows.map((row) => ({
    ...row,
    hit: lineValue === null ? null : beats(row.value, lineValue, side),
    push: lineValue === null ? null : row.value === lineValue,
  }));
}

function summary(rows, line, side) {
  if (!rows.length) return { games: 0, average: null, hitRate: null, hits: null, misses: null, pushes: null };
  const analytics = rollingAnalytics(rows, line, side);
  const season = analytics?.windows?.season || {};
  return {
    games: rows.length,
    average: season.average ?? null,
    hitRate: season.hitRate ?? null,
    hits: season.hits ?? null,
    misses: season.misses ?? null,
    pushes: season.pushes ?? null,
  };
}

function finalizeClearSports(clear, params = {}) {
  const lineValue = num(params.line);
  const side = cleanSide(params.side);
  const rawGames = Array.isArray(clear?.gameLog) ? clear.gameLog.filter((row) => num(row?.value) !== null) : [];
  const team = clear?.player?.team || params.team || null;
  const opponent = inferOpponent({
    team,
    homeTeam: params.homeTeam,
    awayTeam: params.awayTeam,
    opponent: params.opponent,
  });
  const analytics = rollingAnalytics(rawGames, lineValue, side);
  const h2hGames = opponent ? rawGames.filter((row) => sameTeam(row?.opponent, opponent)) : [];
  const decorated = decorateGameLog(rawGames, lineValue, side);

  let season = null;
  for (const row of decorated) {
    const parsed = Date.parse(row?.date || '');
    if (Number.isFinite(parsed)) {
      season = new Date(parsed).getUTCFullYear();
      break;
    }
  }

  return {
    ok: true,
    available: true,
    source: 'ClearSports',
    fetchedAt: clear?.fetchedAt || new Date().toISOString(),
    cached: Boolean(clear?.cached),
    player: {
      playerName: params.playerName,
      providerPlayerId: clear?.player?.providerPlayerId || null,
      team,
    },
    matchup: {
      opponent,
      homeTeam: text(params.homeTeam) || null,
      awayTeam: text(params.awayTeam) || null,
    },
    market: params.market,
    line: lineValue,
    side,
    season,
    windows: analytics.windows,
    trend: analytics.trend,
    splits: analytics.splits,
    h2h: summary(h2hGames, lineValue, side),
    context: clear?.context || null,
    gameLog: decorated,
    coverage: {
      gamesReturned: decorated.length,
      h2hGames: h2hGames.length,
      provider: 'ClearSports',
    },
    providerDiagnostics: clear?.diagnostics || null,
  };
}

export function researchHealth() {
  const fallback = sportsDataIOHealth();
  return {
    configured: clearSportsConfigured() || Boolean(fallback?.configured),
    primary: 'ClearSports',
    fallback: 'SportsDataIO',
    clearSports: { configured: clearSportsConfigured() },
    sportsDataIO: fallback,
  };
}

export async function researchLiveHealth() {
  const [clearSports, fallback] = await Promise.all([
    clearSportsHealth({ live: true }),
    Promise.resolve(sportsDataIOHealth()),
  ]);
  return {
    configured: Boolean(clearSports?.configured || fallback?.configured),
    primary: 'ClearSports',
    fallback: 'SportsDataIO',
    clearSports,
    sportsDataIO: fallback,
  };
}

export async function researchPlayerProp(params = {}) {
  let clearAttempt = null;

  if (clearSportsConfigured()) {
    clearAttempt = await fetchClearSportsResearch({
      sport: params.sport,
      playerName: params.playerName,
      // Deliberately match ClearSports by player name first. Team identifiers can
      // differ by provider (for example "NO" vs "nfl_no"). The caller's team is
      // still used later for matchup context.
      team: null,
      market: params.market,
      games: params.games,
    });
    if (clearAttempt?.available) return finalizeClearSports(clearAttempt, params);
  }

  const fallback = await researchSportsDataIO(params);
  if (fallback?.available) {
    return clearAttempt
      ? { ...fallback, providerAttempts: { clearSports: { code: clearAttempt.code || null, available: false } } }
      : fallback;
  }

  if (clearAttempt) {
    return {
      ...clearAttempt,
      fallback: {
        provider: 'SportsDataIO',
        available: Boolean(fallback?.available),
        code: fallback?.code || null,
        providerStatus: fallback?.providerStatus ?? null,
      },
    };
  }

  return fallback;
}
