// Child-process fixture only. Never imported by production.
process.env.THE_ODDS_API_KEY='fixture-not-live';
process.env.AUTOSCOUT_INGEST_ENABLED='false';process.env.AUTOSCOUT_DISABLE_SPORTSDATAIO='true';
const {fetchBoard}=await import('../lib/autoscout/providers/the-odds-api.mjs');
const {writeCachedBoard}=await import('../lib/autoscout/runtime-store.mjs');
const event={id:'fixture-event',commence_time:'2099-01-01T00:00:00Z',home_team:'Home',away_team:'Away'};
globalThis.fetch=async url=>{
 const u=new URL(url);
 if(u.hostname!=='api.the-odds-api.com')throw new Error('Unexpected fixture network');
 if(u.pathname.endsWith('/events'))return Response.json([event]);
 if(u.pathname.endsWith('/markets'))return Response.json({bookmakers:[{key:'draftkings',markets:[{key:'player_points'}]}]});
 return Response.json({...event,bookmakers:[{key:'draftkings',title:'DraftKings',markets:[{key:'player_points',last_update:'2026-09-13T12:00:00Z',outcomes:[{name:'Over',description:'Fixture Player',point:5.5,price:-110},{name:'Under',description:'Fixture Player',point:5.5,price:-105}]}]}]});
};
for(const sport of ['NFL','MLB']){
 const board=await fetchBoard(sport,{force:true});
 if(sport==='MLB')board.props=Array.from({length:23000},(_,i)=>({...board.props[i%2],id:'fixture-'+i,playerName:'Fixture '+Math.floor(i/2),playerId:'fixture-player-'+Math.floor(i/2)}));
 const now=Date.now;Date.now=()=>now()-60000;await writeCachedBoard(sport,board,30);Date.now=now;
}
globalThis.fetch=async()=>new Response('{}',{status:429,headers:{'retry-after':'60'}});
