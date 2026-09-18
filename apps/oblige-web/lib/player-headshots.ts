/** Artwork identities only: never reuse these aliases for prop/history matching. */
const ALIASES: Record<string, string> = {
  FOOTBALL_NFL: 'NFL', AMERICANFOOTBALL_NFL: 'NFL',
  FOOTBALL_NCAAF: 'NCAAF', AMERICANFOOTBALL_NCAAF: 'NCAAF',
  BASKETBALL_NBA: 'NBA', BASKETBALL_WNBA: 'WNBA', BASKETBALL_NCAAB: 'NCAAB',
  BASEBALL_MLB: 'MLB', ICEHOCKEY_NHL: 'NHL', HOCKEY_NHL: 'NHL',
  MLS: 'SOCCER', EPL: 'SOCCER', UCL: 'SOCCER',
};
const ESPN_PATH: Record<string, string> = {
  NFL: 'nfl', NCAAF: 'college-football', NBA: 'nba', WNBA: 'wnba',
  NCAAB: 'mens-college-basketball', MLB: 'mlb', NHL: 'nhl', SOCCER: 'soccer',
  TENNIS: 'tennis', GOLF: 'golf',
};
export function artworkSport(value: string): string {
  const code = String(value || '').trim().toUpperCase();
  if (code.startsWith('SOCCER_')) return 'SOCCER';
  if (code.startsWith('TENNIS_')) return 'TENNIS';
  return ALIASES[code] || code;
}
export type HeadshotIdentity = {
  sport: string; name: string; team?: string | null; providerPlayerId?: string | null;
};
export const unavailablePhoto = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><title>Player photo unavailable</title><rect width="128" height="128" rx="64" fill="#18263c"/><circle cx="64" cy="44" r="22" fill="#53647c"/><path d="M23 112c0-27 18-42 41-42s41 15 41 42" fill="#53647c"/></svg>'
);
export function headshotSources(identity: HeadshotIdentity): string[] {
  const sport = artworkSport(identity.sport);
  const name = String(identity.name || '').trim();
  const providerId = String(identity.providerPlayerId || '').trim();
  const sources: string[] = [];
  // Never guess that an unnamespaced provider ID is an ESPN athlete ID.
  const explicit = /^espn:([1-9]\d{0,10})$/i.exec(providerId);
  const history = /^history:([^:]+):([1-9]\d{0,10})$/i.exec(providerId);
  const id = explicit?.[1] || (history && artworkSport(history[1]) === sport ? history[2] : null);
  if (name && id && ESPN_PATH[sport]) {
    sources.push(`https://a.espncdn.com/i/headshots/${ESPN_PATH[sport]}/players/full/${id}.png`);
  }
  if (name && sport) {
    const params = new URLSearchParams({ sport, name, v: 'restored-photos-1' });
    if (identity.team?.trim()) params.set('team', identity.team.trim());
    if (providerId) params.set('providerPlayerId', providerId);
    sources.push(`/api/apex/player-artwork?${params}`);
  }
  // The existing backend verifies name/team identity and has its own short
  // negative cache. The local silhouette is only the final network-error state.
  return [...new Set([...sources, unavailablePhoto])];
}
