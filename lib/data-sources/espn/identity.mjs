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
// Club football has no canonical abbreviation table to look up. The feeds post
// the short name a bettor would recognise - "Bristol C", "San Luis", "Rayo" -
// where ESPN carries the registered one: "Bristol City", "Atletico de San
// Luis", "Rayo Vallecano". So the shorter name being contained in the longer is
// the match. This only ever confirms the club of an athlete already resolved by
// an exact, globally unique name, so the worst a loose accept can do is agree
// with a club label - it cannot borrow another player's box score.
export function sameClub(a,b) {
 const x=teamKey(a),y=teamKey(b);
 if(!x||!y)return false;
 if(x===y)return true;
 const [short,long]=x.length<=y.length?[x,y]:[y,x];
 return short.length>=4&&long.includes(short);
}
export function matchesClubRecord(value,record) {
 return [record?.abbreviation,record?.displayName,record?.shortDisplayName,record?.name,
   record?.location&&record?.name?record.location+' '+record.name:null].some(v=>sameClub(value,v));
}
export function matchesTeamRecord(value,record,sport) {
 return [record?.id,record?.abbreviation,record?.displayName,record?.shortDisplayName,record?.name,
   record?.location&&record?.name?record.location+' '+record.name:null].some(v=>samePublicTeam(value,v,sport));
}
const NAME_SUFFIXES=new Set(['jr','sr','ii','iii','iv','v']);
function playerAliasKey(value) {
 const tokens=normalizePlayerName(value).split(/\s+/).filter(Boolean);
 while(tokens.length>2&&NAME_SUFFIXES.has(tokens.at(-1)))tokens.pop();
 return tokens.length>=2?tokens[0]+'|'+tokens.at(-1):null;
}
export function resolvePublicAthlete(payload,{sport,playerName,team,providerPlayerId}={}) {
 sport=canonicalSport(sport);const config=PUBLIC_LEAGUES[sport];if(!config)return null;
 const [family,league]=config,wanted=normalizePlayerName(playerName),wantedAlias=playerAliasKey(playerName);
 const exactCandidates=new Map(),aliasCandidates=new Map();
 if(!wanted)return null;
 for(const group of payload?.results||[]) {
  if(group.type!=='player')continue;
  for(const row of group.contents||[]) {
   if(row.sport!==family||family!=='soccer'&&row.defaultLeagueSlug!==league)continue;
   const rowName=normalizePlayerName(row.displayName),exact=rowName===wanted;
   const alias=!exact&&wantedAlias&&playerAliasKey(row.displayName)===wantedAlias;
   if(!exact&&!alias)continue;
   const path=family==='soccer'?'soccer':league;
   const match=String(row.link?.web||'').match(new RegExp('^https://www\\.espn\\.com/'+path+'/player/_/id/(\\d+)(?:/|$)'));
   if(!match||!String(row.uid||'').endsWith('~a:'+match[1]))continue;
   (exact?exactCandidates:aliasCandidates).set(match[1],{id:match[1],playerName:row.displayName,teamName:row.subtitle||null});
  }
  // A truncated broad search is safe only with an explicit provider-namespaced
  // ID. The caller can retry using a team roster instead of guessing a match.
  if(group.totalFound>(group.contents||[]).length&&!new RegExp('^history:'+sport+':\\d+$').test(String(providerPlayerId||'')))return null;
 }
 // Exact names always win. A first+last alias is used only when the exact
 // provider spelling is absent and resolves uniquely (or uniquely on team).
 // This bridges feeds that include a middle name while ESPN omits it without
 // turning fuzzy/last-name guessing into verified research.
 const candidates=exactCandidates.size?exactCandidates:aliasCandidates;
 if(providerPlayerId&&new RegExp('^history:'+sport+':\\d+$').test(providerPlayerId))return candidates.get(providerPlayerId.split(':').at(-1))||null;
 if(candidates.size===1)return [...candidates.values()][0];
 const scoped=[...candidates.values()].filter(a=>samePublicTeam(team,a.teamName,sport));
 return scoped.length===1?scoped[0]:null;
}
export function resolveRosterAthlete(payload,{playerName,team,sport}={}) {
 const rows=(payload?.athletes||[]).flatMap(g=>Array.isArray(g.items)?g.items:[g]);
 const valid=rows.filter(r=>/^\d+$/.test(String(r.id)));
 const wanted=normalizePlayerName(playerName),aliasKey=playerAliasKey(playerName);
 const exact=valid.filter(r=>normalizePlayerName(r.displayName||r.fullName)===wanted);
 const aliases=exact.length?[]:valid.filter(r=>aliasKey&&playerAliasKey(r.displayName||r.fullName)===aliasKey);
 const matches=exact.length?exact:aliases;
 if(matches.length===1)return {id:String(matches[0].id),playerName:matches[0].displayName||matches[0].fullName,teamName:team?.displayName||null};
 // First+last aliases still fail closed when a roster contains more than one
 // candidate; no last-name or edit-distance guess can borrow another player.
 return null;
}
