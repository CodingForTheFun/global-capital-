import { normalizePlayerName, sameTeam } from '../contract.mjs';
import {
  sportradarTrialGet,
  sportradarTrialHealth,
  sportradarTrialProductAvailable,
  startSportradarTrialProbe,
} from './trial-products.mjs';

const text = (value) => String(value ?? '').trim();
const list = (value) => Array.isArray(value) ? value : [];

const SPORT_PRODUCTS = Object.freeze({
  NBA: 'nba',
  WNBA: 'wnba',
  NFL: 'nfl',
  MLB: 'mlb',
  NHL: 'nhl',
  NCAAF: 'ncaafb',
  NCAAMH: 'ncaamh',
});

const DIRECT_INJURY_SPORTS = new Set(['NBA','WNBA','MLB','NHL']);

startSportradarTrialProbe();

function productForSport(sport) {
  return SPORT_PRODUCTS[text(sport).toUpperCase()] || null;
}

function collectNamedArrays(node, keyName, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) collectNamedArrays(item, keyName, out);
    return out;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === keyName && Array.isArray(value)) out.push(...value);
    if (value && typeof value === 'object') collectNamedArrays(value, keyName, out);
  }
  return out;
}

function uniqueById(rows = []) {
  const seen = new Set(), out = [];
  for (const row of rows) {
    const id = text(row?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

function teamName(row = {}) {
  return text(row.market && row.name ? `${row.market} ${row.name}` : row.name || row.market || row.alias);
}

function normalizeTeamRow(row = {}) {
  return {
    id: text(row.id),
    abbreviation: text(row.alias || row.abbreviation),
    name: teamName(row),
    market: text(row.market),
  };
}

function playerName(row = {}) {
  return text(row.full_name || row.fullName || row.name || [row.first_name, row.last_name].filter(Boolean).join(' '));
}

function flattenPlayers(payload) {
  return uniqueById([
    ...collectNamedArrays(payload, 'players'),
    ...collectNamedArrays(payload, 'roster'),
  ].filter((row) => playerName(row)));
}

function resolveTeam(rows, value) {
  const wanted = text(value);
  if (!wanted) return null;
  const matches = rows.filter((row) =>
    sameTeam(row.abbreviation, wanted)
    || sameTeam(row.name, wanted)
    || (row.market && sameTeam(row.market, wanted)));
  return matches.length === 1 ? matches[0] : null;
}

function resolvePlayer(rows, name) {
  const wanted = normalizePlayerName(name);
  if (!wanted) return null;
  const matches = rows.filter((row) => normalizePlayerName(playerName(row)) === wanted);
  return matches.length === 1 ? matches[0] : null;
}

function injuryFromPlayer(player = {}) {
  const injuries = list(player.injuries);
  const injury = injuries.find((row) => row && typeof row === 'object') || player.injury || null;
  if (!injury) return null;
  return {
    status: text(injury.status || injury.game_status || injury.practice?.status) || null,
    description: text(injury.desc || injury.primary || injury.comment || injury.description) || null,
    secondary: text(injury.secondary) || null,
    startDate: text(injury.start_date || injury.status_date) || null,
    updatedAt: text(injury.update_date || injury.updated_at) || null,
    estimatedReturnDate: text(injury.estimated_return_date) || null,
  };
}

function findInjuryPlayer(payload, player) {
  if (!payload || !player) return null;
  const id = text(player.id);
  const name = normalizePlayerName(playerName(player));
  const candidates = flattenPlayers(payload);
  const exactId = id ? candidates.filter((row) => text(row.id) === id) : [];
  const selected = exactId.length === 1
    ? exactId[0]
    : candidates.filter((row) => normalizePlayerName(playerName(row)) === name).length === 1
      ? candidates.find((row) => normalizePlayerName(playerName(row)) === name)
      : null;
  return selected ? injuryFromPlayer(selected) : null;
}

export async function fetchSportradarTeamDirectory(sport) {
  const selected = text(sport).toUpperCase();
  const productId = productForSport(selected);
  if (!productId || !sportradarTrialProductAvailable(productId)) return [];
  const result = await sportradarTrialGet(productId, '/league/hierarchy.json', {}, {
    ttlMs: 4 * 60 * 60_000,
    timeoutMs: 10_000,
  });
  if (!result.ok) return [];
  const teams = uniqueById(collectNamedArrays(result.payload, 'teams'))
    .map(normalizeTeamRow)
    .filter((row) => row.id && row.abbreviation && row.name);
  return teams.sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchSportradarResearchContext(params = {}) {
  const sport = text(params.sport).toUpperCase();
  const productId = productForSport(sport);
  if (!productId || !sportradarTrialProductAvailable(productId)) return null;

  const teams = await fetchSportradarTeamDirectory(sport);
  const selectedTeam = resolveTeam(teams, params.team)
    || resolveTeam(teams, params.homeTeam)
    || resolveTeam(teams, params.awayTeam);
  if (!selectedTeam?.id) {
    return {
      source: 'Sportradar',
      product: productId,
      teamMatched: false,
    };
  }

  const profile = await sportradarTrialGet(productId, `/teams/${encodeURIComponent(selectedTeam.id)}/profile.json`, {}, {
    ttlMs: 4 * 60 * 60_000,
    timeoutMs: 10_000,
  });
  if (!profile.ok) {
    return {
      source: 'Sportradar',
      product: productId,
      teamMatched: true,
      providerTeamId: selectedTeam.id,
      team: selectedTeam.abbreviation || selectedTeam.name,
      rosterAvailable: false,
    };
  }

  const players = flattenPlayers(profile.payload);
  const player = resolvePlayer(players, params.playerName);
  if (!player) {
    return {
      source: 'Sportradar',
      product: productId,
      teamMatched: true,
      providerTeamId: selectedTeam.id,
      team: selectedTeam.abbreviation || selectedTeam.name,
      rosterAvailable: true,
      playerMatched: false,
    };
  }

  let injury = injuryFromPlayer(player);
  if (!injury && DIRECT_INJURY_SPORTS.has(sport)) {
    const injuries = await sportradarTrialGet(productId, '/league/injuries.json', {}, {
      ttlMs: 4 * 60 * 60_000,
      timeoutMs: 10_000,
    });
    if (injuries.ok) injury = findInjuryPlayer(injuries.payload, player);
  }

  return {
    source: 'Sportradar',
    product: productId,
    teamMatched: true,
    rosterAvailable: true,
    playerMatched: true,
    providerTeamId: selectedTeam.id,
    providerPlayerId: text(player.id) || null,
    team: selectedTeam.abbreviation || selectedTeam.name,
    position: text(player.position || player.primary_position) || null,
    // "G"/"F" is a role family; ranks by position need the exact primary slot.
    primaryPosition: text(player.primary_position) || null,
    jersey: text(player.jersey_number || player.jersey) || null,
    status: text(player.status) || null,
    injury,
  };
}

export function sportradarResearchHealth() {
  const health = sportradarTrialHealth();
  return {
    configured: health.configured,
    supportedSports: Object.keys(SPORT_PRODUCTS),
    activeProducts: health.available.filter((id) => Object.values(SPORT_PRODUCTS).includes(id)),
  };
}
