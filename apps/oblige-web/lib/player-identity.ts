import { TEAM_IDENTITIES } from './team-identities';

const clean = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/\s+/g,' ');
const league = (sport: string) => ({NFL1H:'NFL',NFL1Q:'NFL',WNBA1H:'WNBA',WNBA1Q:'WNBA',CFB:'NCAAF',CFB1H:'NCAAF',CBB:'NCAAB',MLBLIVE:'MLB',NBASZN:'NBA',NHLSZN:'NHL'} as Record<string,string>)[sport.toUpperCase()] || sport.toUpperCase();
// The same provider aliases used by lib/data-sources/espn/identity.mjs.
const codeAliases: Record<string, Record<string,string>> = {
  NFL:{GNB:'GB',KAN:'KC',NWE:'NE',NOR:'NO',SFO:'SF',TAM:'TB',WSH:'WAS',JAC:'JAX',LA:'LAR'},
  NBA:{NY:'NYK',GS:'GSW',SA:'SAS',NO:'NOP',UTAH:'UTA',WSH:'WAS',PHO:'PHX'},
  WNBA:{NYL:'NY',LVA:'LV',LAS:'LA',PHO:'PHX',CONN:'CON',GSV:'GS',WSH:'WAS'},
  MLB:{SDP:'SD',SFG:'SF',KCR:'KC',TBR:'TB',WAS:'WSH'}, NHL:{LAK:'LA',SJS:'SJ',TBL:'TB',NJD:'NJ'},
  NCAAF:{UCONN:'CONN',UMASS:'MASS',MISSISSIPPI:'MISS',OLEMISS:'MISS',SOUTHERNMISS:'USM'},
  NCAAB:{UCONN:'CONN',UMASS:'MASS',MISSISSIPPI:'MISS',OLEMISS:'MISS'},
  EPL:{MCI:'MNC',MUN:'MAN'},UCL:{MCI:'MNC',MUN:'MAN'},
};
const teams = new Map<string, Map<string, Set<string>>>();
for (const [sport, rows] of Object.entries(TEAM_IDENTITIES)) {
  const labels = new Map<string, Set<string>>();
  for (const [code, name] of rows) {
    const full = clean(name), mascot = full.split(' ').at(-1)!;
    for (const label of [code, name, `${code} ${mascot}`]) {
      const key = clean(label), identities = labels.get(key) || new Set<string>();
      identities.add(full); labels.set(key, identities);
    }
  }
  for (const [alias, canonical] of Object.entries(codeAliases[sport] || {})) {
    const source = labels.get(clean(alias)), target = labels.get(clean(canonical));
    const values = new Set([...(source || []), ...(target || [])]);
    if (values.size !== 1) continue;
    const full = [...values][0], mascot = full.split(' ').at(-1)!;
    for (const code of [alias, canonical]) for (const label of [code, `${code} ${mascot}`]) labels.set(clean(label), values);
  }
  teams.set(sport, labels);
}
/** Catalog aliases are league-scoped; ambiguous abbreviations stay unresolved. */
export function knownTeam(value: unknown, sport: string): string | undefined {
  const candidates = teams.get(league(sport))?.get(clean(value));
  return candidates?.size === 1 ? candidates.values().next().value : undefined;
}
export const knownNflTeam = (value: unknown) => knownTeam(value, 'NFL');
const explicitCode = (value: unknown) => String(value ?? '').trim().match(/^([A-Z0-9]{2,5})(?:\s|$)/)?.[1];

export function sameExplicitTeam(left: unknown, right: unknown, sport: string): boolean {
  if (!clean(left) || !clean(right)) return false;
  if (clean(left) === clean(right)) return true;
  const a = knownTeam(left, sport), b = knownTeam(right, sport);
  if (a && b) return a === b;
  const code = explicitCode(left);
  return Boolean(code && code === explicitCode(right));
}

/** Remove provider decoration only when the game's team metadata verifies it. */
export function researchPlayerName(value: unknown, context: { sport: string; team?: string | null; homeTeam?: string | null; awayTeam?: string | null }): string {
  const original = String(value ?? '').trim();
  const match = original.match(/^(.+?)\s+\(([A-Z0-9]{2,5})\)$/);
  if (!match || match[1].includes('+')) return original;
  const taggedTeam = knownTeam(match[2], context.sport), ownTeam = knownTeam(context.team, context.sport);
  if (context.team && !sameExplicitTeam(context.team, match[2], context.sport)) return original;
  const verified = (taggedTeam && ownTeam === taggedTeam) || [context.team, context.homeTeam, context.awayTeam].some(team => sameExplicitTeam(team, match[2], context.sport));
  return verified ? match[1].trim() : original;
}
