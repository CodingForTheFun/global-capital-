import { TEAMS } from './teams';

const clean = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const nflCodes = 'ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS'.split(' ');
const nflTeams = new Map<string, string>();
for (const code of nflCodes) {
  const full = clean(TEAMS[code].name), mascot = full.split(' ').at(-1)!;
  for (const label of [code, full, `${code} ${mascot}`]) nflTeams.set(clean(label), full);
}

export const knownNflTeam = (value: unknown) => nflTeams.get(clean(value));

// Explicit provider codes are safe across leagues; never infer a city prefix
// or use the NFL roster for another sport's identically abbreviated team.
const explicitCode = (value: unknown) => String(value ?? '').trim().match(/^([A-Z0-9]{2,5})(?:\s|$)/)?.[1];

export function sameExplicitTeam(left: unknown, right: unknown, sport: string): boolean {
  if (!clean(left) || !clean(right)) return false;
  if (clean(left) === clean(right)) return true;
  if (clean(sport) === 'nfl' && knownNflTeam(left)) return knownNflTeam(left) === knownNflTeam(right);
  const code = explicitCode(left);
  return Boolean(code && code === explicitCode(right));
}

/** Remove provider decoration only when the game's team metadata verifies it. */
export function researchPlayerName(value: unknown, context: { sport: string; team?: string | null; homeTeam?: string | null; awayTeam?: string | null }): string {
  const original = String(value ?? '').trim();
  const match = original.match(/^(.+?)\s+\(([A-Z0-9]{2,5})\)$/);
  if (!match || match[1].includes('+')) return original;
  if (clean(context.sport) !== 'nfl') {
    const own = explicitCode(context.team);
    if (context.team && own !== match[2]) return original;
    const verified = own === match[2] || [context.homeTeam, context.awayTeam].some(team => explicitCode(team) === match[2]);
    return verified ? match[1].trim() : original;
  }
  const taggedTeam = knownNflTeam(match[2]);
  if (!taggedTeam) return original;
  const ownTeam = knownNflTeam(context.team);
  if (ownTeam && ownTeam !== taggedTeam) return original;
  const verified = ownTeam === taggedTeam || [context.homeTeam, context.awayTeam].some(team => knownNflTeam(team) === taggedTeam);
  return verified ? match[1].trim() : original;
}
