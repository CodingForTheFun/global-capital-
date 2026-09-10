(function(){
'use strict';

var nativeFetch=window.fetch.bind(window);
var prefs={
  compact:localStorage.getItem('autoscout-ui-compact')==='1',
  books:localStorage.getItem('autoscout-ui-books')!=='0',
  reduceMotion:localStorage.getItem('autoscout-ui-reduce-motion')==='1'
};
var view=localStorage.getItem('autoscout-ui-view')||'all';
var matchup='all';
var matchupSignature='';
var mounted=false;

function esc(v){return String(v==null?'':v).replace(/[&<>\"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c];});}
function q(s,r){return (r||document).querySelector(s);}
function qa(s,r){return Array.from((r||document).querySelectorAll(s));}
function text(el){return String(el&&el.textContent||'').trim();}
function rows(){return qa('#asList .asRow');}
function rowMatchup(row){var raw=text(q('.asGame',row));return raw.split('·')[0].trim()||'Matchup unavailable';}
function setView(next){view=next||'all';localStorage.setItem('autoscout-ui-view',view);qa('[data-pro-view]').forEach(function(b){b.classList.toggle('on',b.dataset.proView===view);});applyDomFilters();}
function applyPrefs(){document.body.classList.toggle('asProCompact',prefs.compact);document.body.classList.toggle('asProHideBooks',!prefs.books);document.body.classList.toggle('asProReduceMotion',prefs.reduceMotion);}

function styleText(){return '<style id="autoscout-premium-polish">'+
':root{--pro-panel:#0a111d;--pro-panel2:#0f1928;--pro-line:#263550;--pro-soft:#92a0b5;--pro-green:#5ff0b1;--pro-blue:#78adff;--pro-amber:#efc767}'+
'.asTop{box-shadow:0 12px 40px rgba(0,0,0,.22)}'+
'.asProNav{display:flex;align-items:center;gap:4px;margin-left:10px}.asProNavBtn{height:30px;border:1px solid transparent;background:transparent;color:#8290a4;border-radius:8px;padding:0 9px;font-size:8px;font-weight:950;letter-spacing:.04em}.asProNavBtn:hover,.asProNavBtn.on{color:#fff;background:#121d2d;border-color:#2b3d59}'+
'.asProDataStrip{max-width:1380px;margin:0 auto;padding:0 12px 8px;display:flex;gap:6px;overflow:auto}.asProPill{flex:0 0 auto;border:1px solid #24334b;background:#0b1320;border-radius:999px;padding:5px 8px;font-size:7px;font-weight:900;color:#8391a5}.asProPill b{color:#dfe8f6}.asProPill.good{border-color:#285742;background:#0d211a;color:#8fe8bf}.asProPill.warn{border-color:#5c4c27;background:#201a0e;color:#e9ca78}'+
'.asFilters{grid-template-columns:minmax(220px,1.5fr) repeat(5,minmax(105px,.65fr))}'+
'.asProQuick{display:flex;align-items:center;gap:5px;margin:-2px 0 10px;overflow:auto}.asProQuickLabel{font-size:7px;color:#6f7e93;font-weight:950;text-transform:uppercase;letter-spacing:.08em;margin-right:2px}.asProChip{height:29px;flex:0 0 auto;border:1px solid #263550;background:#0a111c;color:#8391a6;border-radius:8px;padding:0 9px;font-size:7px;font-weight:950}.asProChip.on{color:#fff;background:#17253a;border-color:#3c587c}.asProChip[data-pro-view="ready"].on{color:#8ff0c0;border-color:#2f684f;background:#10251d}.asProChip[data-pro-view="unavailable"].on{color:#f0d18a;border-color:#65542d;background:#221b0f}.asProChip[data-pro-view="saved"].on{color:#ffe08a;border-color:#66592e;background:#211c10}'+
'.asRow{transition:border-color .15s ease,transform .15s ease,box-shadow .15s ease}.asRow:hover{border-color:#38506f;transform:translateY(-1px);box-shadow:0 12px 32px rgba(0,0,0,.23)}'+
'.asResearchState.unavailable{max-width:58%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.asHeroBadge{box-shadow:inset 0 0 0 1px rgba(96,241,177,.05)}'+
'.asProCompact .asRowMain{min-height:64px}.asProCompact .asPlayerCell{padding-top:6px;padding-bottom:6px}.asProCompact .asAvatar{width:40px;height:40px}.asProCompact .asPlayerCell{grid-template-columns:42px 1fr}.asProCompact .asBookRail{padding-top:5px;padding-bottom:5px}.asProHideBooks .asBookRail{display:none!important}.asProReduceMotion *{animation:none!important;transition:none!important;scroll-behavior:auto!important}'+
'.asProModalBg{position:fixed;inset:0;z-index:120;background:rgba(0,0,0,.72);display:none;padding:16px}.asProModalBg.on{display:grid;place-items:center}.asProModal{width:min(620px,100%);max-height:min(760px,90vh);overflow:auto;border:1px solid #2a3a55;background:linear-gradient(180deg,#101a2a,#080d15);border-radius:16px;box-shadow:0 30px 90px rgba(0,0,0,.48)}.asProModalHead{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:10px;padding:13px 14px;border-bottom:1px solid #24334b;background:rgba(12,19,31,.97);backdrop-filter:blur(14px)}.asProModalHead h2{margin:0;font-size:15px}.asProModalHead p{margin:2px 0 0;color:#7e8da2;font-size:8px}.asProModalClose{margin-left:auto;width:32px;height:32px;border:1px solid #31415d;background:#121b2a;color:#fff;border-radius:9px;font-size:16px}.asProModalBody{padding:12px}'+
'.asProHealthGrid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.asProHealthCard{border:1px solid #253650;background:#0a111c;border-radius:10px;padding:10px}.asProHealthCard small{display:block;color:#718197;font-size:7px;text-transform:uppercase;font-weight:950;letter-spacing:.07em}.asProHealthCard b{display:block;margin-top:4px;font-size:12px}.asProHealthCard span{display:block;color:#8392a7;font-size:8px;line-height:1.45;margin-top:4px}.asProHealthCard.good b{color:#74efb6}.asProHealthCard.warn b{color:#ebc870}'+
'.asProNote{margin-top:9px;border:1px solid #2b3b55;background:#0a121e;border-radius:10px;padding:10px;color:#91a0b5;font-size:8px;line-height:1.55}.asProNote b{color:#eef3fb}'+
'.asProSetting{display:flex;align-items:center;gap:12px;padding:12px 2px;border-bottom:1px solid #202d42}.asProSetting:last-child{border-bottom:0}.asProSettingText{flex:1}.asProSettingText b{display:block;font-size:10px}.asProSettingText span{display:block;color:#7e8da1;font-size:8px;margin-top:3px;line-height:1.4}.asProSwitch{width:43px;height:24px;position:relative}.asProSwitch input{position:absolute;opacity:0}.asProSwitch i{position:absolute;inset:0;border:1px solid #3a4a65;background:#111a28;border-radius:999px}.asProSwitch i:after{content:"";position:absolute;width:16px;height:16px;left:3px;top:3px;border-radius:50%;background:#7e8da1;transition:.15s}.asProSwitch input:checked+i{border-color:#347159;background:#0e2a20}.asProSwitch input:checked+i:after{left:21px;background:#62e9ae}'+
'.asProBottom{display:none}'+
'@media(max-width:980px){.asFilters{grid-template-columns:1fr 1fr 1fr}.asFilters input{grid-column:1/-1}}'+
'@media(max-width:760px){.asProNav{display:none}.asBar .asBtn{height:32px}.asProDataStrip{padding-bottom:6px}.asProQuick{margin-bottom:8px}.asFilters{grid-template-columns:1fr 1fr}.asFilters input{grid-column:1/-1}.asProBottom{position:fixed;left:8px;right:8px;bottom:max(8px,env(safe-area-inset-bottom));z-index:65;display:grid;grid-template-columns:repeat(4,1fr);gap:4px;padding:5px;border:1px solid #293950;background:rgba(10,16,27,.96);backdrop-filter:blur(18px);border-radius:13px;box-shadow:0 14px 40px rgba(0,0,0,.4)}.asProBottom button{height:38px;border:0;background:transparent;color:#7f8ea3;border-radius:9px;font-size:7px;font-weight:950}.asProBottom button.on{background:#172439;color:#fff}.as5{padding-bottom:84px}.asProHealthGrid{grid-template-columns:1fr}.asProModalBg{padding:8px}.asProModal{border-radius:14px}.asProCompact .asAvatar{width:44px;height:44px}.asProCompact .asPlayerCell{grid-template-columns:48px 1fr auto}}'+
'</style>';}

function shellExtras(){
  if(q('#autoscout-premium-polish'))return;
  document.head.insertAdjacentHTML('beforeend',styleText());
  var bar=q('.asBar');
  if(bar){
    var brand=q('.asBrand',bar);
    if(brand)brand.insertAdjacentHTML('afterend','<nav class="asProNav" aria-label="Auto Scout views"><button class="asProNavBtn on" data-pro-nav="research">RESEARCH</button><button class="asProNavBtn" data-pro-nav="saved">SAVED</button><button class="asProNavBtn" data-pro-nav="data">DATA</button></nav>');
    var refresh=q('#asRefresh',bar);
    if(refresh)refresh.insertAdjacentHTML('beforebegin','<button class="asBtn" id="asProSettings" title="Display settings">SETTINGS</button>');
  }
  var sports=q('.asSports');
  if(sports)sports.insertAdjacentHTML('afterend','<div class="asProDataStrip" id="asProDataStrip"><span class="asProPill">LINES <b>Checking…</b></span><span class="asProPill">RESEARCH <b>Checking…</b></span><span class="asProPill">DATABASE <b>Checking…</b></span></div>');
  var filters=q('.asFilters');
  if(filters&&!q('#asMatchup'))filters.insertAdjacentHTML('beforeend','<select class="asControl" id="asMatchup"><option value="all">All matchups</option></select>');
  var summary=q('#asSummary');
  if(summary)summary.insertAdjacentHTML('afterend','<section class="asProQuick" id="asProQuick"><span class="asProQuickLabel">View</span><button class="asProChip" data-pro-view="all">All</button><button class="asProChip" data-pro-view="ready">Research ready</button><button class="asProChip" data-pro-view="unavailable">Unavailable</button><button class="asProChip" data-pro-view="saved">Saved</button><button class="asProChip" data-pro-view="live">Live</button></section>');
  document.body.insertAdjacentHTML('beforeend','<div class="asProModalBg" id="asProModalBg" role="dialog" aria-modal="true"><div class="asProModal"><div class="asProModalHead"><div><h2 id="asProModalTitle">Auto Scout</h2><p id="asProModalSub"></p></div><button class="asProModalClose" id="asProModalClose">×</button></div><div class="asProModalBody" id="asProModalBody"></div></div></div><nav class="asProBottom" aria-label="Auto Scout mobile navigation"><button data-pro-bottom="research">RESEARCH</button><button data-pro-bottom="saved">SAVED</button><button data-pro-bottom="data">DATA</button><button data-pro-bottom="top">TOP</button></nav>');
}

function updateActiveNav(name){
  qa('[data-pro-nav]').forEach(function(b){b.classList.toggle('on',b.dataset.proNav===name);});
  qa('[data-pro-bottom]').forEach(function(b){b.classList.toggle('on',b.dataset.proBottom===name);});
}

function refreshMatchups(){
  var select=q('#asMatchup');if(!select)return;
  var values=Array.from(new Set(rows().map(rowMatchup).filter(Boolean))).sort();
  var sig=values.join('|');
  if(sig===matchupSignature)return;
  matchupSignature=sig;
  var current=matchup;
  select.innerHTML='<option value="all">All matchups</option>'+values.map(function(v){return '<option value="'+esc(v)+'">'+esc(v)+'</option>';}).join('');
  if(values.indexOf(current)>=0)select.value=current;else{matchup='all';select.value='all';}
}

function applyDomFilters(){
  rows().forEach(function(row){
    var show=true;
    if(matchup!=='all'&&rowMatchup(row)!==matchup)show=false;
    if(view==='ready'&&!q('.asResearchState.ready',row))show=false;
    if(view==='unavailable'&&!q('.asResearchState.unavailable',row))show=false;
    if(view==='saved'&&!q('.asSave.on',row))show=false;
    if(view==='live'&&text(q('.asGame',row)).indexOf('LIVE')<0)show=false;
    row.style.display=show?'':'none';
  });
  qa('[data-pro-view]').forEach(function(b){b.classList.toggle('on',b.dataset.proView===view);});
}

function openModal(title,sub,body){
  q('#asProModalTitle').textContent=title;
  q('#asProModalSub').textContent=sub||'';
  q('#asProModalBody').innerHTML=body||'';
  q('#asProModalBg').classList.add('on');
  document.body.style.overflow='hidden';
}
function closeModal(){var bg=q('#asProModalBg');if(bg)bg.classList.remove('on');document.body.style.overflow='';}

function healthCard(label,value,detail,status){return '<div class="asProHealthCard '+esc(status||'')+'"><small>'+esc(label)+'</small><b>'+esc(value)+'</b><span>'+esc(detail||'')+'</span></div>';}
async function loadHealthStrip(){
  var strip=q('#asProDataStrip');if(!strip)return;
  try{
    var rs=await Promise.all([nativeFetch('/api/apex/health',{cache:'no-store'}),nativeFetch('/api/apex/research-health',{cache:'no-store'})]);
    var health=await rs[0].json();var research=await rs[1].json();var rr=research&&research.research||{};
    var lineGood=health&&health.theOddsApiConfigured===true;
    var dbGood=health&&health.persistence&&health.persistence.configured===true;
    var clearGood=Boolean(rr&&rr.clearSports&&rr.clearSports.configured);
    var researchLabel=clearGood?'ClearSports context':'Research feed unavailable';
    strip.innerHTML='<span class="asProPill '+(lineGood?'good':'warn')+'">LINES <b>'+(lineGood?'The Odds API':'Unavailable')+'</b></span><span class="asProPill '+(clearGood?'good':'warn')+'">RESEARCH <b>'+esc(researchLabel)+'</b></span><span class="asProPill '+(dbGood?'good':'warn')+'">DATABASE <b>'+(dbGood?'Connected':'Unavailable')+'</b></span>';
  }catch(e){strip.innerHTML='<span class="asProPill warn">DATA STATUS <b>Temporarily unavailable</b></span>';}
}

async function openData(){
  updateActiveNav('data');
  openModal('Data health','What Auto Scout can verify right now','<div class="asLoading"><div><div class="asPulse"></div>Checking live data sources…</div></div>');
  try{
    var rs=await Promise.all([nativeFetch('/api/apex/health',{cache:'no-store'}),nativeFetch('/api/apex/research-health',{cache:'no-store'})]);
    var h=await rs[0].json();var r=await rs[1].json();var rr=r&&r.research||{};
    var lines=h&&h.theOddsApiConfigured===true;
    var db=Boolean(h&&h.persistence&&h.persistence.configured);
    var clear=Boolean(rr&&rr.clearSports&&rr.clearSports.configured);
    var hist=String(rr&&rr.historicalGameLogProvider||'').trim();
    var body='<div class="asProHealthGrid">'+
      healthCard('Live props + lines',lines?'CONNECTED':'UNAVAILABLE',lines?'The Odds API is the active live-market source.':'No verified live odds provider is connected.',lines?'good':'warn')+
      healthCard('Player context',clear?'CONNECTED':'LIMITED',clear?'ClearSports supplies supported season/player context.':'Context remains unavailable when the provider has no supported feed.',clear?'good':'warn')+
      healthCard('Historical game logs',hist||'NOT VERIFIED',hist?'Auto Scout only displays L5/L10/L15 when individual games are actually returned.':'No per-game history provider is currently verified.','warn')+
      healthCard('Line-history database',db?'CONNECTED':'UNAVAILABLE',db?'Supabase is storing normalized market data and real line snapshots.':'Line movement cannot accumulate without persistence.',db?'good':'warn')+
      '</div><div class="asProNote"><b>No fabricated research.</b> Missing L5, L10, L15, H2H, projections, injuries or rankings stay marked unavailable until a connected source supplies enough real data to calculate them.</div>';
    q('#asProModalBody').innerHTML=body;
  }catch(e){q('#asProModalBody').innerHTML='<div class="asError">Data health could not be loaded right now.</div>';}
}

function settingRow(id,label,detail,checked){return '<label class="asProSetting"><span class="asProSettingText"><b>'+esc(label)+'</b><span>'+esc(detail)+'</span></span><span class="asProSwitch"><input type="checkbox" id="'+esc(id)+'" '+(checked?'checked':'')+'><i></i></span></label>';}
function openSettings(){
  updateActiveNav('research');
  openModal('Display settings','Saved only on this device',settingRow('asSetCompact','Compact research rows','Tighten spacing on desktop and mobile without hiding research values.',prefs.compact)+settingRow('asSetBooks','Show sportsbook rail','Keep individual book over/under quotes visible under each prop.',prefs.books)+settingRow('asSetMotion','Reduce motion','Disable interface animation and hover movement.',prefs.reduceMotion));
  q('#asSetCompact').onchange=function(e){prefs.compact=e.target.checked;localStorage.setItem('autoscout-ui-compact',prefs.compact?'1':'0');applyPrefs();};
  q('#asSetBooks').onchange=function(e){prefs.books=e.target.checked;localStorage.setItem('autoscout-ui-books',prefs.books?'1':'0');applyPrefs();};
  q('#asSetMotion').onchange=function(e){prefs.reduceMotion=e.target.checked;localStorage.setItem('autoscout-ui-reduce-motion',prefs.reduceMotion?'1':'0');applyPrefs();};
}

function bind(){
  qa('[data-pro-view]').forEach(function(b){b.onclick=function(){setView(b.dataset.proView);};});
  var ms=q('#asMatchup');if(ms)ms.onchange=function(e){matchup=e.target.value||'all';applyDomFilters();};
  qa('[data-pro-nav]').forEach(function(b){b.onclick=function(){var n=b.dataset.proNav;if(n==='research'){updateActiveNav('research');setView('all');window.scrollTo({top:0,behavior:prefs.reduceMotion?'auto':'smooth'});}else if(n==='saved'){updateActiveNav('saved');setView('saved');}else if(n==='data'){openData();}};});
  qa('[data-pro-bottom]').forEach(function(b){b.onclick=function(){var n=b.dataset.proBottom;if(n==='research'){updateActiveNav('research');setView('all');window.scrollTo({top:0,behavior:prefs.reduceMotion?'auto':'smooth'});}else if(n==='saved'){updateActiveNav('saved');setView('saved');}else if(n==='data'){openData();}else if(n==='top'){window.scrollTo({top:0,behavior:prefs.reduceMotion?'auto':'smooth'});}};});
  var settings=q('#asProSettings');if(settings)settings.onclick=openSettings;
  q('#asProModalClose').onclick=closeModal;
  q('#asProModalBg').onclick=function(e){if(e.target===this)closeModal();};
  document.addEventListener('keydown',function(e){if(e.key==='Escape')closeModal();if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();var s=q('#asSearch');if(s){s.focus();s.select();}}});
  var list=q('#asList');if(list){new MutationObserver(function(){refreshMatchups();applyDomFilters();}).observe(list,{childList:true});}
}

function mount(){
  if(mounted||!q('#as5'))return false;
  mounted=true;
  shellExtras();
  applyPrefs();
  bind();
  refreshMatchups();
  setView(view);
  updateActiveNav(view==='saved'?'saved':'research');
  loadHealthStrip();
  setInterval(loadHealthStrip,120000);
  return true;
}

if(!mount()){
  var tries=0;var timer=setInterval(function(){tries+=1;if(mount()||tries>80)clearInterval(timer);},100);
}
})();
