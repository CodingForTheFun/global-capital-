export function patchLiveMainViewUi(source) {
  const out = String(source || '');
  if (!out.includes('asNav')) throw new Error('Inline Live patch could not locate the ObligeProps navigation.');

  const runtime = String.raw`
;(function obligePropsInlineLiveScores(){
  var started=false;
  function boot(){
    if(started)return;
    var root=document.getElementById('as5');
    var nav=root&&root.querySelector('.asNav');
    var main=root&&root.querySelector('.asMain');
    var liveButton=nav&&nav.querySelector('.asNavScores');
    if(!root||!nav||!main||!liveButton)return;
    started=true;

    liveButton.id='asLiveMainTab';
    liveButton.classList.add('asNavLive');
    liveButton.setAttribute('aria-label','Live sports scores');

    var style=document.createElement('style');
    style.id='oblige-inline-live-style';
    style.textContent=[
      '#as5 #asLiveMainView[hidden]{display:none!important}',
      '#as5 .asLiveEmbedded{max-width:1380px;margin:auto;padding:14px 14px 96px}',
      '#as5 .asLiveInlineHead{display:flex;gap:14px;align-items:flex-end;margin:4px 0 12px}',
      '#as5 .asLiveInlineHead h1{margin:2px 0 0;font-size:30px;letter-spacing:-.055em;line-height:1}',
      '#as5 .asLiveInlineHead p{margin:6px 0 0;color:#8797ad;font-size:10px;max-width:680px}',
      '#as5 .asLiveTitleRow{display:flex;align-items:center;gap:8px}',
      '#as5 .asLiveToday{display:inline-flex;align-items:center;height:23px;padding:0 8px;border:1px solid rgba(255,255,255,.1);border-radius:999px;background:rgba(255,255,255,.045);color:#dbe3ef;font-size:8px;font-weight:850}',
      '#as5 .asLiveInlineFresh{margin-left:auto;text-align:right;border:1px solid rgba(91,120,166,.28);background:linear-gradient(145deg,rgba(15,27,47,.96),rgba(5,11,23,.98));border-radius:14px;padding:9px 11px;min-width:118px}',
      '#as5 .asLiveInlineFresh span,#as5 .asLiveInlineFresh small{display:block;color:#8295b0;font-size:8px}',
      '#as5 .asLiveInlineFresh strong{display:block;font-size:14px;margin:2px 0;color:#f7fbff}',
      '#as5 .asLiveInlineStats{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:10px}',
      '#as5 .asLiveInlineStats>div{border:1px solid rgba(91,120,166,.26);background:linear-gradient(145deg,rgba(15,27,47,.94),rgba(5,11,23,.98));border-radius:13px;padding:9px 11px}',
      '#as5 .asLiveInlineStats span{display:block;color:#8295b0;font-size:7px;text-transform:uppercase;letter-spacing:.08em;font-weight:850}',
      '#as5 .asLiveInlineStats strong{display:block;font-size:18px;margin-top:2px}',
      '#as5 .asLiveInlineToolbar{position:sticky;top:8px;z-index:9;display:flex;gap:8px;align-items:center;margin:0 0 12px;padding:7px;border:1px solid rgba(91,120,166,.24);border-radius:14px;background:rgba(7,15,27,.88);backdrop-filter:blur(18px) saturate(145%)}',
      '#as5 .asLiveInlineSports{display:flex;gap:6px;overflow-x:auto;flex:1;scrollbar-width:none}',
      '#as5 .asLiveInlineSports::-webkit-scrollbar{display:none}',
      '#as5 .asLiveInlineChip,#as5 .asLiveInlineRefresh{border:1px solid rgba(86,113,155,.32);background:rgba(255,255,255,.035);color:#aebdd2;border-radius:999px;height:30px;padding:0 11px;font-size:8px;font-weight:850;white-space:nowrap}',
      '#as5 .asLiveInlineChip.on{background:#eef3fa;color:#0b1421;border-color:#eef3fa}',
      '#as5 .asLiveInlineRefresh{border-radius:10px;min-width:62px;color:#eef5ff}',
      '#as5 .asLiveInlineNotice{border:1px solid rgba(255,96,116,.35);background:rgba(88,22,36,.28);color:#ffc1ca;border-radius:12px;padding:10px 12px;margin:0 0 12px;font-size:9px}',
      '#as5 .asLiveInlineSection{margin-top:16px}',
      '#as5 .asLiveInlineTitle{display:flex;align-items:end;justify-content:space-between;gap:12px;margin-bottom:8px;padding:0 2px}',
      '#as5 .asLiveInlineTitle small{color:#8295b0;font-size:8px}',
      '#as5 .asLiveInlineTitle h2{margin:1px 0 0;font-size:17px;letter-spacing:-.02em}',
      '#as5 .asLiveKicker{display:flex;align-items:center;gap:5px;color:#ff7169;font-size:7px;font-weight:950;letter-spacing:.12em}',
      '#as5 .asLiveKicker i{width:6px;height:6px;border-radius:50%;background:#ff453a;box-shadow:0 0 0 3px rgba(255,69,58,.1)}',
      '#as5 .asLiveGameGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}',
      '#as5 .asLiveGame{overflow:hidden;border:1px solid rgba(91,120,166,.28);background:linear-gradient(145deg,rgba(15,27,47,.97),rgba(5,11,23,.99));border-radius:16px;padding:12px 13px 10px;box-shadow:0 12px 30px rgba(0,0,0,.18)}',
      '#as5 .asLiveGame.live{border-color:rgba(255,69,58,.3)}',
      '#as5 .asLiveGame.final{opacity:.92}',
      '#as5 .asLiveGameHead,#as5 .asLiveGameFoot{display:flex;align-items:center;justify-content:space-between;gap:10px}',
      '#as5 .asLiveGameHead{margin-bottom:8px}',
      '#as5 .asLiveLeague{font-size:8px;font-weight:950;letter-spacing:.07em;color:#d8e0eb;text-transform:uppercase}',
      '#as5 .asLiveGameState{display:flex;align-items:center;gap:5px;font-size:8px;font-weight:850;color:#8797ad;text-align:right}',
      '#as5 .asLiveGame.live .asLiveGameState{color:#ff7169}',
      '#as5 .asLiveGame.live .asLiveGameState i{width:6px;height:6px;border-radius:50%;background:#ff453a;box-shadow:0 0 0 3px rgba(255,69,58,.1)}',
      '#as5 .asLiveTeamStack{border-top:1px solid rgba(83,111,155,.15);border-bottom:1px solid rgba(83,111,155,.15)}',
      '#as5 .asLiveTeamRow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;min-height:48px;padding:6px 0}',
      '#as5 .asLiveTeamRow+.asLiveTeamRow{border-top:1px solid rgba(83,111,155,.15)}',
      '#as5 .asLiveTeamIdentity{display:flex;align-items:center;gap:9px;min-width:0}',
      '#as5 .asLiveTeamMark{display:flex;align-items:center;justify-content:center;flex:0 0 32px;width:32px;height:32px;border:1px solid rgba(255,255,255,.07);border-radius:50%;background:rgba(255,255,255,.04);overflow:hidden;color:#cbd5e3;font-size:7px;font-weight:950}',
      '#as5 .asLiveTeamMark img{display:block;width:25px;height:25px;object-fit:contain}',
      '#as5 .asLiveTeamCopy{min-width:0}',
      '#as5 .asLiveTeamCopy b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:#f3f7fb}',
      '#as5 .asLiveTeamCopy small{display:block;margin-top:2px;color:#75849a;font-size:7px;font-weight:850;letter-spacing:.05em}',
      '#as5 .asLiveScore{min-width:31px;text-align:right;font-size:23px;font-weight:900;line-height:1;letter-spacing:-.04em;font-variant-numeric:tabular-nums}',
      '#as5 .asLiveScore.pending{height:1px}',
      '#as5 .asLiveGame.final .asLiveScore{color:#bdc7d5}',
      '#as5 .asLiveGameFoot{margin-top:8px;color:#74849b;font-size:7px}',
      '#as5 .asLiveGameFoot span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#as5 .asLiveGameFoot span:first-child{max-width:70%}',
      '#as5 .asLiveEmpty{grid-column:1/-1;border:1px dashed rgba(91,120,166,.3);border-radius:14px;padding:24px 16px;color:#8295b0;font-size:9px;text-align:center}',
      '#as5 .asLiveEmpty b{display:block;color:#eef5ff;font-size:12px;margin-bottom:4px}',
      '@media(max-width:650px){#as5 .asLiveEmbedded{padding:10px 8px 88px}#as5 .asLiveInlineHead{align-items:flex-end;gap:8px}#as5 .asLiveInlineHead h1{font-size:25px}#as5 .asLiveInlineHead p{display:none}#as5 .asLiveToday{height:21px;font-size:7px}#as5 .asLiveInlineFresh{min-width:94px;padding:7px 8px}#as5 .asLiveInlineFresh strong{font-size:11px}#as5 .asLiveInlineStats{gap:5px}#as5 .asLiveInlineStats>div{padding:8px}#as5 .asLiveInlineStats strong{font-size:16px}#as5 .asLiveInlineToolbar{top:6px;padding:6px}#as5 .asLiveGameGrid{grid-template-columns:1fr;gap:7px}#as5 .asLiveGame{padding:11px 12px 9px;border-radius:15px}#as5 .asLiveTeamRow{min-height:46px}#as5 .asLiveScore{font-size:22px}#as5 .asNavScores{display:grid!important;grid-template-rows:22px 13px!important;place-items:center!important}}',
      '@media(min-width:1180px){#as5 .asLiveGameGrid{grid-template-columns:repeat(3,minmax(0,1fr))}}'
    ].join('\n');
    (document.head||document.documentElement).appendChild(style);

    var panel=document.createElement('main');
    panel.id='asLiveMainView';
    panel.className='asLiveEmbedded';
    panel.hidden=true;
    panel.innerHTML=[
      '<section class="asLiveInlineHead"><div><span class="asEyebrow">LIVE SPORTS</span><div class="asLiveTitleRow"><h1>Scores</h1><span class="asLiveToday">Today & next up</span></div><p>Live games first, then upcoming games and recent finals. Scores refresh automatically.</p></div><div class="asLiveInlineFresh"><span>Updated</span><strong id="asLiveInlineUpdated">—</strong><small id="asLiveInlinePoll">Ready</small></div></section>',
      '<section class="asLiveInlineStats"><div><span>Live now</span><strong id="asLiveInlineNow">—</strong></div><div><span>Upcoming</span><strong id="asLiveInlineUpcoming">—</strong></div><div><span>Recent finals</span><strong id="asLiveInlineFinal">—</strong></div></section>',
      '<section class="asLiveInlineToolbar"><div id="asLiveInlineSports" class="asLiveInlineSports"><button class="asLiveInlineChip on" data-inline-live-sport="" type="button">All</button></div><button id="asLiveInlineRefresh" class="asLiveInlineRefresh" type="button">Refresh</button></section>',
      '<div id="asLiveInlineNotice" class="asLiveInlineNotice" hidden></div>',
      '<section id="asLiveNowSection" class="asLiveInlineSection" hidden><div class="asLiveInlineTitle"><div><span class="asLiveKicker"><i></i> LIVE</span><h2>In progress</h2></div><small id="asLiveInlineCoverage">Checking feeds</small></div><div id="asLiveNowGrid" class="asLiveGameGrid"></div></section>',
      '<section id="asLiveUpcomingSection" class="asLiveInlineSection" hidden><div class="asLiveInlineTitle"><div><span class="asEyebrow">NEXT UP</span><h2>Upcoming</h2></div><small>Scheduled start times</small></div><div id="asLiveUpcomingGrid" class="asLiveGameGrid"></div></section>',
      '<section id="asLiveFinalSection" class="asLiveInlineSection" hidden><div class="asLiveInlineTitle"><div><span class="asEyebrow">RECENT</span><h2>Final</h2></div><small>Most recent results first</small></div><div id="asLiveFinalGrid" class="asLiveGameGrid"></div></section>',
      '<section id="asLiveEmpty" class="asLiveInlineSection" hidden><div class="asLiveEmpty"><b>No games in this window</b>Choose another sport or check back when the next slate is posted.</div></section>'
    ].join('');
    main.insertAdjacentElement('afterend',panel);

    var sportsStrip=root.querySelector('.asSports');
    var state={active:false,sport:'',timer:null,loading:false,lastLiveCount:0,previousView:'research',snapshot:null};
    var sportOrder=['NFL','NCAAF','NBA','WNBA','MLB','NHL','NCAAB','SOCCER','TENNIS'];
    function el(id){return document.getElementById(id);}
    function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];});}
    function show(value){return value===null||value===undefined||value===''?'—':esc(value);}
    function time(value){if(!value)return '—';var d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):'—';}
    function startTime(value){if(!value)return 'Time TBD';var d=new Date(value);if(!Number.isFinite(d.getTime()))return 'Time TBD';var n=new Date();var same=d.getFullYear()===n.getFullYear()&&d.getMonth()===n.getMonth()&&d.getDate()===n.getDate();var t=d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});return same?t:d.toLocaleDateString([], {weekday:'short'})+' · '+t;}
    function gameStatus(game){if(game.status==='LIVE')return game.providerStatus||game.periodLabel||game.clock||'In progress';if(game.status==='FINAL')return /final/i.test(game.providerStatus||'')?game.providerStatus:'Final';if(game.status==='SCHEDULED')return startTime(game.startTime);return game.providerStatus||'Status unavailable';}
    function teamMark(game,side){var logo=game[side+'Logo'];var short=game[side+'Team']||game[side+'Name']||'?';return logo?'<span class="asLiveTeamMark"><img src="'+esc(logo)+'" alt="" loading="lazy" referrerpolicy="no-referrer"></span>':'<span class="asLiveTeamMark">'+esc(String(short).slice(0,3).toUpperCase())+'</span>';}
    function teamRow(game,side){var short=game[side+'Team'];var name=game[side+'Name']||short||'Team';var score=game[side+'Score'];var scoreHtml=score===null||score===undefined?'<span class="asLiveScore pending"></span>':'<strong class="asLiveScore">'+esc(score)+'</strong>';return '<div class="asLiveTeamRow"><div class="asLiveTeamIdentity">'+teamMark(game,side)+'<div class="asLiveTeamCopy"><b>'+esc(name)+'</b>'+(short&&short!==name?'<small>'+esc(short)+'</small>':'')+'</div></div>'+scoreHtml+'</div>';}
    function gameHtml(game){var live=game.status==='LIVE',final=game.status==='FINAL';var secondary=game.broadcast||game.venue||game.sport||'';return '<article class="asLiveGame '+(live?'live':final?'final':'upcoming')+'"><div class="asLiveGameHead"><span class="asLiveLeague">'+esc(game.league||game.sport||'')+'</span><span class="asLiveGameState">'+(live?'<i></i>':'')+esc(gameStatus(game))+'</span></div><div class="asLiveTeamStack">'+teamRow(game,'away')+teamRow(game,'home')+'</div><div class="asLiveGameFoot"><span>'+esc(secondary)+(live&&game.possession?' · '+esc(game.possession)+' ball':'')+'</span><span>'+(live?'Live':final?'Final':esc(startTime(game.startTime)))+'</span></div></article>';}
    function filterRows(rows){return state.sport?(rows||[]).filter(function(row){return String(row.sport||'').toUpperCase()===state.sport;}):(rows||[]);}
    function renderSports(snapshot){var seen={},sports=[];(snapshot.coverage||[]).forEach(function(row){var s=String(row.sport||'').toUpperCase();if(s&&!seen[s]){seen[s]=1;sports.push(s);}});sports.sort(function(a,b){var ai=sportOrder.indexOf(a),bi=sportOrder.indexOf(b);return (ai<0?99:ai)-(bi<0?99:bi)||a.localeCompare(b);});el('asLiveInlineSports').innerHTML='<button class="asLiveInlineChip '+(!state.sport?'on':'')+'" data-inline-live-sport="" type="button">All</button>'+sports.map(function(s){return '<button class="asLiveInlineChip '+(state.sport===s?'on':'')+'" data-inline-live-sport="'+esc(s)+'" type="button">'+esc(s)+'</button>';}).join('');}
    function renderSection(sectionId,gridId,rows){var section=el(sectionId);section.hidden=!rows.length;el(gridId).innerHTML=rows.map(gameHtml).join('');}
    function renderCurrent(){var snapshot=state.snapshot;if(!snapshot)return;var live=filterRows(snapshot.live||[]),upcoming=filterRows(snapshot.upcoming||[]).slice(0,48),finals=filterRows(snapshot.final||[]).slice(0,36);state.lastLiveCount=live.length;el('asLiveInlineNow').textContent=String(live.length);el('asLiveInlineUpcoming').textContent=String(upcoming.length);el('asLiveInlineFinal').textContent=String(finals.length);el('asLiveInlineUpdated').textContent=time(snapshot.fetchedAt);renderSection('asLiveNowSection','asLiveNowGrid',live);renderSection('asLiveUpcomingSection','asLiveUpcomingGrid',upcoming);renderSection('asLiveFinalSection','asLiveFinalGrid',finals);el('asLiveEmpty').hidden=(live.length+upcoming.length+finals.length)>0;}
    function renderCoverage(snapshot){var rows=snapshot.coverage||[],working=rows.filter(function(row){return row.status===200;}).length;el('asLiveInlineCoverage').textContent=rows.length?working+'/'+rows.length+' sports feeds connected':'Checking feeds';var notice=el('asLiveInlineNotice');if(rows.length&&working===0){notice.hidden=false;notice.textContent='Live score feeds are temporarily unavailable. Automatic retry is on.';}else{notice.hidden=true;}}
    function schedule(){clearTimeout(state.timer);if(!state.active||document.hidden)return;var delay=state.lastLiveCount>0?30000:90000;el('asLiveInlinePoll').textContent=state.lastLiveCount>0?'Refreshes every 30s':'Refreshes every 90s';state.timer=setTimeout(function(){load(false);},delay);}
    async function api(path){var response=await fetch(path,{credentials:'same-origin',headers:{accept:'application/json'}});var body=await response.json().catch(function(){return null;});if(response.status===401){location.href='/';throw new Error('Authentication required');}if(!response.ok)throw new Error(body&&body.message||'Score request failed ('+response.status+')');return body;}
    async function load(force){if(!state.active||state.loading)return;state.loading=true;el('asLiveInlineRefresh').disabled=true;try{var snapshot=await api('/api/live'+(force?'?force=1':''));state.snapshot=snapshot;renderSports(snapshot);renderCoverage(snapshot);renderCurrent();}catch(error){var notice=el('asLiveInlineNotice');notice.hidden=false;notice.textContent=error&&error.message||'Scores could not be loaded.';el('asLiveNowSection').hidden=true;el('asLiveUpcomingSection').hidden=true;el('asLiveFinalSection').hidden=true;el('asLiveEmpty').hidden=false;el('asLiveEmpty').innerHTML='<div class="asLiveEmpty"><b>Scores temporarily unavailable</b>Oblige Props will retry automatically.</div>';}finally{state.loading=false;el('asLiveInlineRefresh').disabled=false;schedule();}}
    function fitNav(){var mobile=window.matchMedia&&window.matchMedia('(max-width:650px)').matches;var children=Array.prototype.slice.call(nav.children).filter(function(child){return !(mobile&&child.classList.contains('asNavBrand'));});if(children.length)nav.style.setProperty('grid-template-columns','repeat('+children.length+',minmax(0,1fr))','important');}
    function urlMode(live){var u=new URL(location.href);if(live)u.searchParams.set('view','live');else if(u.searchParams.get('view')==='live')u.searchParams.delete('view');history.replaceState(history.state,'',u.pathname+(u.searchParams.toString()?'?'+u.searchParams.toString():'')+u.hash);}
    function enter(){if(state.active)return;state.active=true;var selected=nav.querySelector('[data-view].on');if(selected)state.previousView=selected.dataset.view||'research';nav.querySelectorAll('[data-view]').forEach(function(button){button.classList.remove('on');button.removeAttribute('aria-current');});liveButton.classList.add('on');liveButton.setAttribute('aria-current','page');main.style.setProperty('display','none','important');panel.hidden=false;panel.style.setProperty('display','block','important');if(sportsStrip)sportsStrip.style.setProperty('display','none','important');urlMode(true);load(true);}
    function exit(){if(!state.active)return;state.active=false;clearTimeout(state.timer);liveButton.classList.remove('on');liveButton.removeAttribute('aria-current');panel.hidden=true;panel.style.removeProperty('display');main.style.removeProperty('display');if(sportsStrip)sportsStrip.style.removeProperty('display');var selected=nav.querySelector('[data-view].on');if(!selected){selected=nav.querySelector('[data-view="'+state.previousView+'"]')||nav.querySelector('[data-view="research"]');if(selected){selected.classList.add('on');selected.setAttribute('aria-current','page');}}urlMode(false);}

    liveButton.addEventListener('click',enter);
    nav.addEventListener('click',function(event){var target=event.target.closest('[data-view]');if(target&&state.active)exit();});
    el('asLiveInlineRefresh').addEventListener('click',function(){load(true);});
    el('asLiveInlineSports').addEventListener('click',function(event){var button=event.target.closest('[data-inline-live-sport]');if(!button)return;state.sport=String(button.dataset.inlineLiveSport||'').toUpperCase();renderSports(state.snapshot||{coverage:[]});renderCurrent();});
    document.addEventListener('visibilitychange',function(){if(document.hidden)clearTimeout(state.timer);else if(state.active)load(false);});
    window.addEventListener('resize',function(){setTimeout(fitNav,0);});
    fitNav();
    try{if(new URL(location.href).searchParams.get('view')==='live')enter();}catch(_){}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
`;

  return out + runtime;
}
