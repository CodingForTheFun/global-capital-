/** Artwork identities only: never reuse these aliases for prop/history matching. */
const ALIASES: Record<string, string> = {
  FOOTBALL_NFL: 'NFL', AMERICANFOOTBALL_NFL: 'NFL',
  FOOTBALL_NCAAF: 'NCAAF', AMERICANFOOTBALL_NCAAF: 'NCAAF',
  BASKETBALL_NBA: 'NBA', BASKETBALL_WNBA: 'WNBA', BASKETBALL_NCAAB: 'NCAAB',
  BASEBALL_MLB: 'MLB', ICEHOCKEY_NHL: 'NHL', HOCKEY_NHL: 'NHL',
  MLS: 'SOCCER', EPL: 'SOCCER', UCL: 'SOCCER', CFB: 'NCAAF', CBB: 'NCAAB', NCAAM: 'NCAAB',
  SOCCER_USA_MLS: 'SOCCER', SOCCER_EPL: 'SOCCER', SOCCER_UEFA_CHAMPS_LEAGUE: 'SOCCER',
};
const ESPN_PATH: Record<string, string> = {
  NFL: 'nfl', NCAAF: 'college-football', NBA: 'nba', WNBA: 'wnba',
  NCAAB: 'mens-college-basketball', MLB: 'mlb', NHL: 'nhl', SOCCER: 'soccer',
  TENNIS: 'tennis', GOLF: 'golf',
};
export function artworkSport(value: string): string {
  const code = String(value || '').trim().toUpperCase().replace(/^(NFL|NBA|WNBA|NHL|MLB|NCAAF|NCAAB)(?:LIVE|[1-4]H|[1-4]Q|Q[1-4]|H[12])$/, '$1');
  if (code.startsWith('SOCCER_')) return 'SOCCER';
  if (code.startsWith('TENNIS_')) return 'TENNIS';
  return ALIASES[code] || code;
}
export type HeadshotIdentity = {
  sport: string; name: string; team?: string | null; providerPlayerId?: string | null;
};
const escapeXml = (value: string) => value.replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[char] || char));
export function sportFallbackPhoto(value: string): string {
  const code = artworkSport(value) || 'SPORT';
  const safe = escapeXml(code.slice(0, 12));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><title>${safe} logo</title><rect width="128" height="128" rx="64" fill="#0d1928"/><path d="M64 17l34 13v29c0 25-14 42-34 53C44 101 30 84 30 59V30l34-13z" fill="#182c42" stroke="#38506c" stroke-width="3"/><text x="64" y="70" text-anchor="middle" font-family="Arial,sans-serif" font-size="${safe.length > 5 ? 18 : 23}" font-weight="800" fill="#e8f0fb">${safe}</text><text x="64" y="91" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" font-weight="700" letter-spacing="1.3" fill="#86a0bc">SPORT</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
// Backward-compatible neutral fallback for any older caller that imports it.
export const unavailablePhoto = sportFallbackPhoto('SPORT');
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
    const url = `https://a.espncdn.com/i/headshots/${ESPN_PATH[sport]}/players/full/${id}.png`;
    sources.push(`/_next/image?${new URLSearchParams({ url, w: '128', q: '75' })}`);
  }
  // Native IDs are accepted only with an explicit namespace; raw numbers are
  // deliberately never reinterpreted as a different provider's athlete.
  const native = /^(mlb|mlbam|nba|wnba):([1-9]\d{0,10})$/i.exec(providerId);
  if (name && native) {
    const namespace = native[1].toLowerCase(), nativeId = native[2];
    const url = sport === 'MLB' && (namespace === 'mlb' || namespace === 'mlbam')
      ? `https://img.mlbstatic.com/mlb-photos/image/upload/w_256,q_auto:good,f_auto/v1/people/${nativeId}/headshot/67/current`
      : ((sport === 'NBA' && namespace === 'nba') || (sport === 'WNBA' && namespace === 'wnba'))
        ? `https://cdn.nba.com/headshots/nba/latest/1040x760/${nativeId}.png` : null;
    if (url) sources.push(`/_next/image?${new URLSearchParams({ url, w: '128', q: '75' })}`);
  }
  if (name && sport) {
    const raw = String(identity.sport || '').trim().toUpperCase();
    // Artwork only: the exact player name is verified within soccer; no history alias.
    const resolverSport = sport === 'SOCCER'
      ? (raw === 'MLS' || raw === 'SOCCER_USA_MLS' ? 'MLS' : raw === 'UCL' || raw === 'SOCCER_UEFA_CHAMPS_LEAGUE' ? 'UCL' : 'EPL') : sport;
    const params = new URLSearchParams({ sport: resolverSport, name, v: 'player-cards-2' });
    if (identity.team?.trim()) params.set('team', identity.team.trim());
    if (providerId) params.set('providerPlayerId', providerId);
    sources.push(`/api/apex/player-artwork?${params}`);
  }
  return [...new Set([...sources, sportFallbackPhoto(sport)])];
}
