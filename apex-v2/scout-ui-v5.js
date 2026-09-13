(async function(){
'use strict';
var nativeFetch=window.fetch.bind(window);
var {createMLClient,predictionHtml,predictionKey}=await import('/assets/lib/ui/ml-prediction.mjs');
var mlClient=createMLClient({fetcher:nativeFetch});
// Optional presentation enhancement: a failed studio load must not break the board.
var intelligence = await import('/assets/lib/ui/intelligence-studio.mjs').catch(()=>null);
var {propType,playerCardKey,categoryOptions,uniquePlayerCards,dedupeOffers}=await import('/assets/lib/ui/prop-board.mjs');
var {proToolsAnalysis}=await import('/assets/lib/analytics/pro-tools.mjs');
var {proToolsHtml}=await import('/assets/lib/ui/pro-tools.mjs');
var {matchupAnalysis,similarGames}=await import('/assets/lib/analytics/matchup.mjs');
var {compareResearchQuotes}=await import('/assets/lib/ui/line-comparison.mjs');
var playerChoices=new Map();
var {tacoBadgeHtml,removeExpiredTacoBadges}=await import('/assets/lib/ui/offer-promotion.mjs');
var { analyzeResearch, researchTeamMatches, researchOpponentMatches, analyzeLineHistory } = await import('/assets/lib/analytics/research.mjs');
var { evaluatePropAgainstFilters } = await import('/assets/lib/filters/index.mjs');
var { kellyStake, sizeSlip, DEFAULT_KELLY_FRACTION } = await import('/assets/lib/betting/kelly.mjs');
var { detectStaleLine, staleLineLabel } = await import('/assets/lib/markets/line-lag.mjs');
var { repriceProjection } = await import('/assets/lib/projections/reprice.mjs');
function displayTeam(value){return String(value||'').replace(/^(?:nfl|nba|wnba|mlb|nhl|ncaaf|ncaab)_([a-z0-9]{2,5})$/i,(_,code)=>code.toUpperCase());}
function readStored(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
var activeView='research', advanced={}, loadGeneration=0, loadController=null, lastFocus=null;
var savedRecords=new Map(), serverSaves=null, saveLoadError=false, profile=null, historyCache=new Map(), researchQueue=[], activeResearch=0;
var prefs=readStored('autoscout-preferences',{compact:false,books:false,reduceMotion:false});
if(!prefs||typeof prefs!=='object'||Array.isArray(prefs))prefs={};
var COLUMN_DEFS=[['projection','Projection',104],['l5','L5',78],['l10','L10',78],['l15','L15',78],['season','Season',78],['h2h','H2H',78],['average','Average',96],['books','Books',70]];
var rulesEnabled=true, saveEpoch=0;
var savePending=new Set();

var SPORTS=['NFL','NBA','MLB','NHL','WNBA','NCAAF','NCAAB','MLS','EPL','UCL'];
var BOARD_VIEWS={research:'Prop Research',players:'Players',popular:'Popular',discrepancies:'Line Discrepancies',saved:'Saved Props'};
var hydrating=false, hydrated=new Set(), hydrateFailed=false, hydrateController=null, hydratePending=new Set();
var projections=new Map(), projectionPending=new Set();
var shuffleOrder=new Map(), page=1;
var slip=readStored('autoscout-slip',[]), bankroll=num(readStored('autoscout-bankroll',null));
var kellyPart=num(readStored('autoscout-kelly-fraction',null))||0.25;
var slipOpen=false, quick={highEv:false,stale:false,side:null};
var staleCache=new Map();
var askThreads=new Map(), askPending=new Set();
var sandbox={key:null,out:new Set(),roster:null,loading:false};
var PAGE_SIZE=20;
var sport='NFL';try{sport=(localStorage.getItem('autoscout-sport')||'NFL').toUpperCase();}catch{}
if(SPORTS.indexOf(sport)<0)sport='NFL';
var payload={props:[],data:{lines:[],players:[]},meta:{}};
var loading=false,payloadSport=null;
var query='';
var marketFilter='all';
var bookFilter='all';
var sideFilter='all';
var sortBy='shuffle';
restoreFilters();
var favorites=new Set(readStored('autoscout-favorites',[]));
var researchCache=new Map();
var researchInflight=new Map();
var drawerState=null;
function esc(v){return String(v==null?'':v).replace(/[&<>\"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c];});}
function num(v){if(v===null||v===undefined||v==='')return null;var x=Number(v);return Number.isFinite(x)?x:null;}
function pct(v){var x=num(v);return x==null?'—':Math.round(x)+'%';}
function dec(v,d){var x=num(v);return x==null?'—':x.toFixed(d==null?1:d).replace(/\.0$/,'');}
function money(v){var x=num(v);return x==null?'—':(x>0?'+':'')+x;}
function when(v){if(!v)return'TBD';var d=new Date(v);if(Number.isNaN(d.getTime()))return'TBD';return d.toLocaleString([], {weekday:'short',hour:'numeric',minute:'2-digit'});}
function shortDate(v){if(!v)return'—';var d=new Date(v);if(Number.isNaN(d.getTime()))return String(v).slice(0,10);return d.toLocaleDateString([], {month:'numeric',day:'numeric'});}
function uniq(a){return Array.from(new Set(a.filter(Boolean)));}
function median(a){var x=a.map(num).filter(function(v){return v!=null;}).sort(function(a,b){return a-b;});if(!x.length)return null;var m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2;}
function initials(name){return String(name||'AS').split(/\s+/).filter(Boolean).slice(0,2).map(function(x){return x[0]||'';}).join('').toUpperCase();}
function artUrl(g){return '/api/apex/player-artwork?'+new URLSearchParams({v:'2',sport:g.sport,name:g.playerName,team:g.team||'',providerPlayerId:g.providerPlayerId||''});}
function groupKey(r){return [r.sport,r.eventId,r.playerId||r.playerName,r.marketId||r.market].join('|');}
function lineMap(){var m=new Map();((payload.data&&payload.data.lines)||[]).forEach(function(x){m.set(x.id,x);});return m;}
function propIdForRow(r){var x=lineMap().get(r&&r.id);return x&&x.propId||null;}
function playerMap(){var m=new Map();((payload.data&&payload.data.players)||[]).forEach(function(x){m.set(x.id,x);});return m;}
function groups(){var m=new Map(),pm=playerMap();(payload.props||[]).forEach(function(r){if(r.isAlternate)return;var k=groupKey(r);if(!m.has(k)){var p=pm.get(r.playerId)||{};m.set(k,{key:k,sport:r.sport,eventId:r.eventId,playerId:r.playerId,playerName:r.playerName,entityType:r.entityType||p.entityType||'player',providerPlayerId:p.providerPlayerId||'',team:r.team||p.team||'',position:p.position||'',marketId:r.marketId,market:r.market,homeTeam:r.homeTeam,awayTeam:r.awayTeam,gameStartTime:r.gameStartTime,live:!!r.live,rows:[]});}m.get(k).rows.push(r);});return Array.from(m.values()).map(function(g){return {...g,market:propType(g),comparisonOffers:g.rows,rows:dedupeOffers(g.rows)};});}
function books(g){return uniq(g.rows.map(function(r){return r.sportsbookKey;}));}
function sideRows(g,side){return g.rows.filter(function(r){return r.side===side;});}
function bestLine(g,side){var a=sideRows(g,side).filter(function(r){return num(r.line)!=null;});if(!a.length)return null;return a.slice().sort(function(a,b){return side==='OVER'?num(a.line)-num(b.line):num(b.line)-num(a.line);})[0];}
function bestPrice(g,side,line,allBooks=false){var selected=num(line==null?boardLine(g):line);return sideRows(g,side).filter(r=>num(r.price)!=null&&num(r.line)===selected&&(allBooks||bookFilter==='all'||r.sportsbookKey===bookFilter)).sort((a,b)=>num(b.price)-num(a.price))[0]||null;}
function consensus(g){var byBook=new Map();g.rows.forEach(r=>{if(!byBook.has(r.sportsbookKey))byBook.set(r.sportsbookKey,[]);byBook.get(r.sportsbookKey).push(r.line);});return median(Array.from(byBook.values()).map(median));}
function boardLine(g){var side=defaultSide(g),rows=sideRows(g,side).filter(r=>num(r.line)!=null&&(bookFilter==='all'||r.sportsbookKey===bookFilter));if(!rows.length)return null;return rows.reduce((best,row)=>side==='UNDER'?Math.max(best,num(row.line)):Math.min(best,num(row.line)),num(rows[0].line));}
function defaultSide(g){return sideFilter!=='all'?sideFilter:sideRows(g,'OVER').length?'OVER':'UNDER';}
function researchKey(g,line,side){return [g.key,g.team,g.homeTeam,g.awayTeam,num(line),side||'OVER'].join('|');}
function saveState(){try{localStorage.setItem('autoscout-sport',sport);}catch{}if(!serverSaves)storeLocal('autoscout-favorites',Array.from(favorites));}
function favoriteKey(g){return g.key;}
function researchFor(g,line,side){
 var key=researchKey(g,line==null?boardLine(g):line,side||defaultSide(g)), entry=researchCache.get(key);
 if(entry&&entry.expires>Date.now())return entry.value;
 var base=researchCache.get('base|'+g.key);
 if(base&&base.expires>Date.now())return analyzeResearch(base.value,line==null?boardLine(g):line,side||defaultSide(g));
 return null;
}
function styles(){return `<style id="autoscout-v5-style">:root{--bg:#070a11;--panel:#0d1320;--panel2:#111a29;--panel3:#172236;--line:#223049;--line2:#31415f;--text:#f7f9fc;--muted:#8896aa;--soft:#bcc6d6;--green:#33e49b;--green2:#0fbf7e;--blue:#5ea1ff;--red:#ff6878;--amber:#f0c45f;--violet:#8b7dff}*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.app,.topbar,.shell,.bottom,.drawerbg,.apxOverlay,.apxPageBanner,.apx2{display:none!important}button,input,select{font:inherit}.as5{min-height:100vh;padding-bottom:70px;background:radial-gradient(circle at 50% -120px,#192442 0,transparent 460px),var(--bg)}.asTop{position:sticky;top:0;z-index:30;background:rgba(7,10,17,.95);backdrop-filter:blur(18px);border-bottom:1px solid #182235}.asBar{height:58px;max-width:1380px;margin:auto;padding:0 14px;display:flex;align-items:center;gap:10px}.asLogo{width:32px;height:32px;border-radius:9px;background:linear-gradient(145deg,#66f0b0,#3c8fff);display:grid;place-items:center;color:#071018;font-weight:1000}.asBrand{font-size:18px;font-weight:950;letter-spacing:-.04em}.asBrand i{font-style:normal;color:var(--green)}.asGrow{flex:1}.asStatus{font-size:9px;color:var(--muted)}.asBtn{height:34px;border:1px solid var(--line2);background:#111927;color:#e6ecf5;border-radius:8px;padding:0 10px;font-size:9px;font-weight:900}.asSports{max-width:1380px;margin:auto;padding:0 12px 7px;display:flex;gap:5px;overflow:auto}.asSport{height:31px;border:1px solid transparent;background:transparent;color:#7f8b9c;border-radius:9px;padding:0 12px;font-size:10px;font-weight:900;white-space:nowrap}.asSport.on{color:#fff;background:#18253a;border-color:#355171}.asMain{max-width:1380px;margin:auto;padding:14px}.asHero{display:flex;gap:10px;align-items:end;margin-bottom:12px}.asHero h1{margin:0;font-size:25px;letter-spacing:-.05em}.asHero p{margin:3px 0 0;color:var(--muted);font-size:11px}.asHeroBadge{margin-left:auto;border:1px solid #285a46;background:#0e241c;color:#7ef0bd;border-radius:999px;padding:7px 10px;font-size:8px;font-weight:950}.asFilters{display:grid;grid-template-columns:minmax(220px,1.5fr) repeat(4,minmax(115px,.7fr));gap:6px;margin-bottom:10px}.asControl{height:39px;border:1px solid var(--line);background:#0c121d;color:#eef2f8;border-radius:9px;padding:0 10px;font-size:10px;outline:none}.asControl:focus{border-color:#4e78aa}.asSummary{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;margin-bottom:10px}.asSummaryItem{border:1px solid var(--line);background:#0c121c;border-radius:10px;padding:9px 10px}.asSummaryItem small{display:block;color:#738198;font-size:7px;text-transform:uppercase;letter-spacing:.08em;font-weight:900}.asSummaryItem b{display:block;font-size:14px;margin-top:2px}.asHeaderRow{display:grid;grid-template-columns:minmax(270px,1.4fr) 82px 82px repeat(5,70px) 90px 94px;gap:0;padding:0 12px 6px;color:#657389;font-size:7px;font-weight:950;text-transform:uppercase;letter-spacing:.06em}.asList{display:grid;grid-template-columns:1fr;gap:7px}.asRow{border:1px solid #25334c;background:linear-gradient(180deg,#111a2a 0,#0b1019 100%);border-radius:12px;overflow:hidden;box-shadow:0 8px 28px rgba(0,0,0,.14);cursor:pointer}.asRowMain{display:grid;grid-template-columns:minmax(270px,1.4fr) 82px 82px repeat(5,70px) 90px 94px;align-items:center;min-height:78px}.asPlayerCell{display:grid;grid-template-columns:50px 1fr;gap:10px;align-items:center;padding:9px 12px}.asAvatar{width:48px;height:48px;border-radius:50%;overflow:hidden;background:#172137;border:1px solid #3a4968;position:relative}.asAvatar img{width:100%;height:100%;object-fit:cover;position:relative;z-index:1}.asAvatarFallback{position:absolute;inset:0;display:grid;place-items:center;font-weight:950;color:#9fb3ce}.asPlayer{font-size:13px;font-weight:950;letter-spacing:-.02em}.asGame{font-size:8px;color:#8997aa;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.asMarket{font-size:9px;color:#dfe6f0;margin-top:5px;font-weight:850}.asCell{padding:8px 6px;text-align:center;border-left:1px solid rgba(34,48,73,.62)}.asCell small{display:block;font-size:6px;color:#6f7d92;font-weight:900;text-transform:uppercase}.asCell b{display:block;font-size:10px;margin-top:2px}.asCell .good{color:var(--green)}.asCell .bad{color:var(--red)}.asCell .warn{color:var(--amber)}.asLine{font-size:15px!important}.asQuote{font-size:8px;color:#94a1b4;margin-top:2px}.asBookRail{display:flex;gap:5px;overflow:auto;border-top:1px solid var(--line);padding:7px 9px}.asBookChip{min-width:108px;border:1px solid #283650;background:#0a0f18;border-radius:8px;padding:6px}.asBookTop{display:flex;justify-content:space-between;font-size:7px;color:#7f8da2}.asBookTop b{color:#fff}.asBookVals{display:flex;gap:7px;margin-top:3px;font-size:8px;font-weight:850}.asBookVals .o{color:var(--green)}.asBookVals .u{color:var(--blue)}.asRowActions{display:flex;align-items:center;gap:7px;border-top:1px solid #1f2a3e;padding:6px 10px;font-size:7px;color:#6f7d91}.asSource{color:#8cb4ee}.asSave{margin-left:auto;height:25px;border:1px solid var(--line2);background:#101827;color:#aab6c7;border-radius:7px;padding:0 8px;font-size:7px;font-weight:950}.asSave.on{color:#ffd874}.asResearchState{font-weight:900;color:#7d8ba1}.asResearchState.ready{color:var(--green)}.asResearchState.unavailable{color:var(--amber)}.asMobileMetrics{display:none}.asEmpty{padding:56px 20px;text-align:center;color:var(--muted);border:1px solid var(--line);border-radius:14px;background:#0c121c}.asEmpty b{display:block;color:#fff;margin-bottom:6px}.asDrawerBg{position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.72);display:none}.asDrawerBg.on{display:block}.asDrawer{position:absolute;right:0;top:0;width:min(820px,100%);height:100%;background:#080d15;overflow:auto;border-left:1px solid var(--line)}.asDrawerHead{position:sticky;top:0;z-index:4;background:rgba(8,13,21,.97);backdrop-filter:blur(18px);padding:11px 14px;border-bottom:1px solid var(--line);display:grid;grid-template-columns:56px 1fr 34px;gap:10px;align-items:center}.asDrawerAvatar{width:54px;height:54px;border-radius:50%;overflow:hidden;background:#172137;border:1px solid #3a4968}.asDrawerAvatar img{width:100%;height:100%;object-fit:cover}.asDrawerHead h2{margin:0;font-size:18px}.asDrawerHead p{margin:2px 0 0;color:#8d9aae;font-size:9px}.asClose{width:34px;height:34px;border:1px solid var(--line2);background:#101827;color:#fff;border-radius:9px}.asDrawerBody{padding:10px}.asSection{border:1px solid var(--line);border-radius:12px;background:#0d131e;margin-bottom:9px;overflow:hidden}.asSectionTitle{display:flex;align-items:center;gap:8px;padding:9px 11px;border-bottom:1px solid var(--line)}.asSectionTitle h3{margin:0;font-size:8px;letter-spacing:.08em;text-transform:uppercase;color:#8190a4}.asSectionTitle span{margin-left:auto;color:#64748b;font-size:7px}.asSectionBody{padding:10px}.asResearchTop{display:grid;grid-template-columns:1.4fr 1fr;gap:8px}.asPicker{display:flex;gap:6px;align-items:center}.asMarketSelect{height:38px;flex:1;border:1px solid var(--line2);background:#09101a;color:#fff;border-radius:8px;padding:0 8px;font-size:9px}.asLineCtl{display:grid;grid-template-columns:36px 70px 36px;gap:4px}.asLineBtn{border:1px solid var(--line2);background:#111a29;color:#fff;border-radius:8px;font-weight:950}.asLineVal{height:38px;display:grid;place-items:center;border:1px solid #36506f;background:#0b1421;border-radius:8px;font-size:16px;font-weight:1000}.asSideToggle{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:7px}.asSideBtn{height:32px;border:1px solid var(--line);background:#0a1019;color:#718096;border-radius:8px;font-size:8px;font-weight:950}.asSideBtn.on.over{color:#9af2cb;border-color:#2d6d51;background:#10281e}.asSideBtn.on.under{color:#a9ccff;border-color:#315a8a;background:#0f1d30}.asContext{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.asCtx{border:1px solid #24334c;background:#0a1019;border-radius:8px;padding:8px}.asCtx small{display:block;color:#718097;font-size:6px;text-transform:uppercase;font-weight:900}.asCtx b{display:block;font-size:10px;margin-top:2px;overflow:hidden;text-overflow:ellipsis}.asWindows{display:grid;grid-template-columns:repeat(6,1fr);gap:5px}.asWindow{border:1px solid #24334c;background:#0a1019;border-radius:8px;padding:7px 5px;text-align:left;color:#fff}.asWindow.on{border-color:#39674f;background:#0e211a}.asWindow small{display:block;color:#8090a6;font-size:6px;font-weight:950}.asWindow b{display:block;font-size:12px;margin-top:2px}.asWindow em{display:block;font-style:normal;color:#7ddcb0;font-size:7px;margin-top:2px}.asChartWrap{overflow-x:auto}.asChart{height:250px;min-width:540px;display:flex;align-items:stretch;gap:5px;position:relative;padding:16px 8px 31px;border-radius:9px;background:linear-gradient(180deg,#0a1019,#07100d)}.asThreshold{position:absolute;left:8px;right:8px;border-top:2px dashed #75849b;z-index:2}.asThresholdLabel{position:absolute;right:8px;transform:translateY(-50%);background:#172238;border:1px solid #3b4b67;border-radius:6px;padding:3px 5px;font-size:7px;font-weight:950;z-index:3}.asBarCol{flex:1;min-width:27px;position:relative;height:100%;display:flex;align-items:flex-end;justify-content:center}.asBar{width:100%;max-width:44px;border:1px solid #2a7658;background:linear-gradient(180deg,#35e8a1,#10875f);border-radius:8px 8px 3px 3px;position:relative;z-index:1;min-height:3px}.asBar.miss{border-color:#713845;background:linear-gradient(180deg,#e16b78,#813341)}.asBar.push{border-color:#746236;background:linear-gradient(180deg,#e5bf5c,#8d6e24)}.asBarVal{position:absolute;top:-15px;left:50%;transform:translateX(-50%);font-size:7px;font-weight:950;white-space:nowrap}.asBarLabel{position:absolute;bottom:-25px;left:50%;transform:translateX(-50%);font-size:6px;color:#7b899d;text-align:center;white-space:nowrap}.asChartEmpty{height:180px;display:grid;place-items:center;color:#8390a3;font-size:9px}.asFilterRow{display:flex;gap:5px;overflow:auto;margin-bottom:7px}.asFilterBtn{height:27px;border:1px solid var(--line);background:#0a1019;color:#8592a6;border-radius:7px;padding:0 8px;font-size:7px;font-weight:950;white-space:nowrap}.asFilterBtn.on{color:#fff;border-color:#3d5677;background:#17243a}.asTableWrap{overflow:auto}.asTable{width:100%;min-width:690px;border-collapse:collapse}.asTable th,.asTable td{text-align:left;padding:7px 6px;border-bottom:1px solid #1f2b3e;font-size:8px}.asTable th{color:#718097;font-size:6px;text-transform:uppercase}.asHit{color:var(--green);font-weight:950}.asMiss{color:var(--red);font-weight:950}.asPushText{color:var(--amber);font-weight:950}.asCompare{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;padding:7px 0;border-bottom:1px solid #202b3e;font-size:8px}.asCompare:last-child{border-bottom:0}.asBest{color:var(--green);font-weight:950}.asNotice{color:#92a0b3;font-size:9px;line-height:1.5}.asError{border:1px solid #63434a;background:#211319;color:#f1aab3;border-radius:8px;padding:9px;font-size:9px}.asLoading{height:120px;display:grid;place-items:center;color:#8898ad;font-size:9px}.asPulse{width:22px;height:22px;border-radius:50%;border:2px solid #25334d;border-top-color:var(--green);animation:spin .8s linear infinite;margin:0 auto 8px}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:980px){.asHeaderRow{display:none}.asRowMain{grid-template-columns:minmax(230px,1.4fr) repeat(4,68px)}.asRowMain>.asCell:nth-of-type(n+6){display:none}.asFilters{grid-template-columns:1fr 1fr 1fr}.asFilters input{grid-column:1/-1}.asSummary{grid-template-columns:repeat(3,1fr)}.asSummaryItem:nth-child(n+4){display:none}}@media(max-width:650px){.asMain{padding:10px}.asBar{padding:0 10px}.asStatus{display:none}.asHero{align-items:start}.asHero h1{font-size:21px}.asHero p{font-size:9px}.asHeroBadge{font-size:7px;padding:6px 8px}.asFilters{grid-template-columns:1fr 1fr}.asFilters input{grid-column:1/-1}.asSummary{grid-template-columns:repeat(3,1fr)}.asRowMain{display:block;min-height:0}.asPlayerCell{grid-template-columns:54px 1fr auto;padding:10px}.asPlayerCell:after{content:attr(data-line);font-size:17px;font-weight:1000;text-align:right}.asRowMain>.asCell{display:none!important}.asMobileMetrics{display:grid!important;grid-template-columns:repeat(6,1fr);border-top:1px solid var(--line)}.asMobileMetrics .asCell{display:block!important;border-left:1px solid var(--line);padding:7px 2px}.asMobileMetrics .asCell:first-child{border-left:0}.asBookRail{padding:7px}.asResearchTop{grid-template-columns:1fr}.asContext{grid-template-columns:repeat(2,1fr)}.asWindows{grid-template-columns:repeat(3,1fr)}.asChart{height:235px;min-width:520px}.asDrawerHead h2{font-size:16px}.asDrawerBody{padding:8px}}</style>`;}
function shell(){
 document.body.insertAdjacentHTML('beforeend',styles()+`<link rel="stylesheet" href="/assets/autoscout-research.css"><link rel="stylesheet" href="/assets/prop-ml.css"><div class="as5" id="as5">
 <header class="asTop"><div class="asBar"><a class="asIdentity" href="/apex" aria-label="Auto Scout Research"><div class="asLogo">A</div><span class="asBrand">AUTO<i>SCOUT</i></span></a><span class="asDesktopLabel">RESEARCH WORKSPACE</span><span class="asGrow"></span><span class="asStatus" id="asStatus">Current sportsbook lines</span><button class="asBtn" id="asRefresh">Refresh</button><button class="asBtn" data-view="saved">Saved</button><button class="asBtn" id="asSettings">Settings</button><button class="asBtn" id="asAccount">Account</button></div><div class="asSports" id="asSports" aria-label="Sports"></div></header>
 <main class="asMain"><section class="asHero"><div><h1 id="asPageTitle">Prop Research</h1><p id="asSubtitle" aria-live="polite">Loading current markets…</p></div><span class="asHeroBadge">MAIN LINES ONLY</span></section>
 <nav id="asPropTypes" class="asPropTypes" aria-label="Prop types"></nav>
 <section class="asFilters" aria-label="Filter player props"><label class="asSearchLabel"><span class="asSrOnly">Search player, market or team</span><input class="asControl" id="asSearch" placeholder="Search player, market, team…" type="search"></label><label><span class="asSrOnly">Market</span><select class="asControl" id="asMarket"></select></label><label><span class="asSrOnly">Sportsbook</span><select class="asControl" id="asBook"></select></label><label><span class="asSrOnly">Over or Under</span><select class="asControl" id="asSide"><option value="all">Over + Under</option><option value="OVER">Over</option><option value="UNDER">Under</option></select></label><button class="asBtn asFilterTrigger" id="asAdvancedToggle" aria-expanded="false">Filters <span id="asFilterCount"></span></button></section>
 <dialog id="asFilterSheet" class="asFilterSheet" aria-labelledby="asFilterTitle"><div class="asSheetHead"><h2 id="asFilterTitle">Research filters</h2><button class="asBtn" id="asFilterDone">Done</button></div><section id="asAdvanced" class="asAdvanced"></section></dialog><div class="asToolbar"><span id="asResultCount" aria-live="polite"></span><button class="asBtn" id="asRules" role="switch" aria-checked="true">Rules on</button><button class="asBtn" id="asColumns">Columns</button><button class="asBtn" id="asResearchBatch">Load research</button><label>Sort <select class="asControl" id="asSort"><option value="shuffle">Shuffled (no order)</option><option value="research">Research coverage</option><option value="recent">Recent hit rate</option><option value="l5">L5 hit rate</option><option value="l10">L10 hit rate</option><option value="l15">L15 hit rate</option><option value="l20">L20 hit rate</option><option value="season">Season hit rate</option><option value="h2h">H2H hit rate</option><option value="projection">Projection difference</option><option value="books">Most books</option><option value="player">Player A–Z</option><option value="time">Game time</option></select></label></div>
 <p class="asNotice" id="asViewNote" hidden></p><section class="asQuick" id="asQuick" aria-label="Quick filters"></section><section class="asSummary" id="asSummary" aria-label="Board summary"></section><div class="asTableViewport"><div class="asHeaderRow"><span>Player / Market</span><span>Line</span><span>Projection</span><span>L5</span><span>L10</span><span>L15</span><span>Season</span><span>H2H</span><span>Average</span><span>Books</span></div><section class="asList" id="asList" aria-label="Player props"></section></div><div id="asMore"></div><p class="asCoverageNote">Browse by prop type. Each player appears once; use the card selector to switch props or games. Statistics use verified game logs only. N/A means no verified sample for that split; it is not zero.</p></main>
 <nav class="asNav" aria-label="Main navigation"><button data-view="research" class="on" data-icon="props"><span class="asNavIcon" aria-hidden="true">☲</span><span>Props</span></button><button data-view="players" data-icon="players"><span class="asNavIcon" aria-hidden="true">●</span><span>Players</span></button><button data-view="popular" data-icon="popular"><span class="asNavIcon" aria-hidden="true">▲</span><span>Popular</span></button><button data-view="discrepancies" data-icon="trend"><span class="asNavIcon" aria-hidden="true">↗</span><span>Discrepancies</span></button><button id="asDiscord" data-icon="chat"><span class="asNavIcon" aria-hidden="true">○</span><span>Discord</span></button></nav>
 <div class="asDrawerBg" id="asDrawerBg"><aside class="asDrawer" role="dialog" aria-modal="true" aria-labelledby="asDrawerTitle" tabindex="-1"><div class="asDrawerHead"><div class="asDrawerAvatar"><img id="asDrawerImg" alt=""></div><div><h2 id="asDrawerTitle">Player research</h2><span id="asInjuryBadge" class="asInjuryBadge" hidden></span><p id="asDrawerSub"></p></div><button class="asClose" id="asClose" aria-label="Back to research"><span class="asBackText">Back</span><span aria-hidden="true">×</span></button></div><div class="asDrawerBody" id="asDrawerBody"></div></aside></div>
 <aside class="asSlipDrawer" id="asSlip" aria-label="Betslip"></aside><dialog id="asUtility" class="asUtility" aria-labelledby="asUtilityTitle"></dialog><div id="asToast" class="asToast" role="status" aria-live="polite"></div></div>`);
 document.getElementById('asRefresh').onclick=()=>load();
 var searchTimer;document.getElementById('asSearch').oninput=e=>{query=e.target.value;page=1;clearTimeout(searchTimer);searchTimer=setTimeout(renderList,180);};
 document.getElementById('asMarket').onchange=e=>{marketFilter=e.target.value;page=1;renderList();};
 document.getElementById('asBook').onchange=e=>{bookFilter=e.target.value;page=1;renderList();};
 document.getElementById('asSide').onchange=e=>{sideFilter=e.target.value;page=1;renderList();};
 document.getElementById('asSort').onchange=e=>{sortBy=e.target.value;page=1;renderList();};
 document.getElementById('asAdvancedToggle').onclick=()=>{renderAdvanced();document.getElementById('asFilterSheet').showModal();document.getElementById('asAdvancedToggle').setAttribute('aria-expanded','true');};
 document.getElementById('asFilterDone').onclick=()=>document.getElementById('asFilterSheet').close();
 document.getElementById('asFilterSheet').onclose=()=>{document.getElementById('asAdvancedToggle').setAttribute('aria-expanded','false');document.getElementById('asAdvancedToggle').focus();};
 document.getElementById('asRules').onclick=()=>{rulesEnabled=!rulesEnabled;renderAdvanced();renderList();};
 document.getElementById('asColumns').onclick=columnsPanel;
 document.getElementById('asClose').onclick=closeDrawer;
 document.getElementById('asDrawerBg').onclick=e=>{if(e.target.id==='asDrawerBg')closeDrawer();};
 document.querySelectorAll('[data-view]').forEach(b=>b.onclick=async()=>{activeView=b.dataset.view;page=1;document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('on',x===b));document.getElementById('asPageTitle').textContent=BOARD_VIEWS[activeView]||'Prop Research';renderControls();renderAdvanced();renderList();if(activeView==='saved'){b.disabled=true;try{await loadSaved();if(activeView==='saved'){renderControls();renderAdvanced();renderList();}}finally{b.disabled=false;}}});
 document.getElementById('asDiscord').onclick=()=>{
  var url=typeof window.AUTOSCOUT_DISCORD_URL==='string'?window.AUTOSCOUT_DISCORD_URL:'';
  if(/^https:\/\/(discord\.gg|discord\.com)\//.test(url)){window.open(url,'_blank','noopener');return;}
  toast('No Discord invite is configured yet.');
 };
 document.getElementById('asAccount').onclick=accountPanel;
 document.getElementById('asSettings').onclick=settingsPanel;
 document.addEventListener('keydown',e=>{if(!drawerState)return;if(e.key==='Escape'){e.preventDefault();closeDrawer();}if(e.key==='Tab'){var items=Array.from(document.querySelectorAll('.asDrawer button,.asDrawer select,.asDrawer input,.asDrawer a')).filter(x=>!x.disabled&&x.getClientRects().length);var first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}});
 document.getElementById('asSearch').value=query;document.getElementById('asSide').value=sideFilter;document.getElementById('asSort').value=sortBy;applyPreferences();renderAdvanced();renderSlip();
 intelligence?.mountBoard({root:document.getElementById('as5'),onOpen:g=>{openDrawer(g);drawerState.panel='intelligence';renderDrawer();document.getElementById('asTab-intelligence')?.focus();}});
}
function focusToken(element){if(!element)return null;return{id:element.id,data:Object.fromEntries(['open','fav','side','window','filter','gameDetail','sort','cardChoice'].filter(k=>element.dataset?.[k]!=null).map(k=>[k,element.dataset[k]])),value:element.id==='asLineInput'?element.value:null};}
function focusElement(token){if(!token)return null;if(token.id)return document.getElementById(token.id);var keys=Object.keys(token.data);return keys.length?Array.from(document.querySelectorAll('[data-open],[data-fav],[data-side],[data-window],[data-filter],[data-game-detail],[data-sort],[data-card-choice]')).find(x=>keys.every(k=>x.dataset[k]===token.data[k])):null;}
function restoreFocus(token){var element=focusElement(token);if(element){if(token.value!=null)element.value=token.value;element.focus({preventScroll:true});}return element;}
function closeDrawer(){intelligence?.disposeDetails();document.getElementById('asDrawerBg')?.classList.remove('on');document.body.style.overflow='';document.querySelectorAll('.asMain,.asTop,.asNav').forEach(x=>x.inert=false);drawerState=null;if(lastFocus?.isConnected)lastFocus.focus();}
function renderSports(){if(!document.getElementById('asSports').children.length)document.getElementById('asSports').innerHTML=SPORTS.map(s=>'<button class="asSport '+(s===sport?'on':'')+'" aria-pressed="'+(s===sport)+'" data-sport="'+s+'">'+s+'</button>').join('');document.querySelectorAll('[data-sport]').forEach(b=>{b.classList.toggle('on',b.dataset.sport===sport);b.setAttribute('aria-pressed',String(b.dataset.sport===sport));b.onclick=()=>{if(sport===b.dataset.sport)return;persistFilters();sport=b.dataset.sport;saveState();closeDrawer();restoreFilters();document.getElementById('asSearch').value=query;document.getElementById('asSide').value=sideFilter;document.getElementById('asSort').value=sortBy;page=1;renderAdvanced();load();};});}
function viewGroups(){var current=groups().filter(g=>g.sport===sport);if(activeView!=='saved')return current;var merged=new Map(current.filter(g=>favorites.has(g.key)).map(g=>[g.key,g]));savedRecords.forEach(g=>{if(g.sport===sport&&favorites.has(g.key)&&!merged.has(g.key))merged.set(g.key,{...g,archived:true});});return Array.from(merged.values());}
// Sports come from what the board actually serves. Adding a chip for a league
// with no pipeline behind it would open an empty board, so the list is the
// supported set and nothing else.
// ---------------------------------------------------------------------------
// Betslip and stake sizing.
//
// Kelly needs a probability. The board only has one for props whose prediction
// has been generated, so a pick without one shows "needs a prediction" instead
// of a dollar figure invented from its price. Stakes are quarter-Kelly and
// capped by the shared module — see lib/betting/kelly.mjs for why.
// ---------------------------------------------------------------------------
function slipHas(key){return slip.some(function(x){return x.key===key;});}
function toggleSlip(key){
 var g=groups().find(function(x){return x.key===key;});
 if(!g)return;
 if(slipHas(key))slip=slip.filter(function(x){return x.key!==key;});
 else{
  var line=boardLine(g),side=defaultSide(g),quote=bestPrice(g,side,line,true);
  slip.push({key:key,sport:g.sport,playerName:g.playerName,market:g.market,
   line:num(line),side:side,price:quote?num(quote.price):null,
   sportsbook:quote?(quote.sportsbook||quote.sportsbookKey):null});
 }
 storeLocal('autoscout-slip',slip);
 renderSlip();renderListLight();
}
function slipPickProbability(pick){
 var entry=projectionFor({key:pick.key,rows:pick.rows||[]},num(pick.line))||projections.get([pick.key,num(pick.line)].join('|'));
 if(!entry||!entry.available)return null;
 return pick.side==='UNDER'?num(entry.probabilityUnder):num(entry.probabilityOver);
}
function renderSlip(){
 var host=document.getElementById('asSlip');
 if(!host)return;
 host.classList.toggle('on',slipOpen);
 var count=slip.length;
 var toggle='<button class="asSlipToggle" id="asSlipToggle" aria-expanded="'+slipOpen+'" aria-controls="asSlipBody">'
  +'<span>Betslip</span><span class="asSlipCount">'+count+'</span></button>';
 if(!slipOpen){host.innerHTML=toggle;bindSlip();return;}
 var sized=sizeSlip(slip.map(function(pick){
  return {ref:pick,probability:slipPickProbability(pick),americanOdds:pick.price};
 }),{bankroll:bankroll,fraction:kellyPart});
 var rows=sized.picks.map(function(row){
  var pick=row.ref,k=row.kelly;
  var stake=k&&num(k.stake)!=null?'$'+k.stake.toFixed(2):null;
  var note=!k?'Needs a prediction':num(k.stake)==null?'Set a bankroll'
   :!k.edge?'No edge at this price':k.capped?'Capped at '+Math.round(k.stakeFraction*100)+'% of roll':null;
  return '<li class="asSlipRow"><div class="asSlipMain"><b>'+esc(pick.playerName)+'</b>'
   +'<span>'+esc(pick.side+' '+dec(pick.line)+' '+pick.market)+'</span>'
   +'<em>'+esc((pick.sportsbook||'No price')+(pick.price!=null?' '+money(pick.price):''))+'</em></div>'
   +'<div class="asSlipStake">'+(stake?'<b>'+esc(stake)+'</b>':'<b class="asSlipMuted">—</b>')
   +(note?'<em>'+esc(note)+'</em>':'')+'</div>'
   +'<button class="asSlipRemove" data-slip-remove="'+esc(pick.key)+'" aria-label="Remove '+esc(pick.playerName)+'">×</button></li>';
 }).join('');
 host.innerHTML=toggle
  +'<div class="asSlipBody" id="asSlipBody">'
   +'<div class="asSlipBank"><label for="asBankroll">Total bankroll</label>'
    +'<div class="asSlipBankRow"><span>$</span><input id="asBankroll" class="asControl" type="number" min="0" step="10" inputmode="decimal" value="'+(bankroll==null?'':bankroll)+'" placeholder="1000"></div>'
    +'<label for="asKellyFraction">Kelly fraction</label>'
    +'<select id="asKellyFraction" class="asControl">'
     +[['0.125','Eighth'],['0.25','Quarter'],['0.5','Half'],['1','Full']].map(function(o){
       return '<option value="'+o[0]+'" '+(Number(o[0])===kellyPart?'selected':'')+'>'+o[1]+' Kelly</option>';}).join('')
    +'</select></div>'
   +(count?'<ul class="asSlipList">'+rows+'</ul>':'<p class="asNotice">No picks yet. Add one from any card.</p>')
   +(count?'<div class="asSlipTotal"><span>Suggested total</span><b>'+(sized.totalStake==null?'—':'$'+sized.totalStake.toFixed(2))+'</b>'
     +(sized.sharePercent!=null?'<em>'+sized.sharePercent+'% of bankroll</em>':'')+'</div>':'')
   +(sized.exceedsBankroll?'<p class="asSlipWarn">These stakes are sized independently and add up to more than your bankroll. Scale them down — the maths does not account for picks moving together.</p>':'')
   +(count&&sized.unsizedCount?'<p class="asNotice">'+sized.unsizedCount+' pick'+(sized.unsizedCount===1?'':'s')+' cannot be sized until a prediction has been generated.</p>':'')
   +'<p class="asSlipFootnote">Stake suggestions come from a model estimate, not a measured probability. Not betting advice.</p>'
   +(count?'<button class="asBtn" id="asSlipClear">Clear slip</button>':'')
  +'</div>';
 bindSlip();
}
function bindSlip(){
 var toggle=document.getElementById('asSlipToggle');
 if(toggle)toggle.onclick=function(){slipOpen=!slipOpen;renderSlip();};
 var bank=document.getElementById('asBankroll');
 if(bank)bank.onchange=function(){
  var value=num(bank.value);
  bankroll=value!=null&&value>0?value:null;
  storeLocal('autoscout-bankroll',bankroll);renderSlip();
 };
 var fraction=document.getElementById('asKellyFraction');
 if(fraction)fraction.onchange=function(){
  kellyPart=num(fraction.value)||0.25;storeLocal('autoscout-kelly-fraction',kellyPart);renderSlip();
 };
 var clear=document.getElementById('asSlipClear');
 if(clear)clear.onclick=function(){slip=[];storeLocal('autoscout-slip',slip);renderSlip();renderListLight();};
 document.querySelectorAll('[data-slip-remove]').forEach(function(b){
  b.onclick=function(){slip=slip.filter(function(x){return x.key!==b.dataset.slipRemove;});
   storeLocal('autoscout-slip',slip);renderSlip();renderListLight();};
 });
}
function renderQuick(){
 var host=document.getElementById('asQuick');
 if(!host)return;
 var sports='<div class="asQuickRow" role="group" aria-label="Sport">'
  +SPORTS.map(function(s){return '<button class="asChip '+(s===sport?'on':'')+'" data-quick-sport="'+s+'" aria-pressed="'+(s===sport)+'">'+s+'</button>';}).join('')
  +'</div>';
 var toggles=[
  ['highEv','High EV &gt;5%',quick.highEv],
  ['stale','⚡ Stale lines',quick.stale],
  ['over','Over only',quick.side==='OVER'],
  ['under','Under only',quick.side==='UNDER'],
 ].map(function(t){return '<button class="asChip asChipToggle '+(t[2]?'on':'')+'" data-quick="'+t[0]+'" aria-pressed="'+t[2]+'">'+t[1]+'</button>';}).join('');
 host.innerHTML=sports+'<div class="asQuickRow asQuickToggles" role="group" aria-label="Quick filters">'+toggles+'</div>';
 host.querySelectorAll('[data-quick-sport]').forEach(function(b){
  b.onclick=function(){
   if(sport===b.dataset.quickSport)return;
   persistFilters();sport=b.dataset.quickSport;saveState();closeDrawer();restoreFilters();
   document.getElementById('asSearch').value=query;document.getElementById('asSide').value=sideFilter;
   document.getElementById('asSort').value=sortBy;page=1;renderAdvanced();load();
  };
 });
 host.querySelectorAll('[data-quick]').forEach(function(b){
  b.onclick=function(){
   var id=b.dataset.quick;
   if(id==='highEv')quick.highEv=!quick.highEv;
   else if(id==='stale')quick.stale=!quick.stale;
   else quick.side=quick.side===(id==='over'?'OVER':'UNDER')?null:(id==='over'?'OVER':'UNDER');
   page=1;renderQuick();renderList();
  };
 });
}
function renderControls(){var gs=viewGroups(),markets=uniq([...gs.map(function(g){return g.market;}),marketFilter==='all'?null:marketFilter]).sort(),booksList=uniq([...gs.flatMap(function(g){return g.rows.map(function(r){return r.sportsbookKey;});}),bookFilter==='all'?null:bookFilter]).sort();document.getElementById('asMarket').innerHTML='<option value="all">All players · grouped props</option>'+markets.map(function(x){return'<option value="'+esc(x)+'" '+(x===marketFilter?'selected':'')+'>'+esc(x)+'</option>';}).join('');document.getElementById('asBook').innerHTML='<option value="all">All books</option>'+booksList.map(function(x){return'<option value="'+esc(x)+'" '+(x===bookFilter?'selected':'')+'>'+esc(gs.flatMap(g=>g.rows).find(r=>r.sportsbookKey===x)?.sportsbook||x)+'</option>';}).join('');}
function cardList(ignoreResearch=false){return uniquePlayerCards(visible(ignoreResearch),playerChoices);}
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
function visible(ignoreResearch=false){
 var a=viewGroups();
 a=a.filter(g=>{
   var side=defaultSide(g),r=researchFor(g,boardLine(g),side),rates={};
   ['l5','l10','l15','l20','season'].forEach(k=>rates[k]=r?.windows?.[k]?.hitRate??null);rates.h2h=r?.h2h?.hitRate??null;
   var team=g.team||r?.player?.team||r?.context?.team,opp=r?.matchup?.opponent;
   return g.rows.filter(row=>row.side===side).some(row=>evaluatePropAgainstFilters({...row,sport:g.sport,playerName:g.playerName,market:g.market,team,opponent:opp,gameId:g.eventId,
    gameStartTime:g.gameStartTime,hitRates:rates,projection:r?.context?.projection??null,line:boardLine(g),
    saved:favorites.has(g.key),researchAvailable:r?r.available===true:null,
    isToday:new Date(g.gameStartTime).toDateString()===new Date().toDateString()},
    {search:query,sports:[sport],markets:marketFilter==='all'?[]:[marketFilter],bookmakers:bookFilter==='all'?[]:[bookFilter],side:sideFilter==='all'?'ALL':sideFilter,
     savedOnly:activeView==='saved',researchAvailability:ignoreResearch?'ALL':advanced.availability||'ALL',researchThresholds:ignoreResearch||!rulesEnabled?{}:advanced.thresholds||{},
     teams:advanced.team?[advanced.team]:[],opponents:advanced.opponent?[advanced.opponent]:[],games:advanced.game?[advanced.game]:[],
     timeWindow:advanced.today?'TODAY':'ALL',minProjectionDelta:ignoreResearch||!rulesEnabled?null:advanced.delta??null,startsAfter:dayBoundary(advanced.day),startsBefore:advanced.before||dayBoundary(advanced.day,true)}).matchesFilters);
 });
 function score(g){var r=researchFor(g),c=r?.context||{};if(sortBy==='books')return books(g).length;if(sortBy==='time')return Number.isFinite(Date.parse(g.gameStartTime))?-Date.parse(g.gameStartTime):null;if(sortBy==='projection'){var mp=projectionFor(g,boardLine(g)),pv=mp?.available?num(mp.projection):num(r?.projectedStat?.value??c.projection);return pv==null?null:(defaultSide(g)==='UNDER'?-1:1)*(pv-boardLine(g));}if(sortBy==='research')return r?.available?2:r?.sections?.context?1:0;if(sortBy==='recent')return num(r?.windows?.l5?.hitRate);return num(sortBy==='h2h'?r?.h2h?.hitRate:r?.windows?.[sortBy]?.hitRate);}
 if(sortBy==='shuffle')a.sort((x,y)=>shuffleRank(x)-shuffleRank(y));
 else a.sort((a,b)=>{if(sortBy==='player')return a.playerName.localeCompare(b.playerName);var av=score(a),bv=score(b);return av==null&&bv!=null?1:bv==null&&av!=null?-1:(bv??0)-(av??0)||a.playerName.localeCompare(b.playerName)||a.key.localeCompare(b.key);});
 if(activeView==='players')a.sort((x,y)=>x.playerName.localeCompare(y.playerName)||x.market.localeCompare(y.market));
 if(activeView==='popular')a.sort((x,y)=>books(y).length-books(x).length||x.playerName.localeCompare(y.playerName));
 if(activeView==='discrepancies'){var spreads=new Map(a.map(g=>[g.key,lineSpread(g)]));a=a.filter(g=>spreads.get(g.key)>0);a.sort((x,y)=>spreads.get(y.key)-spreads.get(x.key));}
 if(quick.stale)a=a.filter(g=>staleFor(g));
 if(quick.side)a=a.filter(g=>sideRows(g,quick.side).length);
 if(quick.highEv)a=a.filter(function(g){var e=projectionFor(g,boardLine(g));return e&&e.available&&num(e.ev)!=null&&num(e.ev)>5;});
 return a;
}
// A real disagreement between books on the same side, in the units of the
// market itself. Books that do not quote the side contribute nothing.
function lineSpread(g){
 var side=defaultSide(g),comparison=compareResearchQuotes({...g,rows:g.comparisonOffers||g.rows,archived:!!g.archived||!!payload.meta?.stale},{side});
 var lines=comparison.offers.filter(q=>q.fresh&&q.side===side).map(q=>q.line);
 if(lines.length<2)return 0;
 return Number((Math.max.apply(null,lines)-Math.min.apply(null,lines)).toFixed(2));
}
function researchParams(g,line,side){var q=new URLSearchParams({sport:g.sport,playerName:g.playerName,market:g.market,marketId:g.marketId||'',line:String(line==null?'':line),side:side||defaultSide(g),games:'40',providerPlayerId:g.providerPlayerId||'',homeTeam:g.homeTeam||'',awayTeam:g.awayTeam||'',team:g.team||''});return q.toString();}
async function getResearch(g,line,side,force){
 var valueLine=line==null?boardLine(g):line,valueSide=side||defaultSide(g),key=researchKey(g,valueLine,valueSide);
 if(!force){var cached=researchFor(g,valueLine,valueSide);if(cached)return cached;}
 if(researchInflight.has(key))return researchInflight.get(key);
 var pending=new Promise(resolve=>{if(researchQueue.length>=24){var stale=researchQueue.shift();researchInflight.delete(stale.key);stale.resolve(null);}researchQueue[drawerState?.g.key===g.key?'unshift':'push']({g,line:valueLine,side:valueSide,key,resolve});drainResearch();});
 researchInflight.set(key,pending);return pending;
}
function drainResearch(){while(activeResearch<3&&researchQueue.length){var job=researchQueue.shift();if(job.g.sport!==sport&&drawerState?.g.key!==job.g.key){researchInflight.delete(job.key);job.resolve(null);continue;}activeResearch++;runResearch(job);}}
async function runResearch(job){
 var controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000),out;
 try{var response=await nativeFetch('/api/apex/research?'+researchParams(job.g,job.line,job.side),{signal:controller.signal}),j=await response.json();out=response.ok?j:{available:false,message:'Research is temporarily unavailable.'};}
 catch{out={available:false,message:'Research could not load. Try again shortly.'};}
 finally{clearTimeout(timer);}
 var entry={value:out,expires:Date.now()+(out.available?15:5)*60000};researchCache.set(job.key,entry);researchCache.set('base|'+job.g.key,entry);
 researchInflight.delete(job.key);activeResearch--;job.resolve(out);drainResearch();
}
function hrClass(v){var x=num(v);return x==null?'warn':x>=70?'good':x<45?'bad':'';}
function windowMetric(r,id){var w=r&&r.available&&r.windows&&r.windows[id];return w?'<b class="'+hrClass(w.hitRate)+'">'+pct(w.hitRate)+'</b><div class="asQuote">avg '+dec(w.average,1)+'</div>':'<b>—</b>';}
function projMetric(r,line){var p=r&&r.available&&r.context?num(r.context.projection):null,l=num(line);if(p==null)return'<b>—</b>';var d=l==null?null:p-l;return'<b>'+dec(p,1)+'</b><div class="asQuote '+(d!=null&&d>0?'good':d!=null&&d<0?'bad':'')+'">Δ '+(d==null?'—':(d>0?'+':'')+dec(d,1))+'</div>';}
function bookRail(g){var map=new Map();g.rows.forEach(function(r){var k=r.sportsbookKey||r.sportsbook;if(!map.has(k))map.set(k,{key:k,name:r.sportsbook||k,o:null,u:null});map.get(k)[r.side==='OVER'?'o':'u']=r;});return Array.from(map.values()).sort(function(a,b){return String(a.name).localeCompare(String(b.name));}).map(function(x){return'<div class="asBookChip"><div class="asBookTop"><b>'+esc(String(x.name||x.key).slice(0,14))+'</b><span>'+esc(x.key||'')+'</span></div><div class="asBookVals"><span class="o">O '+esc(x.o?x.o.line:'—')+' '+esc(x.o?money(x.o.price):'')+tacoBadgeHtml(g.archived?null:x.o)+'</span><span class="u">U '+esc(x.u?x.u.line:'—')+' '+esc(x.u?money(x.u.price):'')+tacoBadgeHtml(g.archived?null:x.u)+'</span></div></div>';}).join('');}
// ---------------------------------------------------------------------------
// PickFinder-style compact card.
//
// Every value below comes from the hydrated research payload or from the live
// sportsbook rows. Where a feed supplies nothing the cell renders an em dash;
// nothing here invents a number, and no badge is coloured off an absent value.
// ---------------------------------------------------------------------------
function rateTone(v){var x=num(v);return x==null?'':x>=60?'hot':x<=40?'cold':'';}
function headlineWindow(r){
 if(!r||!r.available||!r.windows)return null;
 var ids=['season','l20','l15','l10','l5'];
 for(var i=0;i<ids.length;i++){var w=r.windows[ids[i]];if(w&&num(w.hitRate)!=null)return{id:ids[i],w:w};}
 return null;
}
// Hits / all eligible games. Pushes occupy their own neutral share; the
// opposite side is NOT 100 minus the active rate when a line can push.
function gaugeRates(r,side){
 var h=headlineWindow(r);if(!h)return null;
 var n=num(h.w.games),hits=num(h.w.hits),misses=num(h.w.misses);
 if(!n||hits==null||misses==null)return null;
 return {over:100*(side==='UNDER'?misses:hits)/n,under:100*(side==='UNDER'?hits:misses)/n,
  basis:(h.id==='season'?'SZN '+(r.season||''):h.w.label||h.id.toUpperCase())+(h.w.partial?' · partial':''),games:n};
}
function researchState(r){
 if(!r)return hydrateFailed?'Research needs retry':'Loading game logs';
 if(r.available)return 'Game log available';
 if(r.code==='NO_GAME_LOG_DATA')return 'No logs available';
 if(r.retryable||r.code==='RESEARCH_PROVIDER_ERROR')return 'Research needs retry';
 return 'Historical statistic unavailable';
}
function ringGauge(rates,r){
 if(!rates)return '<div class="asRing asRingEmpty" title="'+esc(r?.message||researchState(r))+'">'
  +(!r&&!hydrateFailed?'<span class="asStatSkeleton" aria-label="Loading game logs"></span>':'<b>N/A</b>')
  +'<small>'+esc(researchState(r))+'</small></div>';
 var radius=26,c=2*Math.PI*radius,over=Math.max(0,Math.min(100,rates.over)),under=Math.max(0,Math.min(100,rates.under));
 var arc=over/100*c,u=under/100*c;
 return '<div class="asRing"><svg class="asRingSvg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="Over '+over.toFixed(1)+' percent, under '+under.toFixed(1)+' percent; remaining games pushed">'
  +'<circle cx="32" cy="32" r="'+radius+'" fill="none" stroke="#64748b" stroke-width="7"></circle>'
  +'<circle cx="32" cy="32" r="'+radius+'" fill="none" stroke="#f43f5e" stroke-width="7" stroke-dasharray="'+u.toFixed(2)+' '+(c-u).toFixed(2)+'" stroke-dashoffset="'+(-arc).toFixed(2)+'" transform="rotate(-90 32 32)"></circle>'
  +'<circle cx="32" cy="32" r="'+radius+'" fill="none" stroke="#10b981" stroke-width="7" stroke-dasharray="'+arc.toFixed(2)+' '+(c-arc).toFixed(2)+'" transform="rotate(-90 32 32)"></circle>'
  +'<text x="32" y="32" class="asRingMid" text-anchor="middle" dominant-baseline="central">'+Math.round(over)+'%</text>'
  +'</svg><div class="asRingText"><b class="asOverPct">O '+over.toFixed(1)+'%</b><span class="asUnderPct">U '+under.toFixed(1)+'%</span>'
  +'<em>'+esc(rates.basis)+' · '+rates.games+'g</em></div></div>';
}
function badge(id,label,value,tone,sub){
 return '<div class="asBadge '+tone+'"'+(id?' data-column="'+esc(id)+'"':'')+'><small>'+esc(label)+'</small><b>'+esc(value)+'</b><em>'+esc(sub||'')+'</em></div>';
}
function windowBadge(r,id,label,column){
 var w=r&&r.available&&r.windows?r.windows[id]:null,rate=w?num(w.hitRate):null;
 var note=w&&num(w.games)?w.games+'g':'';
 if(id==='season'&&r?.season)note+=(note?' · ':'')+r.season+(w?.partial?' partial':'');
 return badge(column||id,label,rate==null?'N/A':Math.round(rate)+'%',rateTone(rate),note);
}
function h2hBadge(r){
 if(!r||!r.available)return badge('h2h','H2H','N/A','','');
 var games=num(r.coverage?.h2hGames),h=r.h2h||{},hits=num(h.hits),rate=num(h.hitRate);
 if(!games)return badge('h2h','H2H','N/A','','no meetings');
 return badge('h2h','H2H',rate==null?'N/A':Math.round(rate)+'%',rateTone(rate),hits==null?games+'g':hits+'/'+games);
}
function streakBadge(r,side){
 var count=r&&r.available?num(r.streak?.count):null;
 return badge('','STRK',count==null?'N/A':String(count),count==null?'':count>=3?'hot':count===0?'cold':'',count==null?'':side==='UNDER'?'Under':'Over');
}
function averageBadge(r){
 var d=r&&r.available?r.diff:null,value=d?num(d.average):null;
 return badge('average','AVG',value==null?'N/A':value.toFixed(1),'',d?d.basis==='season'?'SZN '+(r.season||''):d.basis.toUpperCase():'');
}
function diffBadge(r,side){
 var d=r&&r.available?r.diff:null,value=d?num(d.value):null;
 if(value==null)return badge('','DIFF','N/A','','');
 var favourable=side==='UNDER'?value<0:value>0;
 return badge('','DIFF',(value<0?'-':'+')+Math.abs(value).toFixed(1),value===0?'':favourable?'hot':'cold','AVG − line');
}
function badgeStrip(g,r,side){
 if(!r&&!hydrateFailed)return '<div class="asBadges" aria-busy="true" aria-label="Loading historical statistics">'
  +['L5','L10','L15','H2H','STRK','AVG','DIFF','SZN'].map(function(label){return '<div class="asBadge"><small>'+label+'</small><span class="asStatSkeleton" aria-hidden="true"></span></div>';}).join('')+'</div>';
 if((r&&!r.available)||(!r&&hydrateFailed))return '<div class="asHistoryGap" role="status"><b>'+esc(researchState(r))+'</b><span>'+esc(r?.message||'This exact statistic has no verified history. The listed lines are still available.')+'</span></div>';
 return '<div class="asBadges" title="'+esc(r?.available?'Hit rates = hits / eligible games. Pushes are not hits and end the streak. Season excludes playoffs and prior seasons.':r?.message||researchState(r))+'">'
  +windowBadge(r,'l5','L5')+windowBadge(r,'l10','L10')+windowBadge(r,'l15','L15')+h2hBadge(r)+streakBadge(r,side)+averageBadge(r)+diffBadge(r,side)+windowBadge(r,'season','SZN','season')+'</div>';
}
// Opponent defensive rank and team moneyline are rendered only when a feed
// actually supplies them. Neither is derivable from the connected player-prop
// and game-log feeds, so on the current data these pills stay hidden rather
// than showing a placeholder that looks like a real ranking.
function matchupPills(r){
 var c=r&&r.context?r.context:{},pills=[];
 var rank=num(c.opponentDefenseRank!=null?c.opponentDefenseRank:c.defenseRank);
 var moneyline=num(c.moneylineProbability!=null?c.moneylineProbability:c.winProbability);
 var injury=c.injuryStatus||c.injury||null;
 if(rank!=null)pills.push('<span class="asPill"><i aria-hidden="true">◆</i> Defense #'+Math.round(rank)+'</span>');
 if(moneyline!=null)pills.push('<span class="asPill">Moneyline '+Math.round(moneyline<=1?moneyline*100:moneyline)+'%</span>');
 if(injury)pills.push('<span class="asPill asPillWarn">'+esc(String(injury).slice(0,28))+'</span>');
 return pills.length?'<div class="asMatchPills">'+pills.join('')+'</div>':'';
}
function oddsStrip(g){
 var map=new Map();
 g.rows.forEach(function(r){var k=r.sportsbookKey||r.sportsbook;if(!map.has(k))map.set(k,{key:k,name:r.sportsbook||k,o:null,u:null});
  map.get(k)[r.side==='OVER'?'o':'u']=r;});
 var chips=Array.from(map.values()).sort(function(a,b){return String(a.name).localeCompare(String(b.name));}).map(function(x){
  return '<div class="asOddsChip"><b>'+esc(String(x.name||x.key).slice(0,16))+'</b><span>'
   +(x.o?'<i class="o">O '+esc(dec(x.o.line))+' '+esc(money(x.o.price))+tacoBadgeHtml(g.archived?null:x.o)+'</i>':'')
   +(x.u?'<i class="u">U '+esc(dec(x.u.line))+' '+esc(money(x.u.price))+tacoBadgeHtml(g.archived?null:x.u)+'</i>':'')+'</span></div>';});
 return chips.length?'<div class="asOddsStrip" aria-label="Sportsbook lines">'+chips.join('')+'</div>':'';
}
// ---------------------------------------------------------------------------
// Modelled projection card.
//
// This is an ESTIMATE, not an observation, and it is labelled as one wherever
// it appears. It never merges into the measured hit-rate badges: the board's
// numbers come from real game logs, these come from a model reading them.
//
// Each projection costs a paid API call, so it is requested per prop on an
// explicit click rather than fanned out across the whole board.
// ---------------------------------------------------------------------------
function staleFor(g){
 if(staleCache.has(g.key))return staleCache.get(g.key);
 var signal=null;
 try{signal=detectStaleLine(g.rows);}catch(e){signal=null;}
 staleCache.set(g.key,signal);
 return signal;
}
function staleBadge(g){
 var signal=staleFor(g);
 if(!signal)return '';
 return '<div class="asStale"><span class="asStaleTag">⚡ Stale Line</span>'
  +'<span class="asStaleText">'+esc(staleLineLabel(signal))+'</span></div>';
}
function projectionKey(g,line){return [g.key,num(line)].join('|');}
// A projection is an estimate of what the player will do, so it survives a
// change of line — only the pricing moves. Nudging the research line used to
// discard the estimate and demand another paid request; now the nearest run
// for this prop is re-priced against the new line in the browser, and the
// edge, EV, model percentage and badge all update immediately. A fresh run is
// still one click away for anything the arithmetic cannot know.
function projectionFor(g,line){
 var target=num(line);
 var exact=projections.get(projectionKey(g,target));
 if(exact)return exact;
 if(target==null)return null;
 var prefix=g.key+'|', best=null, bestGap=Infinity;
 projections.forEach(function(entry,key){
  // Scenario runs carry an '|out:' suffix and answer a different question.
  if(key.indexOf(prefix)!==0||key.indexOf('|out:')>=0)return;
  if(!entry||!entry.available)return;
  var from=num(entry.line);
  if(from==null)return;
  var gap=Math.abs(from-target);
  if(gap<bestGap){bestGap=gap;best=entry;}
 });
 if(!best)return null;
 var over=bestPrice(g,'OVER',target), under=bestPrice(g,'UNDER',target);
 return repriceProjection(best,{line:target,overPrice:over?num(over.price):null,underPrice:under?num(under.price):null});
}
function pickTone(pick){
 var label=String(pick||'');
 return label==='STRONG OVER'?'strongOver':label==='LEAN OVER'?'leanOver'
  :label==='STRONG UNDER'?'strongUnder':label==='LEAN UNDER'?'leanUnder':'pass';
}
function signed(value,digits){var x=num(value);return x==null?'—':(x>0?'+':'')+dec(x,digits==null?1:digits);}
function projectionMetric(label,value,tone,sub){
 return '<div class="asProjMetric '+(tone||'')+'"><small>'+esc(label)+'</small><b>'+esc(value)+'</b>'
  +(sub?'<em>'+esc(sub)+'</em>':'')+'</div>';
}
// Hit-rate pills. A window with no games shows an empty track and says so
// rather than rendering a 0% bar, which reads as "never hits".
function hitPills(r){
 var rows=[['l5','L5'],['l10','L10'],['season','Season']].map(function(w){
  var win=r&&r.available&&r.windows?r.windows[w[0]]:null,rate=win?num(win.hitRate):null;
  var tone=rate==null?'':rate>=60?'hot':rate<=40?'cold':'';
  return '<div class="asPill '+tone+'"><div class="asPillHead"><small>'+w[1]+'</small>'
   +'<b>'+(rate==null?'—':Math.round(rate)+'%')+'</b></div>'
   +'<div class="asPillTrack"><span style="width:'+(rate==null?0:Math.max(2,Math.min(100,rate)))+'%"></span></div>'
   +'<em>'+esc(win&&num(win.games)?win.games+' games':'no sample')+'</em></div>';
 }).join('');
 return '<div class="asPills">'+rows+'</div>';
}
// Full book matrix. Columns are the books this prop actually has; a book that
// is not quoting is absent rather than shown with a blank price.
function quoteComparison(g){return compareResearchQuotes({...g,rows:g.comparisonOffers||g.rows,archived:!!g.archived||!!payload.meta?.stale},{line:drawerState?.line??boardLine(g),side:drawerState?.side||defaultSide(g)});}
function quotePriceCell(q,comparison){
 if(!q)return '<td>—</td>';
 var best=comparison.bestPrices[q.side].some(x=>x.bookKey===q.bookKey&&x.line===q.line&&x.price===q.price);
 var status=q.at==null?'Time unavailable':!q.fresh?'Not ranked · stale':new Date(q.at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
 return '<td class="'+(best?'asBest':'')+'">'+esc(money(q.price))+'<span class="asQuoteTime">'+esc(status)+'</span></td>';
}
function bookMatrix(g){
 var comparison=quoteComparison(g);
 if(!comparison.rows.length)return '<p class="asNotice">No unambiguous regular sportsbook offers are available for this prop.</p>';
 var sharp=staleFor(g);
 var body=comparison.rows.map(row=>'<tr'+(sharp&&(sharp.retailKey===row.bookKey||sharp.sharpKey===row.bookKey)?' class="asMatrixFlag"':'')+'><th scope="row">'+esc(row.name)+'</th><td>'+esc(dec(row.line))+'</td>'+quotePriceCell(row.OVER,comparison)+quotePriceCell(row.UNDER,comparison)+'</tr>').join('');
 return '<div class="asTableWrap"><table class="asTable asMatrix"><thead><tr><th>Book</th><th>Line</th><th>Over price</th><th>Under price</th></tr></thead><tbody>'+body+'</tbody></table></div>'
  +'<p class="asNotice">Highlights compare two or more books at the same '+esc(dec(comparison.selectedLine))+' line and side. Quotes older than 30 minutes or without a source time are not ranked. '+(comparison.omitted.length?'Conflicting or future-dated quotes were excluded.':'')+'</p>';
}
// Scenario sandbox. The team-mate list is the real depth chart; toggling one
// out re-runs the actual projection with that absence in the payload. There is
// no fixed usage bump here — an invented percentage would not be a simulation.
function sandboxPanel(g,line,side){
 if(sandbox.key!==g.key)return '<p class="asNotice">Loading team-mates…</p>';
 if(sandbox.loading)return '<div class="asLoading" role="status"><div class="asPulse"></div>Loading team-mates…</div>';
 var roster=sandbox.roster;
 if(!roster||!roster.available){
  return '<p class="asNotice">The roster feed is not enabled, so there is no team-mate list to simulate against. '
   +'Turn on AUTOSCOUT_INJURY_FEED with a SportsDataIO key to use this.</p>';
 }
 if(!roster.teammates.length)return '<p class="asNotice">No team-mates were returned for this team.</p>';
 var chips=roster.teammates.slice(0,12).map(function(mate){
  var on=sandbox.out.has(mate.playerName);
  return '<button class="asChip asSandboxChip '+(on?'on':'')+'" data-sandbox="'+esc(mate.playerName)+'" aria-pressed="'+on+'">'
   +esc(mate.playerName)+(mate.position?' <em>'+esc(mate.position)+'</em>':'')
   +(mate.injuryStatus?' <i>'+esc(mate.injuryStatus)+'</i>':'')+'</button>';
 }).join('');
 var out=Array.from(sandbox.out);
 var entry=out.length?projections.get(projectionKey(g,line)+'|out:'+out.slice().sort().join(',')):null;
 var result='';
 if(out.length){
  result=entry&&entry.available
   ? '<div class="asSandboxResult"><span class="asPickBadge '+pickTone(entry.pick)+'">'+esc(entry.pick)+'</span>'
     +'<span class="asPredictFig"><small>Projection</small><b>'+esc(dec(entry.projection,1))+'</b></span>'
     +'<span class="asPredictFig"><small>Edge</small><b>'+esc(signed(entry.edge,1))+'</b></span>'
     +'<span class="asPredictFig"><small>EV</small><b>'+esc(num(entry.ev)==null?'—':signed(entry.ev,1)+'%')+'</b></span></div>'
     +(entry.primaryDriver?'<p class="asPredictDriver">'+esc(entry.primaryDriver)+'</p>':'')
   : '<button class="asBtn asPrimary" id="asSandboxRun">Re-estimate with '+out.length+' out</button>';
 }
 return '<p class="asNotice">Mark a team-mate out and re-estimate. The model re-reads the same game log with that absence noted'
  +(roster.injuryReport?'':' — the plan in use does not carry injury status, so these are roster names only')+'.</p>'
  +'<div class="asSandboxChips">'+chips+'</div>'+result
  +'<p class="asPredictFootnote">A simulated estimate, not a measured outcome.</p>';
}
// Ask: a short grounded conversation about this prop.
function askPanel(g,line,side){
 var thread=askThreads.get(g.key)||[];
 var busy=askPending.has(g.key);
 var log=thread.map(function(turn){
  return '<div class="asAskTurn '+(turn.role==='user'?'user':'bot')+'"><b>'+(turn.role==='user'?'You':'Claude')+'</b>'
   +'<p>'+esc(turn.content)+'</p></div>';
 }).join('');
 return (log?'<div class="asAskLog">'+log+'</div>':'')
  +(busy?'<div class="asLoading" role="status"><div class="asPulse"></div>Thinking…</div>':'')
  +'<form class="asAskForm" id="asAskForm"><label class="asSrOnly" for="asAskInput">Ask about this prop</label>'
  +'<input class="asControl" id="asAskInput" placeholder="Ask about this prop…" maxlength="500" autocomplete="off"'+(busy?' disabled':'')+'>'
  +'<button class="asBtn asPrimary" type="submit"'+(busy?' disabled':'')+'>Ask</button></form>'
  +'<p class="asPredictFootnote">Answers come from the same data on this card. Not betting advice.</p>';
}
// data_gaps is the model naming evidence it did not get. It is genuinely
// useful — it is why a confidence is low — but the raw field names read like
// debug output, so they are translated into product copy and anything without
// a translation is summarised rather than printed verbatim.
var GAP_COPY={
 opponentDefenseRank:'how this defence ranks',
 opponentPaceRank:'the opponent\'s pace',
 restDays:'days of rest',
 gamesInLastSevenDays:'recent schedule load',
 isBackToBack:'back-to-back status',
 injuryStatus:'an injury report',
 teamMoneyline:'the game line',
 gameTotal:'the game total',
 minutes:'minutes played',
 expectedMinutes:'expected minutes',
 projection:'a projection feed',
 gameLog:'a full game log',
};
function describeGaps(gaps){
 var known=[],unknown=0;
 (gaps||[]).forEach(function(gap){
  var copy=GAP_COPY[String(gap).trim()];
  if(copy&&known.indexOf(copy)<0)known.push(copy);else if(!copy)unknown++;
 });
 if(!known.length)return unknown?'Some context was unavailable for this estimate.':'';
 var list=known.length===1?known[0]
  :known.slice(0,-1).join(', ')+' and '+known[known.length-1];
 return 'Estimated without '+list+(unknown?', among other context':'')+'.';
}
// The deep-dive sections. The server has already dropped any the model could
// not ground in the payload, so an absent section here means there was nothing
// to say — not that the analysis failed.
function analysisHtml(entry){
 var sections=entry&&Array.isArray(entry.analysis)?entry.analysis:[];
 if(!sections.length)return '';
 return '<div class="asAnalysis">'+sections.map(function(row){
  return '<details class="asAnalysisRow"><summary>'+esc(row.label)+'</summary><p>'+esc(row.body)+'</p></details>';
 }).join('')+'</div>';
}
function projectionCard(g,line){
 var key=projectionKey(g,line), entry=projectionFor(g,line);
 var head='<div class="asSectionTitle"><h3>Modelled projection</h3><span>Model estimate · not a measured statistic</span></div>';
 if(projectionPending.has(key)){
  return '<section class="asSection asProjection">'+head+'<div class="asSectionBody"><div class="asLoading" role="status"><div class="asPulse"></div>Modelling this prop — the full breakdown can take up to a minute.</div></div></section>';
 }
 if(!entry){
  // Reaching here means there is no run to re-price — either none yet, or one
  // whose game log was too short to measure a spread from, which is the only
  // case where moving the line genuinely needs the model again.
  var other=Array.from(projections.keys()).some(function(k){return k.indexOf(g.key+'|')===0;});
  return '<section class="asSection asProjection">'+head+'<div class="asSectionBody">'
   +'<p class="asNotice">'+(other
     ? 'This prop\u2019s game log was too short to re-price the estimate at a new line. Run it again to estimate against this line directly.'
     : 'Estimate this prop against the current line using the connected model. Uses one paid request.')+'</p>'
   +'<button class="asBtn asPrimary" data-project="'+esc(g.key)+'">Run projection</button></div></section>';
 }
 if(!entry.available){
  return '<section class="asSection asProjection">'+head+'<div class="asSectionBody">'
   +'<p class="asAvailability">'+esc(entry.message||'A modelled projection is unavailable for this prop.')+'</p>'
   +'<button class="asBtn" data-project="'+esc(g.key)+'">Try again</button></div></section>';
 }
 var pick=entry.pick||'PASS', tone=pickTone(pick);
 var evTone=num(entry.ev)==null?'':num(entry.ev)>0?'good':'bad';
 var edgeTone=num(entry.edge)==null?'':num(entry.edge)>0?'good':num(entry.edge)<0?'bad':'';
 var gaps=Array.isArray(entry.dataGaps)?entry.dataGaps:[];
 return '<section class="asSection asProjection">'+head+'<div class="asSectionBody">'
  +'<div class="asProjHead">'
   +'<div class="asProjVs">'
    +'<div class="asProjVsCell"><small>Modelled</small><b>'+esc(dec(entry.projection,1))+'</b></div>'
    +'<span class="asProjVsSep" aria-hidden="true">vs</span>'
    +'<div class="asProjVsCell"><small>Current line</small><b>'+esc(dec(entry.line,1))+'</b></div>'
   +'</div>'
   +'<span class="asPickBadge '+tone+'">'+esc(pick)+'</span>'
  +'</div>'
  +'<div class="asProjMetrics">'
   +projectionMetric('Edge',signed(entry.edge,1),edgeTone,num(entry.edgePercent)==null?'':signed(entry.edgePercent,0)+'%')
   +projectionMetric('EV',num(entry.ev)==null?'—':signed(entry.ev,1)+'%',evTone,entry.side?entry.side.toLowerCase():'no side')
   +projectionMetric('Confidence',num(entry.confidence)==null?'—':Math.round(entry.confidence)+'%','',
     num(entry.confidence)==null?'':num(entry.confidence)>=65?'strong evidence':num(entry.confidence)>=50?'moderate':'thin evidence')
   +projectionMetric('Model over%',num(entry.probabilityOver)==null?'—':Math.round(entry.probabilityOver*100)+'%','',
     num(entry.impliedOver)==null?'':'book '+Math.round(entry.impliedOver*100)+'%')
  +'</div>'
  +(entry.primaryDriver?'<p class="asProjDriver"><small>Primary driver</small>'+esc(entry.primaryDriver)+'</p>':'')
  +analysisHtml(entry)
  +(gaps.length?'<p class="asNotice asProjGaps">'+esc(describeGaps(gaps))+'</p>':'')
  +'<p class="asProjFootnote">'+esc(entry.repriced
     ? 'Projection of '+dec(entry.projection,1)+' from the model run at '+dec(entry.modelLine,1)+', re-priced against this line from the spread of the player\u2019s own game log. Run it again to re-estimate the projection itself.'
     : 'Model estimate generated '+when(entry.generatedAt)+'.')+' Not a measured statistic and not betting advice.</p>'
  +'<button class="asBtn" data-project="'+esc(g.key)+'">Re-run</button>'
  +'</div></section>';
}
async function loadRoster(g){
 if(sandbox.key===g.key&&(sandbox.roster||sandbox.loading))return;
 sandbox={key:g.key,out:new Set(),roster:null,loading:true};
 renderDrawer();
 var query=new URLSearchParams({sport:g.sport,team:g.team||'',playerName:g.playerName});
 var out=null;
 try{
  var response=await nativeFetch('/api/props/teammates?'+query.toString());
  out=await response.json();
 }catch(e){out={available:false};}
 if(sandbox.key!==g.key)return;
 sandbox.roster=out;sandbox.loading=false;
 renderDrawer();
}
async function askAbout(g,line,side,question){
 if(askPending.has(g.key))return;
 var thread=askThreads.get(g.key)||[];
 thread=thread.concat([{role:'user',content:question}]);
 askThreads.set(g.key,thread);askPending.add(g.key);renderDrawer();
 var r=researchFor(g,line,side)||null;
 var body={question:question,history:thread.slice(0,-1),
  prop:{sport:g.sport,playerName:g.playerName,market:g.market,marketId:g.marketId||'',line:num(line),side:side,
   team:g.team||'',homeTeam:g.homeTeam||'',awayTeam:g.awayTeam||'',
   overPrice:(bestPrice(g,'OVER',line,true)||{}).price??null,
   underPrice:(bestPrice(g,'UNDER',line,true)||{}).price??null,
   windows:r&&r.windows?r.windows:null,
   gameLog:r&&Array.isArray(r.gameLog)?r.gameLog.slice(0,25):[]}};
 var answer;
 try{
  var response=await nativeFetch('/api/props/ask',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  var j=await response.json();
  answer=j&&j.available?j.answer:(j&&j.message)||'That question could not be answered right now.';
 }catch(e){answer='That question could not be answered right now.';}
 askPending.delete(g.key);
 askThreads.set(g.key,(askThreads.get(g.key)||[]).concat([{role:'assistant',content:answer}]));
 if(drawerState&&drawerState.g.key===g.key)renderDrawer();
}
async function runProjection(g,line,side){
 var outNames=(arguments.length>3&&arguments[3])?arguments[3]:[];
 var key=projectionKey(g,line)+(outNames.length?'|out:'+outNames.slice().sort().join(','):'');
 if(projectionPending.has(key))return;
 projectionPending.add(key);renderDrawer();
 var quote=bestPrice(g,'OVER',line,true), under=bestPrice(g,'UNDER',line,true);
 var r=researchFor(g,line,side)||null;
 var body={sport:g.sport,playerName:g.playerName,market:g.market,marketId:g.marketId||'',line:num(line),
  team:g.team||'',position:g.position||'',homeTeam:g.homeTeam||'',awayTeam:g.awayTeam||'',
  gameStartTime:g.gameStartTime||'',opponent:r&&r.matchup?r.matchup.opponent||'':'',
  overPrice:quote?num(quote.price):null,underPrice:under?num(under.price):null,
  books:g.rows.slice(0,24).map(function(row){return {sportsbook:row.sportsbook||row.sportsbookKey,line:num(row.line),
   overPrice:row.side==='OVER'?num(row.price):null,underPrice:row.side==='UNDER'?num(row.price):null};}),
  windows:r&&r.windows?r.windows:null,
  gameLog:r&&Array.isArray(r.gameLog)?r.gameLog.slice(0,25).map(function(x){return {date:x.date,opponent:x.opponent,isHome:x.isHome,value:x.value,minutes:x.minutes};}):[],
  injuryStatus:r&&r.context?r.context.injuryStatus||'':'',
  teammatesOut:outNames.map(function(name){return {playerName:name};})};
 var out;
 try{
  var response=await nativeFetch('/api/props/project',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  out=await response.json();
  if(!response.ok&&!out)throw Error('projection');
 }catch(e){out={available:false,message:'The projection could not be generated. Try again shortly.'};}
 projectionPending.delete(key);projections.set(key,out);
 if(drawerState&&drawerState.g.key===g.key)renderDrawer();
 if(g.sport===sport)renderListLight();
 renderSlip();
}
// Inline prediction on the board card. One explicit click, one paid request:
// nothing here fires on render, on scroll, or on a page change.
// The verdict sits at the top-right of the card, next to the gauge, so a
// scanner sees the call and the two numbers behind it without opening the
// prop. It appears only once a prediction exists for THIS line.
function headerVerdict(g,line){
 var entry=projectionFor(g,line);
 if(!entry||!entry.available)return '';
 var over=num(entry.probabilityOver);
 var side=entry.side==='UNDER'?'under':'over';
 var shown=side==='under'?num(entry.probabilityUnder):over;
 return '<div class="asVerdict">'
  +'<span class="asPickBadge '+pickTone(entry.pick)+'">'+esc(entry.pick||'PASS')+'</span>'
  +'<div class="asVerdictFigs">'
   +'<span><small>Model '+esc(side)+'</small><b>'+(shown==null?'—':Math.round(shown*100)+'%')+'</b></span>'
   +'<span><small>Edge</small><b>'+esc(signed(entry.edge,1))+'</b></span>'
  +'</div></div>';
}
function projectedStatStrip(g,line){
 var model=projectionFor(g,line),r=researchFor(g,line),estimate=r?.projectedStat;
 var value=model?.available?num(model.projection):num(estimate?.value);
 if(value==null)return '<div class="asProjectedStat"><span>Projected stat</span><b>Unavailable</b><small>Needs verified game history</small></div>';
 return '<div class="asProjectedStat"><span>Projected stat</span><b>'+esc(dec(value,1))+'</b><small>'+esc(model?.available?'AI model estimate':(estimate.sampleSize+' games · recent-form estimate'))+'</small></div>';
}
function predictionStrip(g,line){
 var key=projectionKey(g,line), entry=projectionFor(g,line);
 if(projectionPending.has(key)){
  return '<div class="asPredict asPredictBusy" role="status">Generating prediction…</div>';
 }
 if(!entry){
  return projectedStatStrip(g,line)+'<div class="asPredict"><button class="asBtn asPrimary asPredictBtn" data-predict="'+esc(g.key)+'">Generate AI Prediction</button></div>';
 }
 if(!entry.available){
  return projectedStatStrip(g,line)+'<div class="asPredict"><span class="asPredictNote">'+esc(entry.message||'Prediction unavailable.')+'</span>'
   +'<button class="asBtn asPredictBtn" data-predict="'+esc(g.key)+'">Retry</button></div>';
 }
 var evTone=num(entry.ev)==null?'':num(entry.ev)>0?'good':'bad';
 return projectedStatStrip(g,line)+'<div class="asPredict asPredictDone">'
  +'<div class="asPredictTop">'
   +'<span class="asPickBadge '+pickTone(entry.pick)+'">'+esc(entry.pick||'PASS')+'</span>'
   +'<span class="asPredictFig"><small>Edge</small><b>'+esc(signed(entry.edge,1))+'</b></span>'
   +'<span class="asPredictFig"><small>EV</small><b class="'+evTone+'">'+esc(num(entry.ev)==null?'—':signed(entry.ev,1)+'%')+'</b></span>'
   +'<span class="asPredictFig"><small>Conf</small><b>'+esc(num(entry.confidence)==null?'—':Math.round(entry.confidence)+'%')+'</b></span>'
   +'<button class="asBtn asPredictBtn" data-predict="'+esc(g.key)+'">Re-run</button>'
  +'</div>'
  +(entry.primaryDriver?'<p class="asPredictDriver">'+esc(entry.primaryDriver)+'</p>':'')
  +'<p class="asPredictFootnote">'+esc(calibrationNote(entry))+'</p>'
  +'</div>';
}
// Say how the number was reconciled, in one line. A projection blended against
// eight real games is a different claim from one the log was too short to
// check, and the customer is entitled to know which they are looking at.
function calibrationNote(entry){
 var c=entry&&entry.calibration;
 if(!c||!c.applied)return 'Model estimate — not a measured statistic. The game log was too short to calibrate against.';
 var parts=['Model estimate, calibrated against '+c.sampleSize+' logged games'];
 if(c.clamped)parts.push('pulled back into the range those games support');
 return parts.join(' · ')+'. Not a measured statistic.';
}
function mlTarget(g,line,side){
 var q=bestPrice(g,side,line)||sideRows(g,side).find(x=>num(x.line)===num(line)&&(bookFilter==='all'||x.sportsbookKey===bookFilter));
 return q&&!g.archived?{sport:g.sport,eventId:g.eventId,playerId:g.playerId,playerName:g.playerName,marketId:g.marketId,sportsbookKey:q.sportsbookKey,gameStartTime:g.gameStartTime,line:num(line),entityType:g.entityType||'player',live:!!g.live,isAlternate:!!q.isAlternate}:null;
}
function mlPanel(g,line,side){
 var target=mlTarget(g,line,side),key=predictionKey(target);
 return '<div class="asMLHost" data-ml-target="'+esc(key?JSON.stringify(target):'null')+'" data-ml-side="'+esc(side)+'">'+predictionHtml(target?mlClient.peek(target):{available:false,code:'TARGET_UNVERIFIED',message:'No current sportsbook offer matches this research line.'},side)+'</div>';
}
function hydrateML(){
 if(document.hidden)return;
 document.querySelectorAll('.asMLHost').forEach(function(host){
  var target;try{target=JSON.parse(host.dataset.mlTarget);}catch{return;}if(!target)return;
  var token=host.dataset.mlTarget;
  mlClient.lookup(target).then(function(value){
   if(!host.isConnected||host.dataset.mlTarget!==token||host.contains(document.activeElement))return;
   var opened=!!host.querySelector('details[open]');host.innerHTML=predictionHtml(value,host.dataset.mlSide);
   if(opened)host.querySelector('details')?.setAttribute('open','');
  });
 });
}
function rowHtml(g){
 var line=boardLine(g),side=defaultSide(g);
 var quote=bestPrice(g,side,line)||sideRows(g,side).find(x=>num(x.line)===num(line)&&(bookFilter==='all'||x.sportsbookKey===bookFilter));
 var r=researchFor(g,line,side),c=r&&r.context?r.context:{};
 var team=g.team||(r&&r.player?r.player.team:null)||c.team,position=g.position||c.position||c.playerPosition;
 var state=researchState(r);
 var marketLabel=(line==null?'':'O/U '+dec(line)+' ')+(r?.marketDisplayName||g.market);
 return '<article class="asRow asCard" data-open="'+esc(g.key)+'" tabindex="0" aria-label="Research '+esc(g.playerName+' '+g.market)+'">'
  +'<div class="asCardHead">'
   +'<div class="asAvatar"><div class="asAvatarFallback">'+esc(initials(g.playerName))+'</div>'+(g.entityType==='team'?'':'<img loading="lazy" decoding="async" data-player-photo src="'+esc(artUrl(g))+'" alt="'+esc(g.playerName)+'"> ')+'</div>'
   +'<div class="asCardId"><div class="asCardName"><span class="asPlayer">'+esc(r?.entityType==='team'?r.player?.playerName||g.playerName:g.playerName)+'</span>'
    +(displayTeam(team)?'<span class="asTeamBadge">'+esc(displayTeam(team))+'</span>':'')
    +(position?'<span class="asPos">'+esc(position)+'</span>':'')+'</div>'
    +'<div class="asCardMatch"><span>'+esc(displayTeam(g.awayTeam)+' @ '+displayTeam(g.homeTeam))+'</span><span class="asCardTime">'+esc(when(g.gameStartTime))+'</span></div>'
    +playerChoiceControl(g)+'<div class="asCardMarket">'+esc(marketLabel)+(quote&&num(quote.price)!=null?'<span class="asCardPrice">'+esc(side+' '+money(quote.price))+(quote.sportsbook?' · '+esc(quote.sportsbook):'')+'</span>':'')+'</div>'
   +'</div>'
   +'<div class="asCardGauge">'+headerVerdict(g,line,side)+ringGauge(gaugeRates(r,side),r)+'</div>'
  +'</div>'
  +matchupPills(r)
  +badgeStrip(g,r,side)
  +staleBadge(g)
  +oddsStrip(g)
  +mlPanel(g,line,side)
  +predictionStrip(g,line)
  +'<div class="asRowActions"><span class="asResearchState '+(r&&r.available?'ready':'')+'">'
   +esc(g.archived?'Saved snapshot · no current line':state)+'</span>'
   +'<span class="asRowUpdated">'+esc(g.archived?shortDate(g.savedAt):shortDate(g.rows[0]&&g.rows[0].providerUpdatedAt))+'</span>'
   +'<button class="asBtn asSlipAdd" data-slip="'+esc(g.key)+'">'+(slip.some(function(x){return x.key===g.key;})?'✓ In slip':'+ Add to Slip')+'</button>'
   +'<button class="asSave '+(favorites.has(g.key)?'on':'')+'" data-fav="'+esc(g.key)+'" aria-label="'
   +(favorites.has(g.key)?'Unsave':'Save')+' '+esc(g.playerName+' '+g.market)+'" aria-pressed="'+favorites.has(g.key)+'"'
   +(savePending.has(g.key)?' disabled aria-busy="true"':'')+'>'+(favorites.has(g.key)?'★ Saved':'☆ Save')+'</button>'
  +'</div></article>';
}

function renderPagination(total){
 var host=document.getElementById('asMore');
 if(!host)return;
 var pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
 if(total<=PAGE_SIZE){host.innerHTML='';return;}
 var first=(page-1)*PAGE_SIZE+1, last=Math.min(total,page*PAGE_SIZE);
 host.innerHTML='<nav class="asPager" aria-label="Board pages">'
  +'<button class="asBtn" id="asPrev" '+(page<=1?'disabled':'')+'>Previous</button>'
  +'<span class="asPagerState" aria-live="polite">Page '+page+' of '+pages
   +'<em>'+first+'–'+last+' of '+total+' players</em></span>'
  +'<button class="asBtn" id="asNext" '+(page>=pages?'disabled':'')+'>Next</button>'
  +'</nav>';
 var go=function(next){
  page=Math.max(1,Math.min(pages,next));
  renderListLight();
  document.querySelector('.asMain')?.scrollIntoView({block:'start',behavior:prefs.reduceMotion?'auto':'smooth'});
 };
 document.getElementById('asPrev').onclick=function(){go(page-1);};
 document.getElementById('asNext').onclick=function(){go(page+1);};
}
function renderSummary(){var gs=groups(),events=uniq(gs.map(function(g){return g.eventId;})).length,booksAll=uniq(gs.flatMap(function(g){return books(g);})).length,ready=gs.filter(function(g){var r=researchFor(g);return r&&r.available;}).length;document.getElementById('asSummary').innerHTML=[['Markets',gs.length],['Events',events],['Sportsbooks',booksAll],['Research ready',ready],['Live lines',(payload.props||[]).length]].map(function(x){return'<div class="asSummaryItem"><small>'+esc(x[0])+'</small><b>'+esc(x[1])+'</b></div>';}).join('');}
function renderList(){persistFilters();updateFilterStatus();renderListLight();}
function bindRows(){
 document.querySelectorAll('[data-player-photo]').forEach(img=>{img.onerror=()=>{img.hidden=true;img.parentElement.title='Photo unavailable for '+img.alt;};});
 document.querySelectorAll('[data-card-choice]').forEach(select=>{select.onclick=e=>e.stopPropagation();select.onkeydown=e=>e.stopPropagation();select.onchange=e=>{e.stopPropagation();playerChoices.set(select.dataset.cardChoice,select.value);renderListLight();};});
 document.querySelectorAll('[data-slip]').forEach(b=>b.onclick=e=>{e.stopPropagation();toggleSlip(b.dataset.slip);});
 document.querySelectorAll('[data-predict]').forEach(b=>b.onclick=e=>{
  e.stopPropagation();
  var g=groups().find(x=>x.key===b.dataset.predict);
  if(g)runProjection(g,boardLine(g),defaultSide(g));
 });
 document.querySelectorAll('[data-open]').forEach(el=>{var open=()=>{var g=groups().find(x=>x.key===el.dataset.open)||(()=>{var saved=savedRecords.get(el.dataset.open);return saved?{...saved,archived:true}:null;})();if(g)openDrawer(g);};el.onclick=open;el.onkeydown=e=>{if(e.target===el&&(e.key==='Enter'||e.key===' ')){e.preventDefault();open();}};});document.querySelectorAll('[data-fav]').forEach(b=>b.onclick=async e=>{e.stopPropagation();b.disabled=true;await toggleSaved(b.dataset.fav);renderListLight();});}
// Resolve the visible slate in one request so the board arrives with its hit
// rates already computed, instead of a grid of dashes waiting on clicks.
function hydrateKeyFor(g){return researchKey(g,boardLine(g),defaultSide(g));}
function hydrateTargets(){
 // Hydrate the page the reader is actually viewing, not the first forty rows
 // of the entire sport. Four per response allows visible progress.
 var shown=cardList(),candidates=shown.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
 var needsResearch=(advanced.availability&&advanced.availability!=='ALL')||(rulesEnabled&&Object.values(advanced.thresholds||{}).some(v=>num(v)!=null));
 if(needsResearch)candidates=candidates.concat(cardList(true));
 else if(!shown.length)candidates=cardList(true).slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
 candidates=Array.from(new Map(candidates.map(g=>[g.key,g])).values());
 return candidates.filter(function(g){
  var key=hydrateKeyFor(g);
  return !researchFor(g,boardLine(g),defaultSide(g))&&!researchInflight.has(key)&&!hydrated.has(key);
 }).slice(0,4);
}
async function hydrateBoard(){
 if(hydrating||loading)return;
 var targets=hydrateTargets();if(!targets.length)return;
 var jobs=targets.map(g=>({g,key:hydrateKeyFor(g),line:boardLine(g),side:defaultSide(g)}));
 var generation=loadGeneration,selected=sport,controller=new AbortController();
 hydrateController=controller;hydrating=true;
 targets.forEach(function(g){var key=hydrateKeyFor(g);hydrated.add(key);hydratePending.add(key);});
 renderBatchControl();
 var timer=setTimeout(function(){controller.abort();},40000);
 try{
  var response=await nativeFetch('/api/apex/research-batch',{method:'POST',signal:controller.signal,headers:{'content-type':'application/json'},
   body:JSON.stringify({props:jobs.map(function(job,index){var {g,line,side}=job;
    // A short opaque batch key cannot be silently truncated by the API.
    return {key:String(index),sport:g.sport,playerName:g.playerName,market:g.market,marketId:g.marketId||'',
     providerPlayerId:g.providerPlayerId||'',line:line,side:side,team:g.team||'',homeTeam:g.homeTeam||'',awayTeam:g.awayTeam||'',games:40};})})});
  var body=await response.json();
  if(generation!==loadGeneration||selected!==sport)return;
  if(!response.ok||!body?.results)throw Error('batch');
  jobs.forEach(function(job,index){
   var g=job.g,key=job.key,out=body.results[String(index)]||{available:false,code:'RESEARCH_PROVIDER_ERROR',retryable:true,message:'This lookup did not complete. Retry research.'};
   var entry={value:out,expires:Date.now()+(out.retryable?1:out.available?15:5)*60000};
   researchCache.set(key,entry);researchCache.set('base|'+g.key,entry);
  });
 }catch(e){if(generation===loadGeneration&&selected===sport)hydrateFailed=true;}
 finally{
  clearTimeout(timer);
  if(hydrateController===controller){
   hydrateController=null;hydrating=false;
   jobs.forEach(function(job){hydratePending.delete(job.key);});
   if(generation===loadGeneration&&selected===sport)renderListLight();
  }
 }
}
function retryResearch(){
 hydrated.clear();hydrateFailed=false;
 for(var entry of researchCache){if(entry[1]?.value?.retryable||entry[1]?.value?.code==='RESEARCH_PROVIDER_ERROR')researchCache.delete(entry[0]);}
 renderListLight();
}
function renderBatchControl(){
 var batch=document.getElementById('asResearchBatch');if(!batch)return;
 if(loading){batch.disabled=true;batch.textContent='Loading board…';return;}
 var pending=hydrateTargets().length,retry=hydrateFailed||cardList().some(function(g){return researchFor(g)?.retryable;});
 batch.disabled=hydrating;
 batch.textContent=hydrating?'Loading game logs…':retry?'Retry research':pending?'Load visible research':'Visible research loaded';
 batch.onclick=retry?retryResearch:hydrateBoard;
}
async function prefetch(list){await Promise.all(list.map(async g=>{await getResearch(g,boardLine(g),defaultSide(g),false);if(g.sport===sport)renderListLight();}));}
function renderListLight(){
 var viewNote=document.getElementById('asViewNote'),notes={popular:'Sorted by the number of sportsbooks quoting each prop. User pick popularity is unavailable.',discrepancies:'Largest line differences across fresh, verified books on the selected side. Differences are in each market’s own units and are not an EV ranking.'};
 viewNote.hidden=!notes[activeView];viewNote.textContent=notes[activeView]||'';
 renderPropTypes();
 var list=document.getElementById('asList'),a=cardList(),focused=(list.contains(document.activeElement)||document.querySelector('.asHeaderRow').contains(document.activeElement))?focusToken(document.activeElement):null,origin=focusToken(lastFocus);
 applyColumnHeaders();document.getElementById('asResultCount').textContent=a.length+' players · '+(marketFilter==='all'?'grouped props':marketFilter)+' · '+(activeView==='saved'?(saveLoadError?'Saved props unavailable':serverSaves?'Saved to access profile':'Saved on this device'):'Available board');
 if(!a.length){list.innerHTML='<div class="asEmpty"><b>'+esc(activeView==='saved'?'No saved props in this view.':payload.meta?.warning?'Props could not load.':(payload.props||[]).length?'No props match your filters.':'No live props available for '+sport+'.')+'</b><p>'+esc(activeView==='saved'?'Save a prop to return to it here.':(payload.props||[]).length?'Clear filters or try another market.':'Try another sport or refresh shortly.')+'</p><button class="asBtn" id="asResetEmpty">'+((payload.props||[]).length?'Clear filters':'Refresh')+'</button></div>';document.getElementById('asResetEmpty').onclick=()=>{query='';marketFilter=bookFilter=sideFilter='all';advanced={};document.getElementById('asSearch').value='';document.getElementById('asSide').value='all';renderAdvanced();renderControls();(payload.props||[]).length?renderList():load();};}
 else{var pages=Math.max(1,Math.ceil(a.length/PAGE_SIZE));if(page>pages)page=pages;if(page<1)page=1;
  list.innerHTML=a.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE).map(rowHtml).join('');bindRows();}
 hydrateML();
 renderPagination(a.length);
 renderBatchControl();
 if(!hydrateFailed)hydrateBoard();
 renderSummary();renderQuick();lastFocus=focusElement(origin)||lastFocus;if(focused&&!drawerState)restoreFocus(focused);
 intelligence?.updateBoard({groups:a,allGroups:groups(),scope:sport,at:payload.meta?.fetchedAt,stale:payload.meta?.stale});
}
// Fisher-Yates. Walks the array from the end, swapping each element with a
// uniformly chosen one at or before it, so every permutation is equally likely.
function fisherYates(list){
 var a=list.slice();
 for(var i=a.length-1;i>0;i--){
  var j=Math.floor(Math.random()*(i+1));
  var swap=a[i];a[i]=a[j];a[j]=swap;
 }
 return a;
}
// Shuffled once per load, not once per render: re-drawing the board when a
// filter changes or research lands must not move a card out from under the
// reader's finger, and a page number has to mean the same thing twice.
function reshuffleBoard(){
 shuffleOrder=new Map();
 fisherYates(groups().map(function(g){return g.key;})).forEach(function(key,index){shuffleOrder.set(key,index);});
}
function shuffleRank(g){var v=shuffleOrder.get(g.key);return v==null?Number.MAX_SAFE_INTEGER:v;}
function normTeam(v){return String(v||'').toUpperCase().replace(/[^A-Z]/g,'');}
function recalcFromGameLog(base,line,side){return analyzeResearch({...base,averageWindow:drawerState?.window||'l10'},line,side,drawerState?.filter||'all');}
function marketOptions(g){var candidates=viewGroups();if(!candidates.some(x=>x.key===g.key))candidates.push(g);return candidates.filter(function(x){return x.sport===g.sport&&x.eventId===g.eventId&&x.playerName===g.playerName;}).map(function(x){return'<option value="'+esc(x.key)+'" '+(x.key===g.key?'selected':'')+'>'+esc(x.market)+'</option>';}).join('');}
function averageField(rows,field){
 var values=(rows||[]).map(function(row){return num(row[field]);}).filter(function(v){return v!=null;});
 if(!values.length)return null;
 return values.reduce(function(a,b){return a+b;},0)/values.length;
}
// Usage tiles differ by sport because the feeds do. Minutes exist for
// basketball and hockey; football and baseball carry different columns
// entirely. Every figure here is averaged from the real game log, and a metric
// the log does not carry is omitted rather than defaulted — a "sensible
// default" minutes figure reads as measured and is not.
function usageTiles(r,sport){
 var rows=r&&Array.isArray(r.gameLog)?r.gameLog:[];
 var wanted=sport==='NBA'||sport==='WNBA'?[['Average minutes','minutes']]
  :sport==='NHL'?[['Average time on ice','minutes']]
  :sport==='NFL'||sport==='NCAAF'?[['Targets / game','targets'],['Rush attempts / game','rushingAttempts'],['Pass attempts / game','passingAttempts']]
  :sport==='MLB'?[['Hits / game','hits'],['Strikeouts / game','strikeouts']]
  :[];
 return wanted.map(function(t){return [t[0],averageField(rows,t[1])];})
  // A metric a player never accumulates (a receiver's rush attempts) is
  // clutter rather than signal, so a flat zero is dropped with the nulls.
  .filter(function(t){return t[1]!=null&&t[1]!==0;})
  .map(function(t){return [t[0],dec(t[1],1)];});
}
function contextGrid(r,line,g){
 var c=r&&r.context?r.context:{};
 var sport=(g&&g.sport)||(r&&r.player&&r.player.sport)||'';
 // The board's own projection feed is empty, but a generated model estimate is
 // a real number for this prop — bind the tile to it and label it as modelled.
 var modelled=g?projectionFor(g,line):null;
 var projection=num(c.projection);
 if(projection==null&&modelled&&modelled.available)projection=num(modelled.projection);
 var modelSourced=num(c.projection)==null&&projection!=null;

 // A season total is the sum of the season's games. Deriving it from an
 // average is only sound when the sample IS the season; otherwise the tile is
 // omitted rather than showing a total built from part of one.
 var seasonAverage=num(c.seasonAverage);
 var seasonTotal=num(c.seasonStat);
 var seasonWindow=r&&r.windows?r.windows.season:null;
 var seasonGames=seasonWindow?num(seasonWindow.games):null;
 var seasonComplete=r&&r.coverage?r.coverage.seasonComplete===true:false;
 if(seasonTotal==null&&seasonComplete&&seasonAverage!=null&&seasonGames)seasonTotal=seasonAverage*seasonGames;

 var items=[
  ['Projection',projection==null?null:dec(projection,1)+(modelSourced?' *':'')],
  ['Projection − line',projection==null||num(line)==null?null:dec(projection-num(line),1)],
  ['Season average',seasonAverage==null?null:dec(seasonAverage,1)],
  ['Season total',seasonTotal==null?null:dec(seasonTotal,1)],
 ].concat(usageTiles(r,sport)).concat([
  ['Starter',c.isStarter===true?'Yes':c.isStarter===false?'No':null],
  ['Injury',c.injuryStatus||null],
  ['Opponent rank',num(c.opponentRank)==null?null:'#'+c.opponentRank],
  ['Opponent',(r&&r.matchup&&r.matchup.opponent)||null],
  ['Home sample avg',num(r&&r.splits&&r.splits.home&&r.splits.home.average)==null?null:dec(r.splits.home.average,1)],
  ['Away sample avg',num(r&&r.splits&&r.splits.away&&r.splits.away.average)==null?null:dec(r.splits.away.average,1)],
 ]);
 // Filter on the value being absent, not on a display string. The previous
 // check compared against 'Unavailable', which stopped matching when empty
 // values began rendering as an em dash — every empty tile then rendered as a
 // bare dash instead of being dropped.
 items=items.filter(function(x){return x[1]!=null&&x[1]!=='';});
 if(!items.length)return '<p class="asNotice">Additional player context has not been reported.</p>';
 return '<div class="asContext">'+items.map(function(x){
   return '<div class="asCtx"><small>'+esc(x[0])+'</small><b class="asCtxValue">'+esc(x[1])+'</b></div>';
  }).join('')+'</div>'
  +(modelSourced?'<p class="asNotice">* Projection is a model estimate, not a reported projection.</p>':'');
}

function windowCards(r,selected){return'<div class="asWindows">'+['l5','l10','l15','l20','season','h2h'].map(k=>{
 var w=k==='h2h'?r?.h2h:r?.windows?.[k],emptyH2h=k==='h2h'&&w?.games===0&&r?.matchup?.opponent;
 var label=k==='season'?'SZN':k.toUpperCase(),title=k==='season'?'Season '+(r?.season||''):k==='h2h'?'Games vs '+(r?.matchup?.opponent||'opponent'):label;
 return'<button class="asWindow '+(k===selected?'on':'')+'" data-window="'+k+'" aria-pressed="'+(k===selected)+'" title="'+esc(title)+'"><small>'+label+'</small><b>'+esc(w?.hitRate==null?'N/A':w.hitRate+'%')+'</b><em>'+esc(emptyH2h?'0 games vs '+r.matchup.opponent:w?.average==null?'No eligible games':'avg '+dec(w.average))+'</em><span>'+esc(w?.games==null?'N/A':w.games+'g'+(w.partial?' · partial':''))+(k==='season'&&r?.season?' · '+esc(r.season):'')+'</span></button>';
 }).join('')+'</div>';}
function filteredGames(r){var rows=r?.gameLog||[],w=drawerState?.window||'l10';if(w==='h2h')rows=rows.filter(x=>researchOpponentMatches(x,r?.matchup));if(w==='season'){if(r?.season==null)return[];rows=rows.filter(x=>String(x.season)===String(r.season)&&(x.seasonType==null||Number(x.seasonType)===2));}return /^l[0-9]+$/.test(w)?rows.slice(0,Number(w.slice(1))):rows;}
function chartHtml(r){
 var rows=filteredGames(r).slice().reverse(),line=num(drawerState?.line);
 if(!rows.length)return'<div class="asChartEmpty">'+(drawerState?.window==='season'?'No current regular-season game logs are available.':'Historical game data is unavailable for this selection.')+'</div>';
 var values=rows.map(x=>x.value),low=Math.min(0,line??0,...values),high=Math.max(0,line??0,...values),span=high-low||1;
 // Leave room for value labels while keeping the line and bars on one scale.
 high+=span*.12;low-=low<0?span*.12:0;span=high-low;
 var position=value=>(value-low)/span*100;
 return'<div class="asChartLegend"><span class="asHit">● Hit</span><span class="asMiss">● Miss</span><span class="asPushText">● Push</span><span>Line '+esc(dec(line))+'</span></div><div class="asChartWrap" tabindex="0" role="region" aria-label="Game performance chart, scroll for more games"><div class="asChart" style="min-width:'+Math.max(0,rows.length*44)+'px">'+(line!=null?'<div class="asThreshold" style="bottom:'+position(line)+'%"><span>LINE '+esc(dec(line))+'</span></div>':'')+'<div class="asZeroLine" style="bottom:'+position(0)+'%"></div>'+rows.map(x=>'<button type="button" class="asBarCol" data-game-detail="'+esc(shortDate(x.date)+' · '+(x.opponent||'Opponent unavailable')+' · '+x.value+' · '+(x.push?'Push':x.hit===true?'Hit':x.hit===false?'Miss':'Result unavailable'))+'" aria-label="'+esc(shortDate(x.date)+' '+(x.opponent||'')+' result '+x.value)+'"><span class="asChartBar '+(x.push?'push':x.hit===false?'miss':x.hit===true?'':'unknown')+'" style="position:absolute;bottom:'+position(Math.min(0,x.value))+'%;height:'+Math.abs(x.value)/span*100+'%"><span class="asBarVal">'+esc(x.value)+'</span></span><span class="asBarLabel">'+esc(shortDate(x.date))+'<br>'+esc(x.opponent||'Unknown')+'</span></button>').join('')+'</div></div><p id="asGameDetail" class="asNotice" aria-live="polite">Tap a bar to inspect a game. Hit rate is hits / all games. Pushes are shown separately and end a hit streak.</p>';
}
function secondaryHeaders(s,marketId){if(['NBA','WNBA','NCAAB'].includes(s))return[['MIN','minutes'],['PTS','points'],['REB','rebounds'],['AST','assists'],['3PM','threes'],['STL','steals'],['BLK','blocks']];if(['NFL','NCAAF'].includes(s))return[['PASS YDS','passingYards'],['PASS TD','passingTouchdowns'],['RUSH YDS','rushingYards'],['REC','receptions'],['TARGETS','targets'],['REC YDS','receivingYards']];if(s==='MLB'&&String(marketId||'').startsWith('pitcher_'))return[['HITS ALLOWED','hitsAllowed'],['ER','earnedRuns'],['SO','strikeouts']];if(s==='MLB')return[['HITS','hits'],['TB','totalBases'],['RBI','runsBattedIn'],['RUNS','runs'],['SO','strikeouts']];if(s==='NHL')return[['SOG','shotsOnGoal'],['GOALS','goals'],['AST','assists'],['PTS','points'],['SAVES','saves']];return[];}
// Use the exact selected chart sample. Missing fields never become zero or
// borrow observations from another window, venue, player, or market.
function supportingStats(r,g){
 var rows=filteredGames(r),metrics=secondaryHeaders(g.sport,g.marketId);
 if(g.entityType==='team'||!metrics.length)return '<p class="asNotice">Supporting statistics are unavailable for this market.</p>';
 var tiles=metrics.map(([label,field])=>{
  var values=rows.map(row=>row[field]).filter(value=>typeof value==='number'&&Number.isFinite(value));
  var average=values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
  return '<div class="asCtx" data-support-stat="'+esc(field)+'"><small>'+esc(label)+' / game</small><b>'+ (average==null?'Unavailable':esc(dec(average,1)))+'</b><span class="asSupportSample">'+values.length+' of '+rows.length+' games reported</span></div>';
 }).join('');
 return '<div class="asContext asSupportingStats">'+tiles+'</div><p class="asNotice">Averages use reported values from the selected window and venue. Missing statistics are excluded; recorded zeros count.</p>';
}
function detailedGameTable(r,g){
 var extra=secondaryHeaders(g.sport,g.marketId),rows=filteredGames(r),hasStarts=rows.some(x=>typeof x.started==='boolean');
 return'<div class="asTableWrap"><table class="asTable"><thead><tr><th>Date</th><th>Opp</th><th>H/A</th><th>Game result</th><th>'+esc(r?.marketDisplayName||g.market)+'</th><th>Prop result</th><th>'+(hasStarts?'Starter / date':'Game start')+'</th>'+extra.map(x=>'<th>'+x[0]+'</th>').join('')+'</tr></thead><tbody>'+rows.map(function(x){
 var result=x.push?'PUSH':x.hit===true?'HIT':x.hit===false?'MISS':'Unavailable',cls=x.push?'asPushText':x.hit?'asHit':'asMiss';
 var date=Number.isFinite(Date.parse(x.date))?new Date(x.date):null;
 var start=x.started===true?'Starter':x.started===false?'Bench':date?date.toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—';
 var score=x.gameResult&&x.scoreFor!=null&&x.scoreAgainst!=null?x.gameResult+' '+x.scoreFor+'–'+x.scoreAgainst:'—';
 return'<tr><td>'+esc(date?date.toLocaleDateString([],{year:'numeric',month:'short',day:'numeric'}):'—')+'</td><td>'+esc(x.opponent||'—')+'</td><td>'+esc(x.isHome===true?'H':x.isHome===false?'A':'—')+'</td><td>'+esc(score)+'</td><td><b>'+esc(x.value)+'</b></td><td class="'+cls+'">'+result+'</td><td>'+esc(start)+'</td>'+extra.map(h=>'<td>'+esc(x[h[1]]==null?'—':dec(x[h[1]]))+'</td>').join('')+'</tr>';
 }).join('')+'</tbody></table></div>';
}
function gameTable(r,g){
 var rows=filteredGames(r),line=num(drawerState?.line);
 return '<div class="asTableWrap"><table class="asTable asPropLog"><caption>'+esc(g.market)+' · '+esc(drawerState?.side||'OVER')+' · Line is your research threshold</caption><thead><tr>'+['Date','Opp','H/A','Stat','Line','Result'].map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.map(x=>{
 var date=Number.isFinite(Date.parse(x.date))?new Date(x.date):null,result=x.push?'PUSH':x.hit===true?'HIT':x.hit===false?'MISS':'—',cls=x.push?'asPushText':x.hit===true?'asHit':x.hit===false?'asMiss':'';
 return '<tr><td>'+(date?'<time datetime="'+esc(x.date)+'">'+esc(date.toLocaleDateString([],{month:'short',day:'numeric'}))+'<small>'+date.getFullYear()+'</small></time>':'—')+'</td><td>'+esc(x.opponent||'—')+'</td><td>'+esc(x.isHome===true?'H':x.isHome===false?'A':'—')+'</td><td><b>'+esc(x.value)+'</b></td><td>'+esc(line==null?'—':dec(line))+'</td><td><span class="asResultBadge '+cls+'">'+result+'</span></td></tr>';
 }).join('')+'</tbody></table></div><details class="asGameDetails"><summary>Scores, starters &amp; additional stats</summary>'+detailedGameTable(r,g)+'</details>';
}
function comparisonRows(g){
 var comparison=quoteComparison(g);
 var card=(side,title)=>{
  var line=comparison.bestLines[side],offers=comparison.offers.filter(q=>q.fresh&&q.side===side&&q.line===line);
  return '<article class="asLineOpportunity"><small>'+title+'</small><strong>'+(line==null?'Unavailable':esc(dec(line)))+'</strong>'
   +(offers.length?offers.map(q=>'<button type="button" class="asQuoteChoice" data-use-quote="'+esc(JSON.stringify([q.bookKey,q.side,q.line]))+'" aria-label="Research '+esc(q.sportsbook||q.sportsbookKey)+' '+side+' '+esc(dec(line))+'"><span>'+esc(q.sportsbook||q.sportsbookKey)+'</span><span>'+(q.price==null?'Price unavailable':esc(money(q.price)))+'</span><span class="asQuoteAction">Research this line →</span></button>').join(''):'<p>No fresh, verified offer on this side.</p>')+'</article>';
 };
 var winners=comparison.bestPrices[comparison.side]||[];
 return '<div class="asLineOpportunities">'+card('OVER','Lowest Over line')+card('UNDER','Highest Under line')+'</div>'
  +'<div class="asMarketSummary"><div><small>'+esc(comparison.side)+' consensus line</small><b>'+(comparison.consensus==null?'Unavailable':esc(dec(comparison.consensus)))+'</b><span>Median across at least two fresh books</span></div><div><small>Best '+esc(comparison.side)+' price at '+esc(dec(comparison.selectedLine))+'</small><b>'+(winners.length?esc(money(winners[0].price)):'Unavailable')+'</b><span>'+esc(winners.length?winners.map(q=>q.sportsbook||q.sportsbookKey).join(' · '):'Needs two fresh prices at this exact line')+'</span></div></div>'
  +'<p class="asNotice">Research a quoted line to update your chart, side and book history. Sportsbook offers stay unchanged. A lower Over or higher Under line is not by itself better value; price matters too.</p>';
}

function proToolsPanel(g){
 var group={...g,archived:!!g.archived||!!payload.meta?.stale},predictions=new Map();
 (g.comparisonOffers||g.rows||[]).forEach(q=>{
  var target={...g,...q,playerName:g.playerName,gameStartTime:g.gameStartTime},prediction=mlClient.peek(target),key=predictionKey(prediction);
  if(key&&prediction?.available)predictions.set(key,prediction);
 });
 return proToolsHtml(proToolsAnalysis(group,{predictions:Array.from(predictions.values())}));
}
function winPredictorPanel(g){
 return '<div class="asWinPredictor"><p class="asNotice">'+esc(g.awayTeam||'Away team')+' at '+esc(g.homeTeam||'Home team')+' · Game outcome research</p>'
  +'<div class="asProCards"><article class="asProCard" data-win-status="model"><h4>Model prediction</h4><strong>Unavailable</strong><p>No validated team-win model is connected for this game. Player projections and historical prop hit rates do not predict the game winner.</p></article>'
  +'<article class="asProCard" data-win-status="market"><h4>Market-implied probabilities</h4><strong>Unavailable</strong><p>Complete, fresh game moneylines with verified settlement rules are not available in this research feed.</p></article></div>'
  +'<details><summary>How game probabilities will be evaluated</summary><p>Market-implied estimates require complete moneylines from at least two sportsbooks. Each book’s implied probabilities are normalized before averaging, so its margin is removed proportionally. These estimates are separate from a trained prediction.</p><p>Regulation and full-game markets stay separate. Three-way markets include the draw. A two-way market that refunds a draw only describes outcomes conditional on a non-draw; it cannot supply a draw probability.</p><p>Quotes must be observed within five minutes and within one minute of each other. Missing, stale or conflicting evidence remains unavailable.</p></details></div>';
}
function matchupOptions(g){return {line:drawerState.line,side:drawerState.side,window:drawerState.window,sport:g.sport,eventStart:g.gameStartTime};}
function matchupWindowControl(){return '<label class="asSampleWindow">Historical sample<select class="asMarketSelect" id="asMatchWindow">'+[['l5','Last 5'],['l10','Last 10'],['l15','Last 15'],['l20','Last 20'],['season','Current regular season'],['h2h','Direct opponent games']].map(([value,label])=>'<option value="'+value+'" '+(drawerState.window===value?'selected':'')+'>'+label+'</option>').join('')+'</select></label>';}
function matchupMetric(label,metric,id){
 return '<article class="asMatchMetric" data-match-metric="'+id+'"><h4>'+esc(label)+'</h4><strong>'+(metric.hitRate==null?'Unavailable':esc(pct(metric.hitRate)))+'</strong><span>Historical hit rate</span><dl><div><dt>Average</dt><dd>'+(metric.average==null?'Unavailable':esc(dec(metric.average)))+'</dd></div><div><dt>Games</dt><dd>'+metric.games+'</dd></div><div><dt>Pushes</dt><dd>'+(metric.pushes==null?'Unavailable':metric.pushes)+'</dd></div></dl>'+(metric.limited?'<p class="asSmallSample">Small sample · fewer than 5 games</p>':'')+'</article>';
}
function matchupPanel(base,g){
 var result=matchupAnalysis({...base,entityType:g.entityType},matchupOptions(g));
 return matchupWindowControl()+'<p class="asNotice">Upcoming venue: '+(result.targetVenue?esc(result.targetVenue==='home'?'Home':'Away'):'Unverified')+'. These groups are drawn from the same selected historical sample; they may overlap.</p>'
  +'<div class="asMatchMetrics">'+matchupMetric('Selected sample',result.baseline,'baseline')+matchupMetric('Home games',result.home,'home')+matchupMetric('Away games',result.away,'away')+matchupMetric(result.opponentKnown?'VS '+(result.opponent||'verified opponent'):'Opponent unverified',result.h2h,'h2h')+'</div>'
  +'<p class="asNotice">'+(result.partialSeason?'Season coverage is incomplete. ':'')+(result.unknownVenue?result.unknownVenue+' games have no verified venue and are excluded from home/away groups. ':'')+'Hit rates use all matched games, including pushes in the denominator. These are historical results, not a prediction or opponent defensive ranking.</p>';
}
function similarPanel(base,g){
 var state=drawerState.similar||{venue:'matchup',role:'any',minMinutes:'',maxMinutes:''};
 var result=similarGames({...base,entityType:g.entityType},{...matchupOptions(g),...state});
 var select=(id,label,choices,value)=>'<label>'+label+'<select class="asMarketSelect" id="'+id+'">'+choices.map(([v,t])=>'<option value="'+v+'" '+(v===value?'selected':'')+'>'+t+'</option>').join('')+'</select></label>';
 return matchupWindowControl()+'<div class="asSimilarControls">'+select('asSimilarVenue','Historical venue',[['matchup','Match upcoming venue'],['any','Any venue'],['home','Home only'],['away','Away only']],state.venue)+select('asSimilarRole','Recorded starter status',[['any','Any status'],['starter','Starter only'],['bench','Bench only']],state.role)
  +(result.minutesSupported?'<label>Minimum minutes<input class="asControl" id="asSimilarMin" type="number" min="0" step="0.5" placeholder="Any" value="'+esc(state.minMinutes)+'"></label><label>Maximum minutes<input class="asControl" id="asSimilarMax" type="number" min="0" step="0.5" placeholder="Any" value="'+esc(state.maxMinutes)+'"></label>':'')+'</div>'
  +'<p class="asNotice" id="asSimilarCount" role="status">'+result.matched+' of '+result.candidates+' games match these conditions.</p>'+(result.reason?'<p class="asAvailability">'+esc(result.reason)+'</p>':'')
  +'<div class="asMatchMetrics asSimilarSummary">'+matchupMetric('Matched games',result.summary,'similar')+'</div><p class="asNotice">'+esc(result.note)+'</p>'
  +(result.matched?'<div class="asTableWrap asSimilarGames"><table class="asTable"><thead><tr><th>Date</th><th>Opponent</th><th>Venue</th><th>Starter</th><th>Minutes</th><th>'+esc(g.market)+'</th><th>Prop result</th></tr></thead><tbody>'+result.summary.rows.map(row=>'<tr><td>'+esc(shortDate(row.date))+'</td><td>'+esc(row.opponent||'Unavailable')+'</td><td>'+ (row.isHome===true?'Home':row.isHome===false?'Away':'Unavailable')+'</td><td>'+(row.started===true?'Yes':row.started===false?'No':'Unavailable')+'</td><td>'+(row.minutes==null?'Unavailable':esc(dec(row.minutes)))+'</td><td>'+esc(dec(row.value))+'</td><td>'+ (row.push===true?'Push':row.hit===true?'Hit':row.hit===false?'Miss':'Unavailable')+'</td></tr>').join('')+'</tbody></table></div>':'<p class="asNotice">No matching historical games are available. Broaden the filters to explore the recorded sample.</p>');
}
function historyChart(series){
 if(series.building)return'';
 var rows=series.rows,t0=series.first.observedAt,span=series.last.observedAt-t0,low=Math.min(...rows.map(x=>x.line)),high=Math.max(...rows.map(x=>x.line));
 if(high===low){low-=.5;high+=.5;}
 var x=t=>45+(t-t0)/span*510,y=v=>145-(v-low)/(high-low)*120;
 return'<div class="asHistoryChart"><svg viewBox="0 0 600 190" role="img" aria-label="Persisted line observations over time"><line x1="45" y1="155" x2="555" y2="155" stroke="#365578"/><text x="8" y="30">'+esc(dec(high))+'</text><text x="8" y="148">'+esc(dec(low))+'</text>'+rows.map(row=>'<circle cx="'+x(row.observedAt).toFixed(2)+'" cy="'+y(row.line).toFixed(2)+'" r="4" fill="#70aaff"><title>'+esc(new Date(row.created_at).toLocaleString()+' · Line '+row.line+' · Price '+money(row.price))+'</title></circle>').join('')+'<text x="45" y="180">'+esc(when(series.first.created_at))+'</text><text x="555" y="180" text-anchor="end">'+esc(when(series.last.created_at))+'</text></svg><p class="asNotice">Each dot is a stored observation. The table shows observed line or price changes.</p></div>';
}
async function intelligenceReadHistory(g,book,side){
 var pid=propIdForRow(g.rows[0])||g.propId;
 if(!pid)return{configured:false,rows:[],propId:null};
 var key=[pid,book,side].join('|'),entry=historyCache.get(key);
 if(!entry||entry.expires<=Date.now()){
  var promise=nativeFetch('/api/apex/line-history?'+new URLSearchParams({propId:pid,bookmaker:book,side,limit:1000}),{signal:AbortSignal.timeout(15000)})
   .then(async response=>{if(!response.ok)throw Error('History unavailable');return response.json();});
  entry={promise,expires:Date.now()+60000};historyCache.set(key,entry);
 }
 try{return{...(await entry.promise),propId:pid};}
 catch(error){if(historyCache.get(key)===entry)historyCache.delete(key);throw error;}
}
async function historyHtml(g,book,side){
 var pid=propIdForRow(g.rows[0])||g.propId;if(!pid)return'<p class="asNotice">Line history is unavailable for this prop.</p>';
 var j;
 try{j=await intelligenceReadHistory(g,book,side);
 var series=analyzeLineHistory(j.rows||[],{propId:pid,bookmaker:book,side}),rows=series.rows;
 if(!j.configured||!rows.length)return'<p class="asNotice">Building line history</p>';
 var a=series.first,b=series.last,move=series.lineChange,current=g.archived?null:g.rows.find(x=>x.sportsbookKey===book&&x.side===side);
 return'<div class="asContext"><div class="asCtx"><small>First observed</small><b>'+dec(a.line)+'</b></div><div class="asCtx"><small>Last observed</small><b>'+dec(b.line)+'</b></div><div class="asCtx"><small>Observed line change</small><b>'+(move>0?'+':'')+dec(move)+'</b></div><div class="asCtx"><small>Current offer</small><b>'+dec(current?.line)+'</b></div></div><p class="asNotice">'+(series.building?'Building line history':series.changes.length<2?'No line or price changes observed.':'Observed changes for this sportsbook and side.')+' '+rows.length+' stored observations.'+((j.rows||[]).length===1000?' History limited to the first 1,000 observations; the current offer may be newer.':'')+'</p>'+historyChart(series)+'<div class="asTableWrap"><table class="asTable asHistoryTable"><thead><tr><th>Observed</th><th>Line</th><th>Price</th></tr></thead><tbody>'+series.changes.slice().reverse().map(x=>'<tr><td><time datetime="'+esc(x.created_at)+'">'+esc(new Date(x.created_at).toLocaleDateString())+'<span>'+esc(new Date(x.created_at).toLocaleTimeString())+'</span></time></td><td>'+dec(x.line)+'</td><td>'+money(x.price)+'</td></tr>').join('')+'</tbody></table></div>';
 }catch{return'<p class="asNotice">Line history could not load.</p><button type="button" class="asBtn" id="asRetryHistory">Retry history</button>';}
}
function openDrawer(g){if(!drawerState)lastFocus=document.activeElement;if(sandbox.key!==g.key)sandbox={key:g.key,out:new Set(),roster:null,loading:false};drawerState={g,line:boardLine(g),side:defaultSide(g),window:'l10',filter:'all',base:null,historyBook:bookFilter!=='all'?bookFilter:books(g)[0]};document.getElementById('asDrawerBg').classList.add('on');document.body.style.overflow='hidden';document.querySelector('.asMain').inert=true;document.querySelector('.asTop').inert=true;document.querySelector('.asNav').inert=true;renderDrawer();document.getElementById('asClose').focus();getResearch(g,drawerState.line,drawerState.side,false).then(r=>{if(!drawerState||drawerState.g.key!==g.key)return;drawerState.base=r;renderDrawer();});}
function loadHistoryIntoDrawer(){
 if(!drawerState)return;var {g,historyBook,side}=drawerState;
 var host=document.getElementById('asHistory');if(host)host.innerHTML='<p class="asNotice" role="status">Loading observed history…</p>';
 historyHtml(g,historyBook,side).then(html=>{
  if(drawerState?.g.key!==g.key||drawerState?.historyBook!==historyBook||drawerState?.side!==side)return;
  var el=document.getElementById('asHistory');if(!el)return;el.innerHTML=html;
  document.getElementById('asRetryHistory')?.addEventListener('click',()=>loadHistoryIntoDrawer());
 });
}

function researchAvailability(base){if(base?.message)return base.message;var c=String(base?.code||'');if(/UNMAPPED/.test(c))return 'This market does not yet have a supported historical statistic. Current sportsbook lines remain available.';if(/SEASON_ONLY|NO_GAME_LOG/.test(c)||base?.sections?.seasonTotal)return 'Season or player context is available, but completed game logs were not returned. Hit rates require individual game results.';if(/PLAYER.*MATCH|AMBIGUOUS/.test(c))return 'This player could not be uniquely matched to historical statistics. Current sportsbook lines remain available.';return 'Historical research could not be loaded for this player and market. Any supplied player context and sportsbook lines remain available.';}
// An empty filtered log is usually the head-to-head view on a player who has
// not faced this opponent. Say that in plain language and show the recent form
// that does exist, rather than leaving a dead table.
function emptyLog(r,g,base){
 var venue=drawerState&&drawerState.filter;
 var opponent=(r&&r.matchup&&r.matchup.opponent)||(base&&base.matchup&&base.matchup.opponent)||'this opponent';
 var message=venue==='h2h'
  ? 'No direct matchups recorded this season against '+esc(opponent)+'. Recent form is shown instead.'
  : venue==='home'?'No home games in the games on record.'
  : venue==='away'?'No away games in the games on record.'
  : 'No completed games match this selection.';
 // r is the FILTERED analysis, so in the head-to-head view its log is the
 // empty set we are explaining. Recent form has to come from the unfiltered
 // run or there is nothing to fall back to.
 var unfiltered=base?analyzeResearch(base,drawerState?drawerState.line:null,drawerState?drawerState.side:'OVER','all'):null;
 var recent=(unfiltered&&Array.isArray(unfiltered.gameLog)?unfiltered.gameLog
  :(base&&Array.isArray(base.gameLog)?base.gameLog:[])).slice(0,10);
 if(!recent.length)return '<p class="asNotice">'+message+'</p>';
 var rows=recent.map(function(row){
  var tone=row.push?'asPushText':row.hit===true?'asHit':row.hit===false?'asMiss':'';
  return '<li><span>'+esc(shortDate(row.date))+'</span><span>'+esc(row.opponent||'—')+'</span>'
   +'<b class="'+tone+'">'+esc(dec(row.value,1))+'</b></li>';
 }).join('');
 return '<p class="asNotice">'+message+' Showing recent form instead.</p>'
  +'<ul class="asFallbackLog">'+rows+'</ul>';
}
function renderDrawer(){
 if(!drawerState)return;var focused=document.getElementById('asDrawerBody').contains(document.activeElement)?focusToken(document.activeElement):null;var {g,line,side}=drawerState,base=drawerState.base||researchFor(g,line,side),r=base?recalcFromGameLog(base,line,side):null;
 var injury=document.getElementById('asInjuryBadge');injury.hidden=!base?.context?.injuryStatus;injury.textContent=base?.context?.injuryStatus||'';
 var drawerImg=document.getElementById('asDrawerImg');drawerImg.alt=g.playerName;drawerImg.onerror=()=>{drawerImg.hidden=true;};drawerImg.hidden=g.entityType==='team';if(g.entityType!=='team')drawerImg.src=artUrl(g);else drawerImg.removeAttribute('src');document.getElementById('asDrawerTitle').textContent=g.playerName;
 document.getElementById('asDrawerSub').textContent=[displayTeam(g.team||base?.player?.team||base?.context?.team),g.position||base?.context?.position||base?.context?.playerPosition,g.awayTeam+' @ '+g.homeTeam,when(g.gameStartTime)].filter(Boolean).join(' · ');
 var section=(title,body,sub='')=>'<section class="asSection"><div class="asSectionTitle"><h3>'+title+'</h3><span>'+sub+'</span></div><div class="asSectionBody">'+body+'</div></section>';
 var controls='<div class="asResearchTop"><label>Market<select class="asMarketSelect" id="asMarketSwitch">'+marketOptions(g)+'</select></label><div><label>Research line</label><div class="asLineCtl"><button class="asLineBtn" id="asLineMinus" aria-label="Decrease line">−</button><input class="asLineVal" id="asLineInput" type="number" step="0.5" aria-label="Research line" value="'+(line==null?'':line)+'"><button class="asLineBtn" id="asLinePlus" aria-label="Increase line">+</button></div></div></div><div class="asSideToggle">'+['OVER','UNDER'].map(x=>'<button class="asSideBtn '+x.toLowerCase()+' '+(side===x?'on':'')+'" data-side="'+x+'" aria-pressed="'+(side===x)+'">'+x+'</button>').join('')+'</div><p class="asNotice">Adjusting this line changes your research, not sportsbook offers.</p>';
 var filters='<div class="asFilterRow">'+[['all','All'],['home','Home'],['away','Away'],['h2h','VS '+(r?.matchup?.opponent||'opponent')]].map(([id,label])=>'<button class="asFilterBtn '+(drawerState.filter===id?'on':'')+'" data-filter="'+id+'" aria-pressed="'+(drawerState.filter===id)+'">'+esc(label)+'</button>').join('')+'</div>';
 var panel=drawerState.panel||'overview', tabs=[['overview','Overview'],['games','Game log'],['lines','Compare lines'],['matchup','Matchup'],['similar','Similar games'],['win','Win Predictor'],['intelligence','Intelligence'],['sandbox','Scenario'],['pro','Pro Tools'],['ask','Ask']];
 var tabBar='<div class="asResearchTabs" role="tablist" aria-label="Player research sections">'+tabs.map(([id,label])=>'<button role="tab" class="asResearchTab" id="asTab-'+id+'" data-research-panel="'+id+'" aria-controls="asPanel-'+id+'" aria-selected="'+(panel===id)+'" tabindex="'+(panel===id?'0':'-1')+'">'+label+'</button>').join('')+'</div>';
 var logContent=filteredGames(r).length?gameTable(r,g):emptyLog(r,g,base);
 var projectionHtml=mlPanel(g,line,side)+projectionCard(g,line);
 var pillsHtml=section('Hit rate',hitPills(r||base));
 var panels={win:section('Win Predictor',winPredictorPanel(g)),pro:panel==='pro'?section('Pro Tools',proToolsPanel(g)):'',matchup:section('Matchup research',matchupPanel(base||{},g)),similar:section('Similar games · same player',similarPanel(base||{},g)),sandbox:section('Scenario sandbox',sandboxPanel(g,line,side),'Simulated'),
  ask:section('Ask about this prop',askPanel(g,line,side)),
  overview:pillsHtml+projectionHtml+(base?.available?section('Hit-rate windows',windowCards(r,drawerState.window),esc(side+' '+dec(line)))+section('Game-by-game performance',filters+chartHtml(r),'Actual results')+section('Supporting stats',supportingStats(r,g))+section('Game log',logContent):'')+section('Player context',contextGrid(r||base,line,g)),games:windowCards(r,drawerState.window)+filters+section('Supporting stats',supportingStats(r,g))+section('Game log',logContent),lines:section('Best Line Finder',comparisonRows(g))+section('Every book',bookMatrix(g))+section('Line movement','<label>Sportsbook<select class="asMarketSelect" id="asHistoryBook">'+books(g).map(b=>'<option value="'+esc(b)+'" '+(b===drawerState.historyBook?'selected':'')+'>'+esc(g.rows.find(x=>x.sportsbookKey===b)?.sportsbook||b)+'</option>').join('')+'</select></label><div id="asHistory" aria-live="polite"><p class="asNotice">Loading observed history…</p></div>',esc(side))};
 intelligence?.disposeDetails();
 panels.intelligence='<div id="asIntelligenceDetail">'+(intelligence?'':'<p class="asNotice">Intelligence tools could not load. Reload the page; existing research remains available.</p>')+'</div>';
 document.getElementById('asDrawerBody').innerHTML=(g.archived?'<p class="asAvailability">Saved snapshot from '+esc(when(g.savedAt))+'. Current sportsbook offers are unavailable for this prop.</p>':'')+section('Research controls',controls)+(!base?'<div class="asLoading" role="status">Loading player research…</div>':!base.available?'<p class="asAvailability">'+esc(researchAvailability(base))+'</p><button class="asBtn" id="asRetryResearch">Retry research</button>':'')+tabBar+'<div role="tabpanel" id="asPanel-'+panel+'" aria-labelledby="asTab-'+panel+'" tabindex="0">'+panels[panel]+'</div>';
 document.querySelectorAll('[data-research-panel]').forEach(b=>{b.onclick=()=>{drawerState.panel=b.dataset.researchPanel;renderDrawer();document.getElementById('asTab-'+drawerState.panel)?.focus();};b.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();var i=tabs.findIndex(t=>t[0]===b.dataset.researchPanel),next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length;drawerState.panel=tabs[next][0];renderDrawer();document.getElementById('asTab-'+drawerState.panel)?.focus();};});
 document.querySelectorAll('[data-project]').forEach(b=>b.onclick=()=>runProjection(g,line,side));
 document.querySelectorAll('[data-sandbox]').forEach(b=>b.onclick=()=>{
  var name=b.dataset.sandbox;
  if(sandbox.out.has(name))sandbox.out.delete(name);else sandbox.out.add(name);
  renderDrawer();
 });
 document.getElementById('asSandboxRun')?.addEventListener('click',()=>runProjection(g,line,side,Array.from(sandbox.out)));
 document.getElementById('asAskForm')?.addEventListener('submit',e=>{
  e.preventDefault();
  var input=document.getElementById('asAskInput');
  var question=String(input.value||'').trim();
  if(!question)return;
  input.value='';
  askAbout(g,line,side,question);
 });
 document.getElementById('asRetryResearch')?.addEventListener('click',async e=>{e.target.disabled=true;e.target.textContent='Retrying…';var result=await getResearch(g,line,side,true);if(drawerState?.g.key===g.key){drawerState.base=result;renderDrawer();}});
 if(panel==='sandbox'&&!sandbox.roster&&!sandbox.loading)loadRoster(g);
 document.getElementById('asMarketSwitch').onchange=e=>{var next=viewGroups().find(x=>x.key===e.target.value);if(next)openDrawer(next);};
 var changeLine=value=>{var n=num(value);if(n==null){toast('Enter a valid research line.');return;}drawerState.line=n;renderDrawer();document.getElementById('asLineInput')?.focus();};
 document.getElementById('asLineMinus').onclick=()=>changeLine(Number(((num(line)??0)-.5).toFixed(2)));
 document.getElementById('asLinePlus').onclick=()=>changeLine(Number(((num(line)??0)+.5).toFixed(2)));
 document.getElementById('asLineInput').onchange=e=>changeLine(e.target.value);
 document.querySelectorAll('[data-use-quote]').forEach(b=>b.onclick=()=>{
  var [book,offerSide,offerLine]=JSON.parse(b.dataset.useQuote);
  var offer=quoteComparison(g).offers.find(q=>q.fresh&&q.bookKey===book&&q.side===offerSide&&q.line===offerLine);
  if(!offer){toast('This quote is no longer current. Refresh the board.');return;}
  drawerState.line=offer.line;drawerState.side=offer.side;drawerState.historyBook=offer.sportsbookKey||offer.sportsbook;
  renderDrawer();document.getElementById('asLineInput')?.focus();
 });
 document.querySelectorAll('[data-side]').forEach(b=>b.onclick=()=>{drawerState.side=b.dataset.side;renderDrawer();});
 document.querySelectorAll('[data-window]').forEach(b=>b.onclick=()=>{drawerState.window=b.dataset.window;renderDrawer();});
 document.getElementById('asMatchWindow')?.addEventListener('change',e=>{drawerState.window=e.target.value;renderDrawer();});
 [['asSimilarVenue','venue'],['asSimilarRole','role'],['asSimilarMin','minMinutes'],['asSimilarMax','maxMinutes']].forEach(([id,key])=>{
  document.getElementById(id)?.addEventListener('change',e=>{drawerState.similar={venue:'matchup',role:'any',minMinutes:'',maxMinutes:'',...drawerState.similar,[key]:e.target.value};renderDrawer();});
 });
 document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{drawerState.filter=b.dataset.filter;renderDrawer();});
 document.querySelectorAll('[data-game-detail]').forEach(b=>b.onclick=()=>document.getElementById('asGameDetail').textContent=b.dataset.gameDetail);
 hydrateML();
 if(panel==='intelligence'&&intelligence)intelligence.renderDetails(document.getElementById('asIntelligenceDetail'),{group:g,base:base||{},line,side,venue:drawerState.filter,getHistory:book=>intelligenceReadHistory(g,book,side)});
 var historyBook=document.getElementById('asHistoryBook');if(historyBook){historyBook.onchange=e=>{drawerState.historyBook=e.target.value;loadHistoryIntoDrawer();};loadHistoryIntoDrawer();}restoreFocus(focused);
}
function render(){renderSports();renderControls();renderSummary();var m=payload.meta||{};document.getElementById('asSubtitle').textContent=(m.stale?'Last available board · ':'')+sport+' · '+(m.events||0)+' events · '+(m.sportsbookCount||0)+' sportsbooks'+(m.fetchedAt?' · Updated '+new Date(m.fetchedAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'');document.getElementById('asStatus').textContent=m.stale?'Last available lines':'Main sportsbook lines';if(!document.getElementById('asAdvanced').contains(document.activeElement))renderAdvanced();renderList();}
async function load(){
 hydrateController?.abort();hydrateController=null;hydrating=false;hydratePending.clear();hydrated.clear();hydrateFailed=false;staleCache.clear();var generation=++loadGeneration,selected=sport,keepBoard=payloadSport===selected&&(payload.props||[]).length>0;loadController?.abort();loadController=new AbortController();loading=true;renderSports();document.getElementById('asRefresh').disabled=true;
 document.getElementById('asStatus').textContent=keepBoard?'Refreshing lines…':'Loading lines…';
 renderBatchControl();
 if(!keepBoard){document.getElementById('asSubtitle').textContent='Loading '+selected+' markets…';document.getElementById('asList').innerHTML=Array.from({length:5},()=>'<div class="asSkeleton" aria-hidden="true"></div>').join('');}
 document.getElementById('asList').setAttribute('aria-busy','true');
 var requestController=loadController,timeout=setTimeout(()=>requestController.abort(),20000);
 try{var response=await nativeFetch('/api/apex/props?sport='+encodeURIComponent(selected),{signal:loadController.signal}),j=await response.json();if(!response.ok||!Array.isArray(j?.props))throw Error();if(generation!==loadGeneration)return;payload=j;payloadSport=selected;}
 catch(e){if(generation!==loadGeneration)return;if(keepBoard){payload={...payload,meta:{...payload.meta,stale:true,warning:'Refresh failed. Showing the last available lines.'}};toast('Refresh failed. Showing the last available lines.');}else{payload={props:[],data:{},meta:{warning:'Props are temporarily unavailable.'}};payloadSport=selected;}}
 finally{clearTimeout(timeout);}
 if(generation!==loadGeneration)return;loading=false;var availableTypes=categoryOptions(groups(),sport);if(marketFilter!=='all'&&!availableTypes.some(c=>c.label===marketFilter))marketFilter='all';if(marketFilter==='all'&&!readStored('autoscout-categories-v2-'+sport,false)&&availableTypes.length){marketFilter=availableTypes[0].label;storeLocal('autoscout-categories-v2-'+sport,true);}reshuffleBoard();page=1;document.getElementById('asRefresh').disabled=false;document.getElementById('asList').setAttribute('aria-busy','false');render();
}
function toast(message){var el=document.getElementById('asToast');el.textContent=message;el.classList.add('on');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('on'),3500);}
function applyPreferences(){document.getElementById('as5')?.classList.toggle('asCompact',prefs.compact);document.getElementById('as5')?.classList.toggle('asShowBooks',prefs.books);document.getElementById('as5')?.classList.toggle('asReduceMotion',prefs.reduceMotion);}
function utility(title,html){var dialog=document.getElementById('asUtility');dialog.innerHTML='<div class="asUtilityHead"><h2 id="asUtilityTitle">'+esc(title)+'</h2><button class="asClose" id="asUtilityClose" aria-label="Close '+esc(title)+'">×</button></div>'+html;document.getElementById('asUtilityClose').onclick=()=>dialog.close();if(!dialog.open)dialog.showModal();return dialog;}
function storeLocal(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
function restoreFilters(){var f=readStored('autoscout-filters-'+sport,{});if(!f||typeof f!=='object')f={};query=typeof f.query==='string'?f.query:'';marketFilter=typeof f.market==='string'?f.market:'all';bookFilter=typeof f.book==='string'?f.book:'all';sideFilter=['all','OVER','UNDER'].includes(f.side)?f.side:'all';sortBy=['shuffle','research','recent','l5','l10','l15','l20','season','h2h','projection','books','player','time'].includes(f.sort)?f.sort:'shuffle';advanced=f.advanced&&typeof f.advanced==='object'&&!Array.isArray(f.advanced)?f.advanced:{};rulesEnabled=f.rulesEnabled!==false;}
function persistFilters(){storeLocal('autoscout-filters-'+sport,{query,market:marketFilter,book:bookFilter,side:sideFilter,sort:sortBy,advanced,rulesEnabled});}
function dayBoundary(day,end=false){if(!/^\d{4}-\d{2}-\d{2}$/.test(day||''))return null;var d=new Date(day+'T00:00:00');if(end)d.setDate(d.getDate()+1);return Number.isFinite(d.getTime())?new Date(d.getTime()-(end?1:0)).toISOString():null;}
function activeFilterCount(){return Number(!!query)+Number(marketFilter!=='all')+Number(bookFilter!=='all')+Number(sideFilter!=='all')+['team','opponent','game','before','day','today'].filter(k=>!!advanced[k]).length+Number(!!advanced.availability&&advanced.availability!=='ALL')+(rulesEnabled?Object.values(advanced.thresholds||{}).filter(v=>num(v)!=null).length+Number(num(advanced.delta)!=null):0);}
function updateFilterStatus(){var count=activeFilterCount();document.getElementById('asFilterCount').textContent=count?'('+count+')':'';var b=document.getElementById('asRules');b.setAttribute('aria-checked',String(rulesEnabled));b.textContent='Rules '+(rulesEnabled?'on':'off');b.title='Optional hit-rate and projection thresholds. Regular lines are always required.';}
function visibleColumns(){var hidden=Array.isArray(prefs.hiddenColumns)?prefs.hiddenColumns:[];return COLUMN_DEFS.filter(([id])=>!hidden.includes(id));}
function applyColumnHeaders(){var cols=visibleColumns(),root=document.getElementById('as5');root.style.setProperty('--as-columns','minmax(250px,2.5fr) 132px '+cols.map(c=>c[2]+'px').join(' '));root.style.setProperty('--as-table-min',(382+cols.reduce((n,c)=>n+c[2],0))+'px');COLUMN_DEFS.forEach(([id])=>root.classList.toggle('asHide-'+id,!cols.some(c=>c[0]===id)));document.querySelector('.asHeaderRow').innerHTML='<span>Player / market</span><span>Line / book</span>'+cols.map(([id,label])=>['projection','l5','l10','l15','season','h2h','books'].includes(id)?'<button class="asColumnSort" data-sort="'+id+'" aria-pressed="'+(sortBy===id)+'" aria-label="Sort by '+label+'">'+label+(sortBy===id?' ↓':'')+'</button>':'<span>'+label+'</span>').join('');document.querySelectorAll('[data-sort]').forEach(b=>b.onclick=()=>{sortBy=b.dataset.sort;document.getElementById('asSort').value=sortBy;renderList();});}
function columnsPanel(){utility('Visible columns','<div class="asSettings">'+COLUMN_DEFS.map(([id,label])=>'<label><span>'+label+'</span><input type="checkbox" data-column-setting="'+id+'" '+(visibleColumns().some(c=>c[0]===id)?'checked':'')+'></label>').join('')+'</div><p class="asNotice">Player and sportsbook line always remain visible.</p>');document.querySelectorAll('[data-column-setting]').forEach(el=>el.onchange=()=>{var hidden=new Set(Array.isArray(prefs.hiddenColumns)?prefs.hiddenColumns:[]);if(el.checked)hidden.delete(el.dataset.columnSetting);else hidden.add(el.dataset.columnSetting);prefs.hiddenColumns=Array.from(hidden);storeLocal('autoscout-preferences',prefs);renderListLight();});}
function settingsPanel(){utility('Display settings','<div class="asSettings">'+[['compact','Compact rows'],['books','Show sportsbook strips on the board'],['reduceMotion','Reduce motion']].map(([k,label])=>'<label><span>'+label+'</span><input type="checkbox" data-pref="'+k+'" '+(prefs[k]?'checked':'')+'></label>').join('')+'</div><p class="asNotice">Display preferences are saved on this device.</p>');document.querySelectorAll('[data-pref]').forEach(el=>el.onchange=()=>{prefs[el.dataset.pref]=el.checked;storeLocal('autoscout-preferences',prefs);applyPreferences();});}
function renderAdvanced(){
 var gs=viewGroups(),options=(items,selected)=>'<option value="">All</option>'+uniq([...items,selected]).sort().map(x=>'<option value="'+esc(x)+'" '+(selected===x?'selected':'')+'>'+esc(x)+'</option>').join('');
 var html='<label>Date<input class="asControl" type="date" data-advanced="day" value="'+esc(advanced.day||'')+'"></label><label>Team<select class="asControl" data-advanced="team">'+options(gs.map(g=>g.team||researchFor(g)?.player?.team),advanced.team)+'</select></label><label>Opponent<select class="asControl" data-advanced="opponent">'+options(gs.map(g=>researchFor(g)?.matchup?.opponent),advanced.opponent)+'</select></label><label>Game<select class="asControl" data-advanced="game"><option value="">All games</option>'+Array.from(new Map(gs.map(g=>[g.eventId,g])).values()).map(g=>'<option value="'+esc(g.eventId)+'" '+(advanced.game===g.eventId?'selected':'')+'>'+esc(g.awayTeam+' @ '+g.homeTeam)+'</option>').join('')+'</select></label><label>Research<select class="asControl" data-advanced="availability">'+[['ALL','All coverage'],['AVAILABLE','Game log available'],['UNAVAILABLE','Game log unavailable'],['PENDING','Not loaded']].map(([value,label])=>'<option value="'+value+'" '+((advanced.availability||'ALL')===value?'selected':'')+'>'+label+'</option>').join('')+'</select></label>';
 html+=['l5','l10','l15','l20','season','h2h'].map(k=>'<label>'+k.toUpperCase()+' minimum %<input class="asControl" type="number" min="0" max="100" step="1" data-threshold="'+k+'" '+(!rulesEnabled?'disabled':'')+' value="'+esc(advanced.thresholds?.[k]??'')+'" placeholder="Any"></label>').join('');
 html+='<label>Projection difference<input class="asControl" type="number" step="0.5" data-advanced="delta" '+(!rulesEnabled?'disabled':'')+' value="'+esc(advanced.delta??'')+'" placeholder="Any"></label><label>Starts before<input class="asControl" type="datetime-local" data-advanced="before" value="'+esc(advanced.before||'')+'"></label><label class="asCheckbox"><input type="checkbox" id="asToday" '+(advanced.today?'checked':'')+'> Today only</label><button class="asBtn" id="asClear">Clear filters</button><p class="asNotice">Rules control only hit-rate and projection thresholds. Missing values never qualify. Regular lines are always required.</p>';
 document.getElementById('asAdvanced').innerHTML=html;
 var update=()=>{page=1;updateFilterStatus();renderList();};
 document.querySelectorAll('[data-advanced]').forEach(el=>el.onchange=()=>{advanced[el.dataset.advanced]=el.value;if(el.dataset.advanced==='day'){advanced.today=false;document.getElementById('asToday').checked=false;}update();});
 document.querySelectorAll('[data-threshold]').forEach(el=>el.onchange=()=>{advanced.thresholds={...advanced.thresholds,[el.dataset.threshold]:num(el.value)};update();});
 document.getElementById('asToday').onchange=e=>{advanced.today=e.target.checked;if(advanced.today){advanced.day='';document.querySelector('[data-advanced=day]').value='';}update();};
 document.getElementById('asClear').onclick=()=>{advanced={};query='';marketFilter=bookFilter=sideFilter='all';document.getElementById('asSearch').value='';document.getElementById('asSide').value='all';document.getElementById('asFilterCount').textContent='';renderControls();renderAdvanced();renderList();};
}
function savedSnapshot(g){return {...g,propId:propIdForRow(g.rows[0])||g.propId||null,savedAt:new Date().toISOString()};}
async function loadSaved(){
 var epoch=++saveEpoch;
 try{var response=await nativeFetch('/api/saved-props',{signal:AbortSignal.timeout(15000)});if(response.ok){var data=await response.json();if(epoch!==saveEpoch)return false;if(!Array.isArray(data.saved))throw Error();serverSaves=true;saveLoadError=false;profile=data.profile;var rows=data.saved;savedRecords=new Map(rows.map(g=>[g.key,g]));favorites=new Set(rows.map(g=>g.key));return true;}
 if(epoch!==saveEpoch)return false;if(response.status!==401)throw Error();
 serverSaves=false;saveLoadError=false;profile=null;savedRecords=new Map(readStored('autoscout-saved-records',[]).map(g=>[g.key,g]));favorites=new Set(readStored('autoscout-favorites',[]));return true;}
 catch{if(epoch!==saveEpoch)return false;saveLoadError=true;toast('Saved props could not load. Try again shortly.');return false;}
}
async function toggleSaved(key){
 if(savePending.has(key))return;savePending.add(key);var epoch=saveEpoch;
 try{
 if(saveLoadError||serverSaves===null){toast('Saved props are temporarily unavailable. Open Account to retry.');return;}
 var g=groups().find(x=>x.key===key)||savedRecords.get(key);if(!g)return;var removing=favorites.has(key),snapshot=savedSnapshot(g);
 if(serverSaves){try{var response=await nativeFetch('/api/saved-props',{method:removing?'DELETE':'POST',headers:{'content-type':'application/json'},body:JSON.stringify(removing?{key}:snapshot)});if(!response.ok)throw Error();}catch{toast('Could not update your saved prop. Please try again.');return;}}
 if(epoch!==saveEpoch){toast('Your access profile changed. Reload Saved to check this prop.');return;}
 if(removing){favorites.delete(key);savedRecords.delete(key);}else{favorites.add(key);savedRecords.set(key,snapshot);}
 if(!serverSaves){storeLocal('autoscout-favorites',Array.from(favorites));storeLocal('autoscout-saved-records',Array.from(savedRecords.values()));}
 toast(removing?'Prop removed.':serverSaves?'Saved to your access profile.':'Saved on this device.');
 }finally{savePending.delete(key);}
}
// --- accounts ---------------------------------------------------------------
// Two sign-in systems coexist here. This panel drives the email/Google account
// system that owns plans and per-account saved props. The legacy access code is
// still accepted by the server for the people who already have one, so it stays
// reachable at the bottom rather than being silently withdrawn.
var account={authenticated:false,user:null,csrfToken:null},accountHealth=null,entitlement=null,accuracy=null,authBusy=false;
async function accountJson(path,options){try{var response=await nativeFetch(path,options||{headers:{'accept':'application/json'}});var data=await response.json().catch(function(){return null;});return {status:response.status,data:data};}catch{return {status:0,data:null};}}
function accountPost(path,body){return accountJson(path,{method:'POST',headers:Object.assign({'content-type':'application/json'},account.csrfToken?{'x-csrf-token':account.csrfToken}:{}),body:JSON.stringify(body||{})});}
async function loadAccount(){
 var me=await accountJson('/api/account/me');
 account=me.data&&me.data.authenticated?{authenticated:true,user:me.data.user,csrfToken:me.data.csrfToken||null}:{authenticated:false,user:null,csrfToken:null};
 var health=await accountJson('/api/account/health');accountHealth=health.data&&health.data.ok?health.data:null;
 var plan=await accountJson('/api/account/entitlement');entitlement=plan.data&&plan.data.ok?plan.data.entitlement:null;
 var record=await accountJson('/api/props/accuracy');accuracy=record.data&&record.data.ok?record.data.accuracy:null;
 var button=document.getElementById('asAccount');
 if(button){button.textContent=account.authenticated?'Account':'Sign in';button.classList.toggle('asPrimary',!account.authenticated);}
}
function remainingText(remaining,limit){if(!Number.isFinite(limit))return 'Unavailable';return (Number.isFinite(remaining)?remaining:limit)+' of '+limit+' left today';}
function planBlock(){
 if(!entitlement)return '';
 var left=entitlement.remaining||{},limits=entitlement.limits||{};
 var rows=[['Plan',entitlement.planName],['AI predictions',remainingText(left.predictions,limits.predictionsPerDay)],['Ask Claude',remainingText(left.ask,limits.askPerDay)],['Betslip',limits.slipSize+' picks']];
 return '<div class="asPlanCard">'+rows.map(function(row){return '<div class="asPlanRow"><span>'+esc(row[0])+'</span><b>'+esc(row[1])+'</b></div>';}).join('')+'</div>'
 +'<p class="asNotice">Daily counts reset at midnight UTC. Paid plans are not on sale yet, so every account is on '+esc(entitlement.planName)+'.</p>';
}
// The graded record of every prediction this app has made.
//
// It shows the counts from the first pick and withholds the rates until enough
// have settled to mean anything. A hit rate over three picks is not a hit rate,
// and printing one would be the marketing claim this record exists to replace.
function accuracyBlock(){
 if(!accuracy)return '';
 var rows=[['Predictions recorded',String(accuracy.recorded)],['Graded so far',String(accuracy.graded)],['Awaiting the game',String(accuracy.awaitingResult)]];
 if(accuracy.sufficient){
  rows.push(['Picks that landed',accuracy.hitRate+'% of '+accuracy.calledPicks]);
  if(accuracy.brierScore!=null)rows.push(['Calibration (Brier)',accuracy.brierScore+' — lower is better']);
  if(accuracy.meanAbsoluteError!=null)rows.push(['Average miss',accuracy.meanAbsoluteError+' per prop']);
 }
 var note=accuracy.sufficient
  ?'Every prediction is written down when it is made and graded against the real box score. Past results do not predict future ones.'
  :'Rates appear once '+accuracy.minimumForRate+' picks have been graded. Until then the count is the only honest thing to show.';
 return '<hr><h3>Model record</h3><div class="asPlanCard">'
  +rows.map(function(row){return '<div class="asPlanRow"><span>'+esc(row[0])+'</span><b>'+esc(row[1])+'</b></div>';}).join('')
  +'</div><p class="asNotice">'+esc(note)+'</p>';
}
function googleBlock(){
 if(!accountHealth||!accountHealth.google||!accountHealth.google.available)return '';
 return '<a class="asBtn asGoogleBtn" href="/api/account/google/start"><span class="asGoogleMark" aria-hidden="true">G</span>Continue with Google</a><div class="asAuthOr"><span>or</span></div>';
}
function passwordAvailable(){return !!(accountHealth&&accountHealth.password&&accountHealth.password.available);}
function authUnavailableNotice(){
 var google=!!(accountHealth&&accountHealth.google&&accountHealth.google.available);
 if(passwordAvailable())return '';
 if(google)return '<p class="asNotice">Email sign-up is not switched on yet, because verification codes cannot be delivered. Use Google for now — it confirms your address for us.</p>';
 return '<div class="asAvailability">Sign-in is not switched on yet. Google sign-in and verification email both need to be configured before accounts can be created. Everything else on Auto Scout works without an account.</div>';
}
function authField(id,label,type,autocomplete){
 return '<label for="'+id+'">'+esc(label)+'</label><input class="asControl" id="'+id+'" type="'+type+'" autocomplete="'+autocomplete+'" required>';
}
function authError(message){var el=document.getElementById('asAuthError');if(el)el.textContent=message||'';}
function withBusy(form,run){
 return async function(event){
  event.preventDefault();
  if(authBusy)return;
  authBusy=true;
  var button=form.querySelector('button[type=submit]');if(button)button.disabled=true;
  authError('');
  try{await run();}finally{authBusy=false;if(button)button.disabled=false;}
 };
}
function signedInPanel(){
 var email=account.user&&account.user.email?account.user.email:'your account';
 utility('Your account',
  '<p class="asNotice">Signed in as <b>'+esc(email)+'</b>.</p>'
  +planBlock()
  +'<hr><h3>Saved props</h3><p class="asNotice">'+(serverSaves?'Your saved props follow this account on any device.':'Saved props could not load right now. They are safe — try again shortly.')+'</p>'
  +accuracyBlock()
  +'<hr><div class="asAuthActions"><button class="asBtn" id="asChangePassword">Change password</button><button class="asBtn" id="asSignOutAll">Sign out everywhere</button><button class="asBtn asPrimary" id="asSignOut">Sign out</button></div>'
  +'<p class="asNotice" id="asAuthError" role="alert"></p>');
 document.getElementById('asSignOut').onclick=async function(){
  await accountPost('/api/account/logout');
  await afterAuthChange('Signed out.');
 };
 document.getElementById('asSignOutAll').onclick=async function(){
  var result=await accountPost('/api/account/logout-all');
  if(result.status!==200){authError('Could not sign out your other devices. Try again shortly.');return;}
  await afterAuthChange('Signed out on every device.');
 };
 document.getElementById('asChangePassword').onclick=changePasswordPanel;
}
function changePasswordPanel(){
 utility('Change password','<form id="asAuthForm">'+authField('asCurrentPassword','Current password','password','current-password')+authField('asNewPassword','New password','password','new-password')+'<button class="asBtn asPrimary" type="submit">Update password</button></form><p class="asNotice" id="asAuthError" role="alert"></p><p class="asNotice">Changing your password signs out every other device.</p>');
 var form=document.getElementById('asAuthForm');
 form.onsubmit=withBusy(form,async function(){
  var result=await accountPost('/api/account/password/change',{currentPassword:document.getElementById('asCurrentPassword').value,newPassword:document.getElementById('asNewPassword').value});
  if(result.status!==200||!result.data||!result.data.ok){authError((result.data&&result.data.message)||'That password could not be updated.');return;}
  if(result.data.csrfToken)account.csrfToken=result.data.csrfToken;
  toast('Password updated.');signedInPanel();
 });
}
function verifyPanel(email,purpose){
 var reset=purpose==='reset';
 utility(reset?'Reset your password':'Confirm your email',
  '<p class="asNotice">We sent a code to <b>'+esc(email)+'</b>. Enter it below.</p>'
  +'<form id="asAuthForm">'+authField('asCode','Code','text','one-time-code')
  +(reset?authField('asResetPassword','New password','password','new-password'):'')
  +'<button class="asBtn asPrimary" type="submit">'+(reset?'Set new password':'Confirm')+'</button></form>'
  +'<button class="asBtn" id="asResend">Send another code</button>'
  +'<p class="asNotice" id="asAuthError" role="alert"></p>');
 var form=document.getElementById('asAuthForm');
 form.onsubmit=withBusy(form,async function(){
  var code=document.getElementById('asCode').value.trim();
  var result=reset
   ? await accountPost('/api/account/password/reset',{email:email,code:code,password:document.getElementById('asResetPassword').value})
   : await accountPost('/api/account/verify',{email:email,code:code});
  if(result.status!==200||!result.data||!result.data.ok){authError((result.data&&result.data.message)||'That code did not work.');return;}
  toast(reset?'Password reset. Sign in with it now.':'Email confirmed. Sign in to continue.');
  authPanel('signin',email);
 });
 document.getElementById('asResend').onclick=async function(){
  await accountPost('/api/account/resend',{email:email,purpose:reset?'reset_password':'verify_email'});
  toast('If that address has an account, another code is on its way.');
 };
}
function authPanel(view,prefill){
 var mode=view||'signin',signup=mode==='signup',forgot=mode==='forgot';
 var canPassword=passwordAvailable();
 var tabs=canPassword
  ?'<div class="asAuthTabs" role="tablist"><button role="tab" aria-selected="'+(!signup)+'" data-auth="signin">Sign in</button><button role="tab" aria-selected="'+signup+'" data-auth="signup">Create account</button></div>'
  :'';
 var form=canPassword
  ?'<form id="asAuthForm">'+authField('asEmail','Email','email','email')
   +(forgot?'':authField('asPassword',signup?'Choose a password':'Password','password',signup?'new-password':'current-password'))
   +'<button class="asBtn asPrimary" type="submit">'+(forgot?'Email me a reset code':signup?'Create account':'Sign in')+'</button></form>'
   +(forgot?'<button class="asAuthLink" data-auth="signin">Back to sign in</button>':'<button class="asAuthLink" data-auth="forgot">Forgot password</button>')
  :'';
 utility(forgot?'Reset your password':signup?'Create your account':'Sign in to Auto Scout',
  authUnavailableNotice()+googleBlock()+tabs+form
  +'<p class="asNotice" id="asAuthError" role="alert"></p>'
  +'<hr><p class="asNotice">Auto Scout is a research tool. It reports what the connected feeds actually returned — it does not take bets or handle money.</p>'
  +accuracyBlock()
  +'<details class="asAuthLegacy"><summary>I have an access code</summary><form id="asLegacyForm"><label for="asCredential">Access code or owner password</label><input class="asControl" id="asCredential" type="password" autocomplete="current-password" required><button class="asBtn" type="submit">Use access code</button></form></details>');
 document.querySelectorAll('[data-auth]').forEach(function(button){button.onclick=function(){authPanel(button.dataset.auth,document.getElementById('asEmail')?document.getElementById('asEmail').value:'');};});
 var emailInput=document.getElementById('asEmail');
 if(emailInput&&prefill)emailInput.value=prefill;
 var authForm=document.getElementById('asAuthForm');
 if(authForm)authForm.onsubmit=withBusy(authForm,async function(){
  var email=document.getElementById('asEmail').value.trim();
  if(forgot){
   await accountPost('/api/account/password/forgot',{email:email});
   verifyPanel(email,'reset');return;
  }
  var password=document.getElementById('asPassword').value;
  if(signup){
   var created=await accountPost('/api/account/register',{email:email,password:password});
   if(!created.data||!created.data.ok){authError((created.data&&created.data.message)||'That account could not be created.');return;}
   verifyPanel(email,'verify');return;
  }
  var result=await accountPost('/api/account/login',{email:email,password:password});
  if(result.status!==200||!result.data||!result.data.ok){
   if(result.data&&result.data.requiresVerification){verifyPanel(result.data.email||email,'verify');return;}
   authError((result.data&&result.data.message)||'Sign-in failed. Check your details and try again.');return;
  }
  await afterAuthChange('Signed in.');
 });
 var legacy=document.getElementById('asLegacyForm');
 if(legacy)legacy.onsubmit=withBusy(legacy,async function(){
  var result=await accountJson('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accessCode:document.getElementById('asCredential').value})});
  if(result.status!==200){authError('That access code was not accepted.');return;}
  await afterAuthChange('Access code accepted.');
 });
}
async function afterAuthChange(message){
 intelligence?.clearSession();
 saveEpoch++;serverSaves=null;profile=null;savedRecords=new Map();favorites=new Set();
 await loadAccount();
 await loadSaved();
 renderList();
 toast(message);
 var dialog=document.getElementById('asUtility');if(dialog&&dialog.open)dialog.close();
}
async function accountPanel(){
 await loadAccount();
 if(account.authenticated){await loadSaved();signedInPanel();return;}
 authPanel('signin','');
}
// Google sends the browser back with a result in the query string. Report it
// once, then strip it so a refresh does not repeat the message.
function reportSigninRedirect(){
 var value=new URLSearchParams(location.search).get('signin');
 if(!value)return;
 history.replaceState(null,'',location.pathname+location.hash);
 if(value==='ok')return;
 toast(value==='cancelled'?'Google sign-in was cancelled.':value==='expired'?'That sign-in link expired. Please try again.':'Google sign-in could not be completed.');
}

setInterval(hydrateML,30000);
setInterval(()=>removeExpiredTacoBadges(document),1000);
document.addEventListener('visibilitychange',()=>removeExpiredTacoBadges(document));
shell();reportSigninRedirect();loadAccount();loadSaved().then(()=>{if(!loading)renderListLight();});load();setInterval(function(){if(!document.hidden&&!drawerState&&!loading)load();},90000);
})().catch(function(){var root=document.getElementById('as5')||document.querySelector('main')||document.body;root.replaceChildren();var message=document.createElement('p');message.textContent='Auto Scout could not load. Please refresh to try again.';message.setAttribute('role','alert');root.appendChild(message);var retry=document.createElement('button');retry.textContent='Refresh';retry.onclick=function(){location.reload();};root.appendChild(retry);});
