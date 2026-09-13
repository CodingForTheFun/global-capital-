from pathlib import Path
import hashlib
root=Path.cwd()
expected={
'apex-v2/scout-ui-v5.js':'5a9c7ad02218dfd65bf7324a9fbe1bb5e57ec1b59a13a990823e60a24da800c7',
'frontdoor-prod.mjs':'d8fdddc29845526b026cf7a3e5c28fa6ffb8f3e382c1e5f8640be56c82e28c01',
'apex-v2/research-ui.css':'dd0b8bf7b542a9d10d5a8be405092de0da95807922afc45e3bae74ddf43d0355',
'lib/data-sources/espn/stat-contract.mjs':'c0195fa1f13b3349e2b9aae06dc2a5375afe93063720b586142919fea09d1f13',
'lib/data-sources/espn/research.mjs':'bae83f974b7970905a7e978becd04678839f3330041b025436d23d58fb5a5396',
'lib/autoscout/research-service-v2.mjs':'fadcd46a46f079817c3cb6f5cc6a9c7e352d0d29858ecf975cc4d97c2aed6405',
'scripts/qa-multisport-browser.mjs':'1dcb22d5d0d397eb006a420f2a66259b8b13758cd5eaac19c7c4011285813edf'}
for name,digest in expected.items():
 assert hashlib.sha256((root/name).read_bytes()).hexdigest()==digest,'Source moved: '+name
p=root/'apex-v2/scout-ui-v5.js';s=p.read_text()
def replace(old,new):
 global s
 assert s.count(old)==1,(old[:100],s.count(old))
 s=s.replace(old,new)
replace('var nativeFetch=window.fetch.bind(window);',"var nativeFetch=window.fetch.bind(window);\nvar {propType,playerCardKey,categoryOptions,uniquePlayerCards,dedupeOffers}=await import('/assets/lib/ui/prop-board.mjs');\nvar playerChoices=new Map();")
replace("function artUrl(g){return '/api/apex/player-artwork?sport='+encodeURIComponent(g.sport)+'&name='+encodeURIComponent(g.playerName);}","function artUrl(g){return '/api/apex/player-artwork?'+new URLSearchParams({v:'2',sport:g.sport,name:g.playerName,team:g.team||'',providerPlayerId:g.providerPlayerId||''});}")
replace('return Array.from(m.values());}\nfunction books(g)',"return Array.from(m.values()).map(function(g){return {...g,market:propType(g),rows:dedupeOffers(g.rows)};});}\nfunction books(g)")
replace('<section class="asFilters" aria-label="Filter player props">','<nav id="asPropTypes" class="asPropTypes" aria-label="Prop types"></nav>\n <section class="asFilters" aria-label="Filter player props">')
replace("'<option value=\"all\">All markets</option>'","'<option value=\"all\">All players · grouped props</option>'")
replace('function visible(ignoreResearch=false){','''function cardList(ignoreResearch=false){return uniquePlayerCards(visible(ignoreResearch),playerChoices);}
function renderPropTypes(){
 var host=document.getElementById('asPropTypes');if(!host)return;
 var options=categoryOptions(viewGroups(),sport);
 host.innerHTML='<button class="asTypeChip '+(marketFilter==='all'?'on':'')+'" data-prop-type="all" aria-pressed="'+(marketFilter==='all')+'">All players <small>grouped</small></button>'+options.map(function(c){return '<button class="asTypeChip '+(marketFilter===c.label?'on':'')+'" data-prop-type="'+esc(c.label)+'" aria-pressed="'+(marketFilter===c.label)+'">'+esc(c.label)+' <small>'+c.count+'</small></button>';}).join('');
 host.querySelectorAll('[data-prop-type]').forEach(function(b){b.onclick=function(){marketFilter=b.dataset.propType;page=1;renderControls();renderList();};});
}
function playerChoiceControl(g){
 var choices=g.playerChoices||[];if(choices.length<2)return '';
 return '<label class="asPlayerChoice">'+(marketFilter==='all'?'Prop / game':'Game')+'<select data-card-choice="'+esc(playerCardKey(g))+'" aria-label="Select prop or game for '+esc(g.playerName)+'">'+choices.map(function(c){return '<option value="'+esc(c.key)+'" '+(c.key===g.key?'selected':'')+'>'+esc(c.market+' · '+when(c.gameStartTime)+' · '+c.awayTeam+' @ '+c.homeTeam)+'</option>';}).join('')+'</select><small>'+choices.length+' selections · one player card</small></label>';
}
function visible(ignoreResearch=false){''')
replace("['open','fav','side','window','filter','gameDetail','sort']","['open','fav','side','window','filter','gameDetail','sort','cardChoice']")
replace('[data-game-detail],[data-sort]','[data-game-detail],[data-sort],[data-card-choice]')
replace(' return \'<div class="asBadges" title=', ''' if((r&&!r.available)||(!r&&hydrateFailed))return '<div class="asHistoryGap" role="status"><b>'+esc(researchState(r))+'</b><span>'+esc(r?.message||'This exact statistic has no verified history. The listed lines are still available.')+'</span></div>';
 return '<div class="asBadges" title=''')
