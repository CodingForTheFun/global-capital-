/** Explicitly synthetic, localhost-only QA harness. Not referenced by production. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeResearch } from '../lib/analytics/research.mjs';
import { projectedStat } from '../lib/projections/stat-estimate.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function startIntelligenceFixture() {
 let revision=0; const requests=[];
 const makeBase=(sport='NBA',noLogs=false)=>{
  const now=Date.now();const values=[28,32,19,24,35,26,22,30,18,27,31,23,26,29,24,21,33,27,26,20,25,30,22,28];
  const base={available:!noLogs,player:{playerName:'QA Fixture Guard',providerPlayerId:'qa-only-player',sport},sport,season:2026,matchup:{opponent:'NYK'},line:25.5,side:'OVER',coverage:{seasonComplete:false},
   context:{injuryStatus:'Questionable (QA fixture)',lineupVerified:true,starter:true},
   gameLog:noLogs?[]:values.map((v,i)=>({value:sport==='NFL'?v*8:v,gameId:`qa-only-${i}`,date:new Date(now-(i+1)*86400e3).toISOString(),season:2026,seasonType:2,opponent:i%3?'NYK':'BOS',isHome:i%2===0,minutes:30+i%4,
    teammateParticipation:[{playerId:'qa-only-mate',playerName:'QA Fixture Teammate',verified:true,played:i%3!==0}]}))};
  base.projectedStat=projectedStat(base);return base;
 };
 const board=sport=>{
  const props=[];
  for(let p=0;p<3;p++)for(const [i,book] of ['prizepicks','underdog','fanduel'].entries())for(const side of ['OVER','UNDER'])props.push({id:`qa-${sport}-${p}-${i}-${side}`,eventId:'qa-event',playerId:`qa-player-${p}`,playerName:['QA Fixture Guard','QA Fixture Wing','QA No History'][p],sport,entityType:'player',marketId:sport==='NFL'?'player_pass_yds':'player_points',market:sport==='NFL'?'Passing yards':'Points',homeTeam:'QA Home',awayTeam:'QA Away',team:'BOS',gameStartTime:new Date(Date.now()+3600e3).toISOString(),line:(sport==='NFL'?200.5:25.5)+i+revision,price:-110,side,sportsbookKey:book,sportsbook:{prizepicks:'PrizePicks',underdog:'Underdog',fanduel:'FanDuel'}[book],providerUpdatedAt:new Date().toISOString()});
  return {props,data:{players:[],lines:props.map(p=>({id:p.id,propId:'qa-prop-'+p.playerId}))},meta:{events:1,sportsbookCount:3,complete:true,fetchedAt:new Date().toISOString()}};
 };
 const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost'),p=u.pathname;requests.push(p);
  const send=(body,status=200,type='application/json')=>{res.writeHead(status,{'content-type':type});res.end(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body));};
  if(p==='/apex'||p==='/')return send('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>QA fixture only</title></head><body><script src="/ui.js"></script></body></html>',200,'text/html');
  const files={'/ui.js':'apex-v2/scout-ui-v5.js','/assets/autoscout-research.css':'apex-v2/research-ui.css','/assets/autoscout-intelligence.css':'apex-v2/intelligence.css'};
  const file=files[p]||(p.startsWith('/assets/lib/')?p.slice('/assets/'.length):null);
  if(file&&!file.includes('..')&&fs.existsSync(path.join(root,file)))return send(fs.readFileSync(path.join(root,file)),200,file.endsWith('.css')?'text/css':'text/javascript');
  if(p==='/__qa/advance'){revision++;return send({ok:true});}
  if(p==='/api/apex/props')return send(board(u.searchParams.get('sport')||'NBA'));
  const research=args=>{const b=makeBase(args.sport,args.playerName==='QA No History');return {...analyzeResearch(b,Number(args.line),args.side),projectedStat:b.projectedStat};};
  if(p==='/api/apex/research-batch'){let body='';for await(const chunk of req)body+=chunk;const data=JSON.parse(body);return send({ok:true,results:Object.fromEntries(data.props.map(x=>[x.key,research(x)]))});}
  if(p==='/api/apex/research')return send(research(Object.fromEntries(u.searchParams)));
  if(p==='/api/apex/line-history')return send({configured:true,rows:[0,1,2].map((x)=>({prop_id:u.searchParams.get('propId'),bookmaker_key:u.searchParams.get('bookmaker'),side:u.searchParams.get('side'),line:24.5+x,price:-110,created_at:new Date(Date.now()-(3-x)*3600e3).toISOString()}))});
  if(p==='/api/account/me')return send({authenticated:true,user:{id:'qa-account',email:'fixture@example.invalid'}});
  if(p==='/api/account/health')return send({ok:true,password:{available:true}});
  if(p==='/api/saved-props')return send({saved:[],profile:{kind:'account',id:'qa-account'}});
  if(p==='/api/apex/player-artwork')return send('',404,'image/png');
  if(p.startsWith('/api/'))return send({ok:true,available:false});
  return send({},404);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {server,origin:`http://127.0.0.1:${server.address().port}`,requests};
}
if(process.argv.includes('--serve')){const {origin}=await startIntelligenceFixture();console.log(origin);}
