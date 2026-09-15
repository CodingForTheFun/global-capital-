import { PUBLIC_LEAGUES, canonicalSport, marketContract } from '../data-sources/espn/stat-contract.mjs';
import { persistGameLogs, publicPersistenceConfigured } from './public-persistence.mjs';

const text = (value) => String(value ?? '').trim();
// Keep persistence aligned with the same verified ESPN league registry used by
// research. Previously only NBA/NFL/MLB survived process restarts even though
// WNBA/NCAAF/NHL/soccer research was already supported and verified on demand.
const SUPPORTED = new Set(Object.keys(PUBLIC_LEAGUES));

export function historyRowsFromResearch(result, params = {}, { now = Date.now } = {}) {
  const sport = canonicalSport(params.sport || result?.player?.sport || result?.sport);
  if (!SUPPORTED.has(sport) || !result?.available || !Array.isArray(result?.gameLog)) return [];

  const playerId = text(result?.player?.providerPlayerId || params.providerPlayerId);
  if (!new RegExp(`^history:${sport}:[0-9]+$`).test(playerId)) return [];

  const contract = marketContract({
    sport,
    market: params.market || result?.marketDisplayName || result?.market,
    providerMarketKey: params.providerMarketKey || result?.providerMarketKey,
  });
  if (!contract || contract.entityType !== 'player') return [];
  const category = sport === 'MLB' ? (contract.category === 'pitching' ? 'pitching' : 'batting') : 'general';
  const playerName = text(result?.player?.name || result?.player?.playerName || params.playerName);
  if (!playerName) return [];

  const rows = [];
  const seen = new Set();
  for (const game of result.gameLog) {
    const gameId = text(game?.gameId || game?.id);
    const gameDate = text(game?.date || game?.gameDate);
    const parsedDate = Date.parse(gameDate);
    const seasonType = Number(game?.seasonType);
    const season = Number(game?.season);
    if (!gameId || seen.has(gameId) || !Number.isFinite(parsedDate) || parsedDate >= now()) continue;
    if (![2, 3].includes(seasonType) || !Number.isFinite(season)) continue;
    seen.add(gameId);
    rows.push({
      player_id: playerId,
      game_id: gameId,
      sport,
      player_name: playerName,
      game_date: new Date(parsedDate).toISOString(),
      season: String(Math.trunc(season)),
      category,
      season_type: seasonType,
      stats: { ...game },
    });
  }
  return rows;
}

export async function persistResearchGameLogs(result, params = {}) {
  if (!publicPersistenceConfigured()) return { written: 0, skipped: true };
  const rows = historyRowsFromResearch(result, params);
  if (!rows.length) return { written: 0, skipped: true };
  try {
    return await persistGameLogs(rows);
  } catch (error) {
    // Historical persistence must never make research unavailable to the user.
    console.log(`[AutoScout game logs] persist failed code=${text(error?.code || 'GAME_LOG_PERSIST_FAILED').slice(0, 80)}`);
    return { written: 0, failed: true };
  }
}
