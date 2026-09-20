import { TEAMS } from './teams';

const clean = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const nflCodes = 'ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS'.split(' ');
const nflTeams = new Map<string, string>();
for (const code of nflCodes) {
  const full = clean(TEAMS[code].name), mascot = full.split(' ').at(-1)!;
  for (const label of [code, full, `${code} ${mascot}`]) nflTeams.set(clean(label), full);
}

export const knownNflTeam = (value: unknown) => nflTeams.get(clean(value));

/** Remove provider decoration only when the game's team metadata verifies it. */
export function researchPlayerName(value: unknown, context: { sport: string; team?: string | null; homeTeam?: string | null; awayTeam?: string | null }): string {
  const original = String(value ?? '').trim();
  const match = original.match(/^(.+?)\s+\(([A-Z]{2,3})\)$/);
  if (clean(context.sport) !== 'nfl' || !match || match[1].includes('+')) return original;
  const taggedTeam = knownNflTeam(match[2]);
  if (!taggedTeam) return original;
  const ownTeam = knownNflTeam(context.team);
  if (ownTeam && ownTeam !== taggedTeam) return original;
  const verified = ownTeam === taggedTeam || [context.homeTeam, context.awayTeam].some(team => knownNflTeam(team) === taggedTeam);
  return verified ? match[1].trim() : original;
}
