const UA=process.env.AUTOSCOUT_PUBLIC_FEED_USER_AGENT||'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1';
const MAP={NFL:['football','nfl'],NBA:['basketball','nba'],MLB:['baseball','mlb']};
const text=v=>String(v??'').trim();
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const iso=v=>{const d=new Date(v);return Number.isFinite(d.getTime())?d.toISOString():null};

async function json(url,{signal}={}){const r=await fetch(url,{signal,headers:{accept:'application/json','user-agent':UA}});if(!r.ok)throw Object.assign(new Error(`ESPN HTTP ${r.status}`),{status:r.status});return r.json();}
function statsObject(labels=[],values=[]){const o={};for(let i=0;i<Math.max(labels.length,values.length);i++){const key=text(labels[i]?.name||labels[i]?.abbreviation||labels[i]||`stat_${i}`);if(key)o[key]=num(values[i])??text(values[i]);}return o;}

export async function fetchEspnGameLog({sport,playerId,season,seasonType=2,signal}={}){
  const key=text(sport).toUpperCase();const pair=MAP[key];if(!pair||!playerId)return [];
  const qs=new URLSearchParams();if(season)qs.set('season',String(season));if(seasonType)qs.set('seasontype',String(seasonType));
  const url=`https://site.web.api.espn.com/apis/common/v3/sports/${pair[0]}/${pair[1]}/athletes/${encodeURIComponent(playerId)}/gamelog${qs.size?'?'+qs:''}`;
  const data=await json(url,{signal});const playerName=data.athlete?.displayName||data.athlete?.fullName||data.displayName||text(playerId);
  const events=data.events||{};const labelsByCategory=new Map();
  for(const cat of data.categories||[])labelsByCategory.set(text(cat.name||cat.displayName).toLowerCase(),cat.labels||cat.statistics||[]);
  const rows=[];
  const push=(game,category='general',values=[])=>{const gid=text(game?.id||game?.eventId||game?.event?.id);if(!gid)return;rows.push({player_id:text(playerId),game_id:gid,sport:key,player_name:playerName,game_date:iso(game?.gameDate||game?.date||game?.event?.date)||new Date(0).toISOString(),season:text(season||data.season?.year||new Date().getUTCFullYear()),category:key==='MLB'&&/pitch/i.test(category)?'pitching':key==='MLB'&&/bat/i.test(category)?'batting':'general',season_type:Number(seasonType)||2,stats:statsObject(labelsByCategory.get(text(category).toLowerCase())||[],values),source:'ESPN'});};
  if(Array.isArray(events)){for(const g of events){if(Array.isArray(g.stats))push(g,'general',g.stats);else if(g.statistics&&typeof g.statistics==='object'){for(const [cat,v] of Object.entries(g.statistics))push(g,cat,Array.isArray(v)?v:v?.stats||[]);}}}
  else if(events&&typeof events==='object'){for(const [gid,g0] of Object.entries(events)){const g={id:gid,...g0};const stats=g.stats||g.statistics||g.statGroups;if(Array.isArray(stats))push(g,'general',stats);else if(stats&&typeof stats==='object'){for(const [cat,v] of Object.entries(stats))push(g,cat,Array.isArray(v)?v:v?.stats||v?.values||[]);}}}
  if(!rows.length&&Array.isArray(data.gameLog)){for(const g of data.gameLog)push(g,g.category||'general',g.stats||g.statistics||[]);}
  const unique=new Map();for(const r of rows)unique.set(`${r.player_id}|${r.game_id}|${r.category}`,r);return [...unique.values()];
}

export async function resolveEspnAthleteId({name,sport,signal}={}){
  const pair=MAP[text(sport).toUpperCase()];if(!pair||!name)return null;
  const url=`https://site.web.api.espn.com/apis/search/v2?query=${encodeURIComponent(name)}&limit=12&sport=${encodeURIComponent(pair[0])}`;
  const data=await json(url,{signal});const items=data.results||data.items||[];const target=text(name).toLowerCase().replace(/[^a-z0-9]/g,'');
  let best=null;for(const item of items){const obj=item.contents?.[0]||item;const label=text(obj.displayName||obj.name||obj.title);const id=text(obj.id||obj.uid?.split(':').pop()||obj.athlete?.id);if(!id)continue;const norm=label.toLowerCase().replace(/[^a-z0-9]/g,'');if(norm===target)return id;if(!best&&norm.includes(target))best=id;}return best;
}