replace("+'<div class=\"asCardMarket\">'+esc(marketLabel)","+playerChoiceControl(g)+'<div class=\"asCardMarket\">'+esc(marketLabel)")
replace('<img loading="lazy" src="\'+esc(artUrl(g))+\'" alt="">','<img loading="lazy" decoding="async" data-player-photo src="\'+esc(artUrl(g))+\'" alt="\'+esc(g.playerName)+\'"> ')
replace('function bindRows(){','''function bindRows(){
 document.querySelectorAll('[data-player-photo]').forEach(img=>{img.onerror=()=>{img.hidden=true;img.parentElement.title='Photo unavailable for '+img.alt;};});
 document.querySelectorAll('[data-card-choice]').forEach(select=>{select.onclick=e=>e.stopPropagation();select.onkeydown=e=>e.stopPropagation();select.onchange=e=>{e.stopPropagation();playerChoices.set(select.dataset.cardChoice,select.value);renderListLight();};});''')
replace('var shown=visible(),candidates=shown.slice','var shown=cardList(),candidates=shown.slice')
replace('candidates=candidates.concat(visible(true));','candidates=candidates.concat(cardList(true));')
replace('candidates=visible(true).slice','candidates=cardList(true).slice')
replace('var generation=loadGeneration,selected=sport,controller=new AbortController();','var jobs=targets.map(g=>({g,key:hydrateKeyFor(g),line:boardLine(g),side:defaultSide(g)}));\n var generation=loadGeneration,selected=sport,controller=new AbortController();')
replace('targets.map(function(g,index){var line=boardLine(g),side=defaultSide(g);','jobs.map(function(job,index){var {g,line,side}=job;')
replace('targets.forEach(function(g,index){\n   var key=hydrateKeyFor(g),out=','jobs.forEach(function(job,index){\n   var g=job.g,key=job.key,out=')
replace('targets.forEach(function(g){hydratePending.delete(hydrateKeyFor(g));});','jobs.forEach(function(job){hydratePending.delete(job.key);});')
replace('retry=hydrateFailed||visible().some','retry=hydrateFailed||cardList().some')
replace("var list=document.getElementById('asList'),a=visible(),","renderPropTypes();\n var list=document.getElementById('asList'),a=cardList(),")
replace("a.length+' markets · '","a.length+' players · '+(marketFilter==='all'?'grouped props':marketFilter)+' · '")
replace('if(generation!==loadGeneration)return;loading=false;reshuffleBoard();',"if(generation!==loadGeneration)return;loading=false;var availableTypes=categoryOptions(groups(),sport);if(marketFilter!=='all'&&!availableTypes.some(c=>c.label===marketFilter))marketFilter='all';if(marketFilter==='all'&&!readStored('autoscout-categories-v2-'+sport,false)&&availableTypes.length){marketFilter=availableTypes[0].label;storeLocal('autoscout-categories-v2-'+sport,true);}reshuffleBoard();")
replace("var drawerImg=document.getElementById('asDrawerImg');drawerImg.hidden=g.entityType==='team';","var drawerImg=document.getElementById('asDrawerImg');drawerImg.alt=g.playerName;drawerImg.onerror=()=>{drawerImg.hidden=true;};drawerImg.hidden=g.entityType==='team';")
replace('— means the connected feeds returned no usable value. 0G means no previous meeting with this opponent. Pushes are excluded from hit rates.','Browse by prop type. Each player appears once; use the card selector to switch props or games. Statistics use verified game logs only. N/A means no verified sample for that split; it is not zero.')
p.write_text(s)
p=root/'frontdoor-prod.mjs';s=p.read_text()
s=s.replace("import { playerArtworkResponse } from './lib/autoscout/providers/thesportsdb-artwork.mjs';","import { verifiedPlayerArtworkResponse as playerArtworkResponse } from './lib/autoscout/providers/verified-artwork.mjs';")
s=s.replace("'lib/analytics/research.mjs', 'lib/analytics/rolling.mjs',","'lib/ui/prop-board.mjs', 'lib/analytics/research.mjs', 'lib/analytics/rolling.mjs',")
s=s.replace('if (!ARTWORK_SPORTS.has(sport) || !name)','if (!RESEARCH_SPORTS.has(sport) || !name)')
s=s.replace('const image = await playerArtworkResponse(sport, name);',"const image = await playerArtworkResponse(sport, name, {team:String(url.searchParams.get('team')||'').slice(0,90),providerPlayerId:String(url.searchParams.get('providerPlayerId')||'').slice(0,48)});")
s=s.replace("'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',","'cache-control': image.cacheControl || 'public, max-age=30',\n      'x-artwork-status': image.verified ? 'verified' : 'unavailable',")
p.write_text(s)
p=root/'apex-v2/research-ui.css';p.write_text(p.read_text()+'''
/* Prop categories and one-card-per-player presentation. */
.asPropTypes{display:flex;gap:8px;overflow-x:auto;padding:4px 0 14px;scrollbar-width:thin;max-width:100%}
.asTypeChip{flex-shrink:0;border:1px solid var(--line,#25334c);border-radius:9px;padding:10px 13px;background:#101a29;color:#c8d6eb;cursor:pointer;font:inherit;font-size:12px;min-height:42px;white-space:nowrap}
.asTypeChip.on{background:#13392e;border-color:#33e49b;color:#b8ffe0}.asTypeChip small{opacity:.72;margin-left:6px}.asTypeChip:focus-visible,.asPlayerChoice select:focus-visible{outline:2px solid #5ea1ff;outline-offset:2px}
.asPlayerChoice{display:grid;gap:4px;margin:9px 0;color:#9cb0c9;font-size:11px;max-width:100%;min-width:0}.asPlayerChoice select{width:100%;max-width:100%;min-width:0;background:#0c1624;border:1px solid #354962;color:#e9f2ff;border-radius:7px;min-height:38px;padding:5px;font:inherit}.asPlayerChoice small{font-size:10px;opacity:.8}
.asHistoryGap{border-top:1px solid #29384e;padding:14px 16px;display:grid;gap:5px;font-size:12px;color:#9fb0c8}.asHistoryGap b{color:#dfc58e}.asHistoryGap span{line-height:1.5}.asAvatar img[hidden]{display:none}.asCardId{min-width:0}
''')
p=root/'lib/data-sources/espn/stat-contract.mjs';s=p.read_text()
s=s.replace("PassingAttempts:['passingAttempts'","PassingLongestCompletion:['longPassing','longestPassCompletion'], RushingLongest:['longRushing','longestRush'], ReceivingLongest:['longReception','longReceiving','longestReception'], DefensiveInterceptions:['defensiveInterceptions'],\n  PassingAttempts:['passingAttempts'")
s=s.replace("NFL:{player_sacks:['Sacks']","NFL:{player_pass_longest_completion:['PassingLongestCompletion'],player_rush_longest:['RushingLongest'],player_reception_longest:['ReceivingLongest'],player_defensive_interceptions:['DefensiveInterceptions'],player_sacks:['Sacks']")
s=s.replace('else if(defense&&!passing){out.SacksTaken=null;','else if(defense&&!passing){out.DefensiveInterceptions ??= numeric(values.interceptions);out.PassingInterceptions=null;out.SacksTaken=null;');p.write_text(s)
p=root/'lib/data-sources/espn/research.mjs';s=p.read_text().replace('const expires = !result.data ? now() + 5 * 60_000 : ttl === Infinity ? Infinity : now() + ttl;',"const emptySearch=path.startsWith('/search/')&&!result.data?.results?.some(g=>g.type==='player'&&g.contents?.length);\n      const expires = !result.data ? now()+30_000 : emptySearch ? now()+60_000 : ttl === Infinity ? Infinity : now()+ttl;");p.write_text(s)
p=root/'lib/autoscout/research-service-v2.mjs';s=p.read_text().replace('(value?.available ? 15 : 5) * 60_000','(value?.retryable ? 0.5 : value?.available ? 15 : 5) * 60_000');p.write_text(s)
p=root/'scripts/qa-multisport-browser.mjs';s=p.read_text().replace('const DATA={boards:',"""// Additional local-only identities exercise unique-player pagination.
for(let n=1;n<=22;n++)for(const marketId of ['player_pass_yds','player_pass_attempts']){
 const name='QA Fixture Athlete '+n,source=props.find(p=>p.playerName==='Jordan Love'&&p.marketId===marketId);
 props.push({...source,id:'fixture-'+n+'-'+marketId,playerId:name,playerName:name});
 research[name+'|'+marketId]={...research['Jordan Love|'+marketId]};
}
const DATA={boards:""")
s=s[:s.index('try{\n for(const [label,viewport]')]+(root/'scripts/organized-board-browser-tests.txt').read_text();p.write_text(s)
print('Applied seven targeted source changes; no production, credential, billing or auth settings modified.')
