import { normalizePlayerName } from '../contract.mjs';
import { PUBLIC_LEAGUES, canonicalSport } from './stat-contract.mjs';
export const teamKey = value => String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/^(nfl|nba|wnba|mlb|nhl|ncaaf|ncaab|mls|epl|ucl)[_:-]/i,'')
  .replace(/\s+(?:defense|defence|d\/st|defensive unit)$/i,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const ALIASES={
 NFL:{GNB:'GB',KAN:'KC',NWE:'NE',NOR:'NO',SFO:'SF',TAM:'TB',WSH:'WAS',JAC:'JAX',LA:'LAR'},
 NBA:{NY:'NYK',GS:'GSW',SA:'SAS',NO:'NOP',UTAH:'UTA',WSH:'WAS',PHO:'PHX'},
 WNBA:{NYL:'NY',LVA:'LV',LAS:'LA',PHO:'PHX',CONN:'CON',GSV:'GS',WSH:'WAS'},
 MLB:{SDP:'SD',SFG:'SF',KCR:'KC',TBR:'TB',WAS:'WSH'}, NHL:{LAK:'LA',SJS:'SJ',TBL:'TB',NJD:'NJ'},
 NCAAF:{UCONN:'CONN',UMASS:'MASS',MISSISSIPPI:'MISS',OLEMISS:'MISS',SOUTHERNMISS:'USM'},
 NCAAB:{UCONN:'CONN',UMASS:'MASS',MISSISSIPPI:'MISS',OLEMISS:'MISS'},
 EPL:{MCI:'MNC',MUN:'MAN',TOT:'TOT'},UCL:{MCI:'MNC',MUN:'MAN'},
};
export function samePublicTeam(a,b,sport) {
 const aliases=ALIASES[canonicalSport(sport)]||{};const clean=v=>aliases[teamKey(v)]||teamKey(v);
 return Boolean(clean(a)&&clean(b)&&clean(a)===clean(b));
}
export function matchesTeamRecord(value,record,sport) {
 return [record?.id,record?.abbreviation,record?.displayName,record?.shortDisplayName,record?.name,
   record?.location&&record?.name?record.location+' '+record.name:null].some(v=>samePublicTeam(value,v,sport));
}
export function resolvePublicAthlete(payload,{sport,playerName,team,providerPlayerId}={}) {
 sport=canonicalSport(sport);const config=PUBLIC_LEAGUES[sport];if(!config)return null;
 const [family,league]=config,wanted=normalizePlayerName(playerName),candidates=new Map();
 if(!wanted)return null;
 for(const group of payload?.results||[]) {
  if(group.type!=='player')continue;
  for(const row of group.contents||[]) {
   if(row.sport!==family||family!=='soccer'&&row.defaultLeagueSlug!==league||normalizePlayerName(row.displayName)!==wanted)continue;
   const path=family==='soccer'?'soccer':league;
   const match=String(row.link?.web||'').match(new RegExp('^https://www\\.espn\\.com/'+path+'/player/_/id/(\\d+)(?:/|$)'));
   if(!match||!String(row.uid||'').endsWith('~a:'+match[1]))continue;
   candidates.set(match[1],{id:match[1],playerName:row.displayName,teamName:row.subtitle||null});
  }
  // A truncated broad search is safe only with an explicit provider-namespaced
  // ID. The caller can retry using a team roster instead of guessing a match.
  if(group.totalFound>(group.contents||[]).length&&!new RegExp('^history:'+sport+':\\d+$').test(String(providerPlayerId||'')))return null;
 }
 if(providerPlayerId&&new RegExp('^history:'+sport+':\\d+$').test(providerPlayerId))return candidates.get(providerPlayerId.split(':').at(-1))||null;
 if(candidates.size===1)return [...candidates.values()][0];
 const scoped=[...candidates.values()].filter(a=>samePublicTeam(team,a.teamName,sport));
 return scoped.length===1?scoped[0]:null;
}
export function resolveRosterAthlete(payload,{playerName,team,sport}={}) {
 const rows=(payload?.athletes||[]).flatMap(g=>Array.isArray(g.items)?g.items:[g]);
 const exact=rows.filter(r=>/^\d+$/.test(String(r.id))&&normalizePlayerName(r.displayName||r.fullName)===normalizePlayerName(playerName));
 if(exact.length===1)return {id:String(exact[0].id),playerName:exact[0].displayName||exact[0].fullName,teamName:team?.displayName||null};
 // No last-name or low-confidence edit-distance guesses: ambiguous names must
 // never silently borrow a teammate's box score.
 return null;
}
