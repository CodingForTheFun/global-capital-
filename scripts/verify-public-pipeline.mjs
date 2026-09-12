/** Read-only validation of public history. No paid quotes, account credentials,
 * or live betting recommendations. Thresholds below are test thresholds. */
import fs from 'node:fs/promises';
import { researchPlayerProp } from '../lib/autoscout/research-service-v2.mjs';
const report={kind:'public history integration; test thresholds, not sportsbook recommendations',asOf:new Date().toISOString(),results:[]};
const selections=[
 ['NFL','Jordan Love','player_sacks',2.5],['NFL','Micah Parsons','player_sacks',0.5],
 ['NFL','Brandon McManus','player_kicking_points',5.5],['NFL','Green Bay Packers Defense','team_sacks',2.5],
 ['NBA','Jayson Tatum','player_points',26.5],['WNBA','Caitlin Clark','player_assists',7.5],
 ['MLB','Paul Skenes','pitcher_outs',17.5],['MLB','Shohei Ohtani','batter_total_bases',1.5],
 ['NHL','Connor Hellebuyck','player_total_saves',25.5],['NHL','Connor McDavid','player_shots_on_goal',2.5],
 ['NCAAF','Arch Manning','player_pass_yds',200.5],
 ['MLS','Lionel Messi','player_shots_on_target',1.5],['EPL','Erling Haaland','player_shots',2.5],
 ['UCL','Erling Haaland','player_shots',2.5],
];
// Resolve a currently rostered CBB athlete instead of assuming last season's
// player still belongs to this program. This only reads a public roster.
try{
 const response=await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams/150/roster',{signal:AbortSignal.timeout(15000)});
 const roster=await response.json();const rows=(roster.athletes||[]).flatMap(g=>g.items||[g]);
 for(const player of rows.slice(0,3))if(player.displayName)selections.push(['NCAAB',player.displayName,'player_points',10.5]);
}catch{}
for(const [sport,playerName,providerMarketKey,line] of selections){
 const start=Date.now();
 try{
  const r=await researchPlayerProp({sport,playerName,market:providerMarketKey,providerMarketKey,line,side:'OVER',games:20});
  const output={sport,playerName,market:providerMarketKey,testThreshold:line,available:r.available===true,code:r.code||null,
   elapsedMs:Date.now()-start,season:r.season||null,coverage:r.coverage||null,statKind:r.statKind||null,
   marketDisplayName:r.marketDisplayName||null,player:r.player||null,
   windows:r.windows||null,h2h:r.h2h||null,streak:r.streak||null,diff:r.diff||null,
   recentGames:(r.gameLog||[]).slice(0,3)};
  report.results.push(output);console.log(sport,playerName,providerMarketKey,r.available?'AVAILABLE':r.code,'games',r.gameLog?.length||0,output.elapsedMs+'ms');
 }catch(e){report.results.push({sport,playerName,market:providerMarketKey,available:false,error:e.name});console.log(sport,playerName,e.name);}
}
report.leagues=Object.fromEntries([...new Set(selections.map(s=>s[0]))].map(s=>[s,report.results.some(r=>r.sport===s&&r.available)]));
await fs.mkdir('validation-output',{recursive:true});await fs.writeFile('validation-output/public-history.json',JSON.stringify(report,null,2));
console.log('Verified leagues',JSON.stringify(report.leagues));
// A missing test athlete is not grounds to fabricate a result or delete a test.
// Explicit known source gaps remain recorded; core repair cases must succeed.
const critical=report.results.filter(r=>r.sport==='NFL'||r.market==='pitcher_outs');
if(critical.some(r=>!r.available))process.exitCode=1;
