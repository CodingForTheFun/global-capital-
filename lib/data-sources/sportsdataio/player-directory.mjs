import { BASE, FEEDS } from './endpoints.mjs';

const clean = (value) => {
  const text = String(value ?? '').trim();
  return text || null;
};

function playerNameOf(row = {}) {
  const direct = clean(row.PlayerName ?? row.Name ?? row.ShortName ?? row.DisplayName);
  if (direct) return direct;
  const joined = clean(`${row.FirstName ?? ''} ${row.LastName ?? ''}`);
  return joined;
}

function playerIdOf(row = {}) {
  const value = row.PlayerID ?? row.PlayerId ?? row.playerId;
  return value === null || value === undefined || value === '' ? null : String(value);
}

function teamOf(row = {}) {
  return clean(row.Team ?? row.TeamKey ?? row.TeamCode ?? row.TeamAbbreviation);
}

export function indexPlayerDirectory(payloads = []) {
  const directory = new Map();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const item of node) visit(item); return; }
    const id = playerIdOf(node);
    const name = playerNameOf(node);
    if (id && name) {
      const current = directory.get(id) || {};
      directory.set(id, {
        playerId: id,
        playerName: current.playerName || name,
        team: current.team || teamOf(node),
        teamId: current.teamId ?? node.TeamID ?? null,
      });
    }
    for (const value of Object.values(node)) if (value && typeof value === 'object') visit(value);
  };
  visit(payloads);
  return directory;
}

export async function loadPlayerDirectory({ client, sport, league, params }) {
  const feeds = ['projections', 'playerGameStats', 'playerSeasonStats'];
  const payloads = await Promise.all(feeds.map(async (name) => {
    const feed = FEEDS[name];
    if (!feed) return null;
    if (feed.requires === 'projections' && !league.projections) return null;
    const path = feed.build(league, params);
    if (!path) return null;
    const result = await client.get(`${BASE}/${path}`, path, { ttlMs: feed.ttlMs, sport });
    return result.ok ? result.data : null;
  }));
  return indexPlayerDirectory(payloads.filter(Boolean));
}

export function resolveOfferPlayers(offers = [], directory = new Map()) {
  let unresolved = 0;
  const rows = [];
  for (const offer of offers) {
    if (!offer?.playerId) { unresolved++; continue; }
    const resolved = directory.get(String(offer.playerId));
    const playerName = clean(offer.playerName) || clean(resolved?.playerName);
    if (!playerName) { unresolved++; continue; }
    rows.push({
      ...offer,
      playerName,
      team: clean(offer.team) || clean(resolved?.team),
      teamId: offer.teamId ?? resolved?.teamId ?? null,
    });
  }
  return { offers: rows, unresolved };
}
