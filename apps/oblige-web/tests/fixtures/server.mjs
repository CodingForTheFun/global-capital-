// Local-only UI fixture server. Never imported by the application.
import http from 'node:http';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=ts.transpileModule(readFileSync(new URL('./mockPlayerData.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {mockPlayerData,mockDvpData,mockOddsData}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const player='UI Fixture Player';
http.createServer((req,res)=>{const u=new URL(req.url,'http://127.0.0.1');const sport=u.searchParams.get('sport')||'NBA',tennis=/tennis/i.test(sport);let body={ok:true,available:false,message:'No fixture for this optional source.'};
if(u.pathname==='/api/account/me')body={authenticated:true,user:{id:'local-fixture',email:'fixture@example.invalid'}};
if(u.pathname==='/api/apex/props')body={ok:true,props:(tennis?[['Aces',7.5],['Games Won',12.5]]:[['Points',24.5],['Rebounds',8.5],['Assists',4.5]]).flatMap(([market,line])=>['OVER','UNDER'].map(side=>({id:`${market}-${side}`,eventId:'fixture-event',playerName:player,market,line,side,price:-110,sportsbook:'DraftKings',sportsbookKey:'draftkings',team:'BOS',opponent:tennis?'Opponent A':'IND',homeTeam:tennis?'Opponent A':'Indiana Pacers',awayTeam:tennis?player:'Boston Celtics',gameStartTime:'2090-09-21T19:00:00Z'}))),meta:{},supportedSports:['NBA','TENNIS']};
if(u.pathname==='/api/apex/research'){const market=u.searchParams.get('market');body={...mockPlayerData,matchup:{opponent:tennis?'Opponent A':'IND'},gameLog:mockPlayerData.gameLog.map((g,i)=>({...g,opponent:tennis?i%2?'Opponent B':'Opponent A':g.opponent,aces:tennis?4+i%8:undefined,gamesWon:tennis?9+i%9:undefined,value:market==='Rebounds'?g.rebounds:market==='Assists'?g.assists:market==='Aces'?4+i%8:market==='Games Won'?9+i%9:g.points}))};}
if(u.pathname==='/api/apex/research-defense-position')body=mockDvpData;
if(u.pathname==='/api/apex/research-matchup')body=tennis?{available:false,message:'No published prediction for this fixture.'}:mockOddsData;
if(u.pathname==='/api/apex/player-artwork'){res.writeHead(404);res.end();return;}
res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(body));}).listen(4201,'0.0.0.0',()=>console.log('Local fixture backend on 4201'));
