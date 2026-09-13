// Deliberately illustrative fixtures. These are NOT live lines, actual game logs,
// current rosters, scheduled events or recommendations. Never label them live.
import type { Selection } from '../lib/domain';
export type Market = {group:'Spread'|'Moneyline'|'Totals'; label:string; price:number; side:'a'|'b'};
export type Game = {id:string;sport:string;away:string;home:string;awayCode:string;homeCode:string;time:string;book:string;markets:Market[]};
const markets=(a:string,b:string,spread:number,total:number,mlA:number,mlB:number):Market[]=>[
 {group:'Spread',label:`${a} ${spread>0?'+':''}${spread}`,price:-110,side:'a'}, {group:'Spread',label:`${b} ${-spread>0?'+':''}${-spread}`,price:-110,side:'b'},
 {group:'Moneyline',label:`${a} ML`,price:mlA,side:'a'}, {group:'Moneyline',label:`${b} ML`,price:mlB,side:'b'},
 {group:'Totals',label:`Over ${total}`,price:-110,side:'a'}, {group:'Totals',label:`Under ${total}`,price:-110,side:'b'}];
export const games:Game[]=[
 {id:'bos-nyk',sport:'NBA',away:'Boston Celtics',home:'New York Knicks',awayCode:'BOS',homeCode:'NYK',time:'7:30 PM',book:'A',markets:markets('BOS','NYK',-6.5,225.5,-250,200)},
 {id:'lal-dal',sport:'NBA',away:'Los Angeles Lakers',home:'Dallas Mavericks',awayCode:'LAL',homeCode:'DAL',time:'8:30 PM',book:'B',markets:markets('LAL','DAL',-3.5,229.5,-165,140)},
 {id:'den-phx',sport:'NBA',away:'Denver Nuggets',home:'Phoenix Suns',awayCode:'DEN',homeCode:'PHX',time:'9:00 PM',book:'A',markets:markets('DEN','PHX',-2.5,228.5,-140,120)},
 {id:'gsw-sac',sport:'NBA',away:'Golden State Warriors',home:'Sacramento Kings',awayCode:'GSW',homeCode:'SAC',time:'10:00 PM',book:'B',markets:markets('GSW','SAC',-4.5,236.5,-190,160)},
 {id:'buf-mia',sport:'NFL',away:'Buffalo Bills',home:'Miami Dolphins',awayCode:'BUF',homeCode:'MIA',time:'1:00 PM',book:'A',markets:markets('BUF','MIA',-3.5,47.5,-180,155)},
 {id:'kc-bal',sport:'NFL',away:'Kansas City Chiefs',home:'Baltimore Ravens',awayCode:'KC',homeCode:'BAL',time:'4:25 PM',book:'B',markets:markets('KC','BAL',1.5,45.5,110,-130)},
 {id:'lad-nyy',sport:'MLB',away:'Los Angeles Dodgers',home:'New York Yankees',awayCode:'LAD',homeCode:'NYY',time:'7:05 PM',book:'A',markets:markets('LAD','NYY',-1.5,8.5,-130,110)},
];
export type PlayerProp = {id:string;eventId:string;sport:string;name:string;team:string;opponent:string;stat:string;short:string;line:number;over:number;under:number;values:number[];time:string};
export const props:PlayerProp[]=[
 {id:'tatum',eventId:'bos-nyk',sport:'NBA',name:'Jayson Tatum',team:'BOS',opponent:'NYK',stat:'Points',short:'PTS',line:26.5,over:-110,under:-110,values:[24,30,22,29,33,31,29,24,35,28],time:'7:30 PM'},
 {id:'edwards',eventId:'min-okc',sport:'NBA',name:'Anthony Edwards',team:'MIN',opponent:'OKC',stat:'Points',short:'PTS',line:25.5,over:-115,under:-105,values:[19,34,28,20,27,27,22,31,26,23],time:'8:00 PM'},
 {id:'sabonis',eventId:'gsw-sac',sport:'NBA',name:'Domantas Sabonis',team:'SAC',opponent:'GSW',stat:'Rebounds',short:'REB',line:12.5,over:-120,under:-100,values:[12,17,10,13,15,14,15,11,13,16],time:'10:00 PM'},
 {id:'jokic',eventId:'den-phx',sport:'NBA',name:'Nikola Jokic',team:'DEN',opponent:'PHX',stat:'Assists',short:'AST',line:9.5,over:-110,under:-110,values:[11,8,12,10,7,11,8,10,13,9],time:'9:00 PM'},
 {id:'curry',eventId:'gsw-sac',sport:'NBA',name:'Stephen Curry',team:'GSW',opponent:'SAC',stat:'Threes',short:'3PM',line:4.5,over:110,under:-130,values:[3,7,4,5,6,4,6,3,5,7],time:'10:00 PM'},
 {id:'allen',eventId:'buf-mia',sport:'NFL',name:'Josh Allen',team:'BUF',opponent:'MIA',stat:'Pass Yards',short:'PASS YDS',line:252.5,over:-110,under:-110,values:[230,298,254,211,286,281,247,301,218,264],time:'1:00 PM'},
 {id:'mahomes',eventId:'kc-bal',sport:'NFL',name:'Patrick Mahomes',team:'KC',opponent:'BAL',stat:'Pass Yards',short:'PASS YDS',line:265.5,over:-115,under:-105,values:[254,300,212,301,282,288,242,279,310,250],time:'4:25 PM'},
 {id:'judge',eventId:'lad-nyy',sport:'MLB',name:'Aaron Judge',team:'NYY',opponent:'LAD',stat:'Total Bases',short:'TB',line:1.5,over:105,under:-125,values:[2,0,4,1,2,2,1,4,0,3],time:'7:05 PM'},
];
export const selectionFor=(game:Game,m:Market):Selection=>({id:`${game.id}:${m.group}:${m.side}`,eventId:game.id,label:m.label,matchup:`${game.awayCode} @ ${game.homeCode}`,market:m.group,price:m.price,sport:game.sport});
export const propSelection=(prop:PlayerProp,side:'OVER'|'UNDER'):Selection=>({id:`prop:${prop.id}:${side}`,eventId:prop.eventId,label:`${prop.name} ${side==='OVER'?'Over':'Under'} ${prop.line}`,matchup:`${prop.team} @ ${prop.opponent}`,market:prop.stat,price:side==='OVER'?prop.over:prop.under,sport:prop.sport});
