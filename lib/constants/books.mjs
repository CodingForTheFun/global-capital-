/** Shared by the Node 20 ingestion service and native browser client. Registry
 * membership describes selector support, never a claim of current feed coverage. */
export const BOOKS = Object.freeze([
 ['prizepicks','PrizePicks','dfs','#8B5CF6'],['underdog','Underdog','dfs','#FACC15'],
 ['sleeper','Sleeper','dfs','#5EEAD4'],['dabble','Dabble','dfs','#A78BFA'],
 ['fliff','Fliff','sweepstakes','#60A5FA'],['betr','Betr','dfs','#EF4444'],
 ['parlayplay','ParlayPlay','dfs','#FB923C'],['dk_pick6','DK Pick6','dfs','#4ADE80'],
 ['kalshi','Kalshi','exchange','#34D399'],['polymarket','Polymarket','exchange','#60A5FA'],
 ['novig','Novig','exchange','#A3E635'],['prophetx','ProphetX','exchange','#2DD4BF'],
 ['draftkings','DraftKings','sportsbook','#4ADE80'],['fanduel','FanDuel','sportsbook','#38BDF8'],
 ['caesars','Caesars','sportsbook','#D4AF37'],['bet365','Bet365','sportsbook','#34D399'],
 ['betmgm','BetMGM','sportsbook','#D4AF37'],['betrivers','BetRivers','sportsbook','#FBBF24'],
 ['hardrock','Hard Rock','sportsbook','#C084FC'],['fanatics','Fanatics','sportsbook','#F87171'],
 ['pinnacle','Pinnacle','sportsbook','#FB923C'],['rebet','Rebet','sweepstakes','#F472B6'],
 ['courtside','Courtside','sweepstakes','#22D3EE'],['boag','BOAG','sportsbook','#A78BFA'],
 ['bvda','BVDA','sportsbook','#F87171'],
].map(([id,name,type,badgeColor])=>Object.freeze({id,name,type,badgeColor})));
const slug=value=>String(value??'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases=new Map(BOOKS.flatMap(b=>[[slug(b.id),b.id],[slug(b.name),b.id]]));
for(const [alias,id] of Object.entries({underdogfantasy:'underdog',draftkingspick6:'dk_pick6',pick6:'dk_pick6',williamhillus:'caesars',hardrockbet:'hardrock',hardrockbetus:'hardrock',bovada:'bvda',betonlineag:'boag',prophet:'prophetx'}))aliases.set(alias,id);
export function bookId(value){return aliases.get(slug(value))||String(value??'').trim().toLowerCase();}
export function bookInfo(value){const id=bookId(value);return BOOKS.find(b=>b.id===id)||{id,name:String(value||id),type:'sportsbook',badgeColor:'#94A3B8'};}
/** null is all current/future books; [] deliberately means none. */
export function bookSelection(value){return Array.isArray(value)?[...new Set(value.filter(v=>typeof v==='string'&&v.trim()).map(bookId))]:null;}
export function bookEnabled(row,selection){return selection===null||selection.includes(bookId(row.sportsbookKey||row.bookmakerKey||row.book_id||row.sportsbook));}
export function filterBookGroups(groups,selection){return groups.map(g=>({...g,rows:g.rows.filter(r=>bookEnabled(r,selection)),...(g.comparisonOffers?{comparisonOffers:g.comparisonOffers.filter(r=>bookEnabled(r,selection))}:{})})).filter(g=>g.rows.length);}
