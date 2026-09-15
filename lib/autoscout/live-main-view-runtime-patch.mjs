export function patchLiveMainViewUi(source) {
  const out = String(source || '');
  if (!out.includes('asNav')) throw new Error('Inline Live patch could not locate the ObligeProps navigation.');

  const runtime = String.raw`
;(function obligePropsInlineLiveView(){
  var started=false;
  function boot(){
    if(started)return;
    var root=document.getElementById('as5');
    var nav=root&&root.querySelector('.asNav');
    var main=root&&root.querySelector('.asMain');
    if(!root||!nav||!main)return;
    started=true;

    var liveButton=document.createElement('button');
    liveButton.type='button';
    liveButton.id='asLiveMainTab';
    liveButton.className='asNavLive';
    liveButton.setAttribute('aria-label','Live scores and game feed');
    liveButton.innerHTML='<span class="asNavIcon" aria-hidden="true">◉</span><span>Live</span>';
    var news=nav.querySelector('.asNavNews');
    var saved=nav.querySelector('[data-view="saved"]');
    nav.insertBefore(liveButton,news||saved||null);

    var style=document.createElement('style');
    style.id='oblige-inline-live-style';
    style.textContent=[
      '#as5 #asLiveMainView[hidden]{display:none!important}',
      '#as5 .asLiveEmbedded{max-width:1380px;margin:auto;padding:14px 14px 96px}',
      '#as5 .asLiveInlineHead{display:flex;gap:14px;align-items:flex-end;margin:4px 0 12px}',
      '#as5 .asLiveInlineHead h1{margin:0;font-size:25px;letter-spacing:-.05em}',
      '#as5 .asLiveInlineHead p{margin:4px 0 0;color:#8da0bb;font-size:11px;max-width:680px}',
      '#as5 .asLiveInlineFresh{margin-left:auto;text-align:right;border:1px solid rgba(91,120,166,.34);background:linear-gradient(145deg,rgba(15,27,47,.96),rgba(5,11,23,.98));border-radius:14px;padding:9px 11px;min-width:118px}',
      '#as5 .asLiveInlineFresh span,#as5 .asLiveInlineFresh small{display:block;color:#8295b0;font-size:8px}',
      '#as5 .asLiveInlineFresh strong{display:block;font-size:15px;margin:2px 0;color:#f7fbff}',
      '#as5 .asLiveInlineStats{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:10px}',
      '#as5 .asLiveInlineStats>div{border:1px solid rgba(91,120,166,.34);background:linear-gradient(145deg,rgba(15,27,47,.96),rgba(5,11,23,.98));border-radius:14px;padding:10px 12px}',
      '#as5 .asLiveInlineStats span{display:block;color:#8295b0;font-size:8px;text-transform:uppercase;letter-spacing:.06em;font-weight:800}',
      '#as5 .asLiveInlineStats strong{display:block;font-size:18px;margin-top:2px}',
      '#as5 .asLiveInlineToolbar{display:flex;gap:8px;align-items:center;margin:0 0 12px}',
      '#as5 .asLiveInlineSports{display:flex;gap:6px;overflow-x:auto;flex:1;scrollbar-width:none}',
      '#as5 .asLiveInlineSports::-webkit-scrollbar{display:none}',
      '#as5 .asLiveInlineChip,#as5 .asLiveInlineRefresh{border:1px solid rgba(86,113,155,.38);background:linear-gradient(180deg,rgba(17,30,50,.92),rgba(9,17,30,.98));color:#aebdd2;border-radius:10px;height:34px;padding:0 11px;font-size:9px;font-weight:850;white-space:nowrap}',
      '#as5 .asLiveInlineChip.on{background:linear-gradient(145deg,rgba(72,124,255,.98),rgba(57,91,214,.92));color:#fff;border-color:rgba(106,134,255,.6)}',
      '#as5 .asLiveInlineRefresh{min-width:72px;color:#eef5ff}',
      '#as5 .asLiveInlineNotice{border:1px solid rgba(255,96,116,.35);background:rgba(88,22,36,.28);color:#ffc1ca;border-radius:12px;padding:10px 12px;margin:0 0 12px;font-size:10px}',
      '#as5 .asLiveInlineSection{margin-top:14px}',
      '#as5 .asLiveInlineTitle{display:flex;align-items:end;justify-content:space-between;gap:12px;margin-bottom:8px}',
      '#as5 .asLiveInlineTitle small{color:#8295b0;font-size:9px}',
      '#as5 .asLiveInlineTitle h2{margin:0;font-size:16px}',
      '#as5 .asLiveGameGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}',
      '#as5 .asLiveGame{border:1px solid rgba(91,120,166,.34);background:linear-gradient(145deg,rgba(15,27,47,.96),rgba(5,11,23,.98));border-radius:16px;padding:12px;box-shadow:0 14px 34px rgba(0,0,0,.22)}',
      '#as5 .asLiveGame.live{border-color:rgba(53,230,161,.42);box-shadow:0 14px 34px rgba(0,0,0,.24),inset 0 0 34px rgba(53,230,161,.035)}',
      '#as5 .asLiveGameHead,#as5 .asLiveTeamRow,#as5 .asLiveGameFoot{display:flex;align-items:center;justify-content:space-between;gap:10px}',
      '#as5 .asLiveGameHead{margin-bottom:10px}',
      '#as5 .asLiveGameState{font-size:8px;font-weight:950;letter-spacing:.08em;color:#5cf0b1}',
      '#as5 .asLiveGameMeta,#as5 .asLiveGameFoot{font-size:8px;color:#8295b0}',
      '#as5 .asLiveTeamRow{min-height:34px;border-top:1px solid rgba(83,111,155,.18)}',
      '#as5 .asLiveTeamRow:first-of-type{border-top:0}',
      '#as5 .asLiveTeamRow b{font-size:12px}',
      '#as5 .asLiveTeamRow strong{font-size:21px;font-variant-numeric:tabular-nums}',
      '#as5 .asLiveGameFoot{margin-top:8px;padding-top:8px;border-top:1px solid rgba(83,111,155,.18)}',
      '#as5 .asLivePlayerGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}',
      '#as5 .asLivePlayer{border:1px solid rgba(91,120,166,.34);background:linear-gradient(145deg,rgba(15,27,47,.96),rgba(5,11,23,.98));border-radius:16px;padding:12px}',
      '#as5 .asLivePlayerTop{display:flex;justify-content:space-between;gap:10px}',
      '#as5 .asLivePlayerTop small,#as5 .asLivePlayerTop p{color:#8295b0;font-size:8px;margin:0}',
      '#as5 .asLivePlayerTop h3{margin:3px 0;font-size:13px}',
      '#as5 .asLiveDot{font-size:8px;font-weight:950;color:#5cf0b1}',
      '#as5 .asLiveLineNow{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:9px}',
      '#as5 .asLiveLineNow>div{border:1px solid rgba(83,111,155,.25);background:rgba(5,11,23,.55);border-radius:10px;padding:8px}',
      '#as5 .asLiveLineNow span{display:block;color:#8295b0;font-size:7px;text-transform:uppercase}',
      '#as5 .asLiveLineNow strong{display:block;font-size:16px;margin-top:2px}',
      '#as5 .asLiveEmpty{grid-column:1/-1;border:1px dashed rgba(91,120,166,.34);border-radius:14px;padding:18px;color:#8295b0;font-size:10px;text-align:center}',
      '#as5 .asLiveEmpty b{display:block;color:#eef5ff;font-size:12px;margin-bottom:4px}',
      '@media(max-width:650px){#as5 .asLiveEmbedded{padding:10px 8px 88px}#as5 .asLiveInlineHead{align-items:flex-start}#as5 .asLiveInlineHead h1{font-size:21px}#as5 .asLiveInlineFresh{min-width:96px;padding:8px}#as5 .asLiveInlineStats{gap:5px}#as5 .asLiveInlineStats>div{padding:8px}#as5 .asLiveGameGrid,#as5 .asLivePlayerGrid{grid-template-columns:1fr}#as5 .asNavLive{display:grid!important;grid-template-rows:22px 13px!important;place-items:center!important}}'
    ].join('\n');
    (document.head||document.documentElement).appendChild(style);

    var panel=document.createElement('main');
    panel.id='asLiveMainView';
    panel.className='asLiveEmbedded';
    panel.hidden=true;
    panel.innerHTML=[
      '<section class="asLiveInlineHead"><div><span class="asEyebrow">LIVE CENTER</span><h1>Scores & live game feed</h1><p>Live scores, game status, and player prop progress stay inside the main ObligeProps workspace.</p></div><div class="asLiveInlineFresh"><span>Updated</span><strong id="asLiveInlineUpdated">—</strong><small id="asLiveInlinePoll">Ready</small></div></section>',
      '<section class="asLiveInlineStats"><div><span>Live now</span><strong id="asLiveInlineNow">—</strong></div><div><span>Upcoming</span><strong id="asLiveInlineUpcoming">—</strong></div><div><span>Live props</span><strong id="asLiveInlinePlayers">—</strong></div></section>',
      '<section class="asLiveInlineToolbar"><div id="asLiveInlineSports" class="asLiveInlineSports"><button class="asLiveInlineChip on" data-inline-live-sport="" type="button">All</button></div><button id="asLiveInlineRefresh" class="asLiveInlineRefresh" type="button">Refresh</button></section>',
      '<div id="asLiveInlineNotice" class="asLiveInlineNotice" hidden></div>',
      '<section class="asLiveInlineSection"><div class="asLiveInlineTitle"><div><span class="asEyebrow">SCORES</span><h2>Games</h2></div><small id="asLiveInlineCoverage">Checking feeds</small></div><div id="asLiveInlineGames" class="asLiveGameGrid"><div class="asLiveEmpty"><b>Loading live slate</b>Checking current games.</div></div></section>',
      '<section class="asLiveInlineSection"><div class="asLiveInlineTitle"><div><span class="asEyebrow">PLAYER INTELLIGENCE</span><h2>Live prop progress</h2></div><small>Line vs current stat</small></div><div id="asLiveInlinePlayerGrid" class="asLivePlayerGrid"><div class="asLiveEmpty"><b>Checking active players</b>Live player statistics appear when available.</div></div></section>'
    ].join('');
    main.insertAdjacentElement('afterend',panel);

    var sportsStrip=root.querySelector('.asSports');
    var state={active:false,sport:'',timer:null,loading:false,lastLiveCount:0,previousView:'research'};
    function el(id){return document.getElementById(id);}
    function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];});}
    function show(value){return value===null||value===undefined||value===''?'—':esc(value);}
    function time(value){if(!value)return '—';var d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):'—';}
    function gameStatus(game){
      if(game.status==='LIVE'){var parts=[];if(game.inningHalf)parts.push(game.inningHalf);if(game.periodLabel)parts.push('Period '+game.periodLabel);if(game.clock)parts.push(game.clock);return parts.join(' · ')||'In progress';}
      if(game.status==='FINAL')return 'Final';
      if(game.status==='SCHEDULED')return time(game.startTime);
      return game.providerStatus||'Status unavailable';
    }
    function gameHtml(game){var live=game.status==='LIVE';return '<article class="asLiveGame '+(live?'live':'')+'"><div class="asLiveGameHead"><span class="asLiveGameState">'+esc(live?'LIVE':game.status||'GAME')+'</span><span class="asLiveGameMeta">'+esc(game.sport||'')+' · '+esc(gameStatus(game))+'</span></div><div class="asLiveTeamRow"><b>'+show(game.awayTeam)+'</b><strong>'+show(game.awayScore)+'</strong></div><div class="asLiveTeamRow"><b>'+show(game.homeTeam)+' <small>HOME</small></b><strong>'+show(game.homeScore)+'</strong></div><div class="asLiveGameFoot"><span>'+(game.possession?'Possession '+esc(game.possession):'Live scoreboard')+'</span><span>'+(game.updatedAt?'Updated '+esc(time(game.updatedAt)):'')+'</span></div></article>';}
    function playerHtml(prop){var current=prop.liveStat,line=prop.line;return '<article class="asLivePlayer"><div class="asLivePlayerTop"><div><small>'+esc(prop.sport||'')+' · '+esc(prop.market||'Prop')+'</small><h3>'+esc(prop.playerName||'Player')+'</h3><p>'+(prop.team?esc(prop.team):'Team —')+(prop.opponent?' · vs '+esc(prop.opponent):'')+'</p></div><span class="asLiveDot">LIVE</span></div><div class="asLiveLineNow"><div><span>Prop line</span><strong>'+show(line)+'</strong></div><div><span>Current</span><strong>'+show(current)+'</strong></div></div></article>';}
    async function api(path){var response=await fetch(path,{credentials:'same-origin',headers:{accept:'application/json'}});var body=await response.json().catch(function(){return null;});if(response.status===401){location.href='/';throw new Error('Authentication required');}if(!response.ok)throw new Error(body&&body.message||'Live request failed ('+response.status+')');return body;}
    function renderSports(snapshot){
      var seen={};var sports=[];
      (snapshot.coverage||[]).forEach(function(row){var s=String(row.sport||'').toUpperCase();if(s&&row.recordCount>0&&!seen[s]){seen[s]=1;sports.push(s);}});
      ['live','upcoming','final'].forEach(function(key){(snapshot[key]||[]).forEach(function(game){var s=String(game.sport||'').toUpperCase();if(s&&!seen[s]){seen[s]=1;sports.push(s);}});});
      sports.sort();
      el('asLiveInlineSports').innerHTML='<button class="asLiveInlineChip '+(!state.sport?'on':'')+'" data-inline-live-sport="" type="button">All</button>'+sports.map(function(s){return '<button class="asLiveInlineChip '+(state.sport===s?'on':'')+'" data-inline-live-sport="'+esc(s)+'" type="button">'+esc(s)+'</button>';}).join('');
    }
    function schedule(){clearTimeout(state.timer);if(!state.active||document.hidden)return;var delay=state.lastLiveCount>0?15000:60000;el('asLiveInlinePoll').textContent=state.lastLiveCount>0?'Refreshes every 15s':'Refreshes every 60s';state.timer=setTimeout(function(){load(false);},delay);}
    async function load(force){
      if(!state.active||state.loading)return;state.loading=true;el('asLiveInlineRefresh').disabled=true;
      try{
        var q=new URLSearchParams();if(state.sport)q.set('sports',state.sport);if(force)q.set('force','1');var suffix=q.toString()?'?'+q.toString():'';
        var result=await Promise.all([api('/api/live'+suffix),api('/api/live/players'+(state.sport?'?sports='+encodeURIComponent(state.sport):'')).catch(function(){return {props:[]};})]);
        var games=result[0],players=result[1],live=games.live||[],upcoming=games.upcoming||[],finals=games.final||[],props=players.props||[];state.lastLiveCount=live.length;
        el('asLiveInlineNow').textContent=String(live.length);el('asLiveInlineUpcoming').textContent=String(upcoming.length);el('asLiveInlinePlayers').textContent=String(props.length);el('asLiveInlineUpdated').textContent=time(games.fetchedAt);renderSports(games);
        var coverage=games.coverage||[],working=coverage.filter(function(row){return row.status===200;}).length,limited=coverage.length-working;el('asLiveInlineCoverage').textContent=working+' feeds active'+(limited?' · '+limited+' limited':'');
        var slate=live.concat(upcoming,finals).slice(0,80);el('asLiveInlineGames').innerHTML=slate.length?slate.map(gameHtml).join(''):'<div class="asLiveEmpty"><b>No games on this slate</b>No live or scheduled games are available for this filter right now.</div>';
        el('asLiveInlinePlayerGrid').innerHTML=props.length?props.map(playerHtml).join(''):'<div class="asLiveEmpty"><b>No live prop progress yet</b>Player line-vs-current data appears when an active game and supported stat feed overlap.</div>';
        el('asLiveInlineNotice').hidden=!(coverage.length&&working===0);if(!el('asLiveInlineNotice').hidden)el('asLiveInlineNotice').textContent='Live score feeds are temporarily unavailable for the selected sports.';
      }catch(error){el('asLiveInlineNotice').hidden=false;el('asLiveInlineNotice').textContent=error&&error.message||'Live data could not be loaded.';el('asLiveInlineGames').innerHTML='<div class="asLiveEmpty"><b>Live data unavailable</b>ObligeProps will retry automatically.</div>';}
      finally{state.loading=false;el('asLiveInlineRefresh').disabled=false;schedule();}
    }
    function fitNav(){
      var mobile=window.matchMedia&&window.matchMedia('(max-width:650px)').matches;
      var children=Array.prototype.slice.call(nav.children).filter(function(child){return !(mobile&&child.classList.contains('asNavBrand'));});
      if(children.length)nav.style.setProperty('grid-template-columns','repeat('+children.length+',minmax(0,1fr))','important');
    }
    function urlMode(live){var u=new URL(location.href);if(live)u.searchParams.set('view','live');else if(u.searchParams.get('view')==='live')u.searchParams.delete('view');history.replaceState(history.state,'',u.pathname+(u.searchParams.toString()?'?'+u.searchParams.toString():'')+u.hash);}
    function enter(){
      if(state.active)return;state.active=true;var selected=nav.querySelector('[data-view].on');if(selected)state.previousView=selected.dataset.view||'research';nav.querySelectorAll('[data-view]').forEach(function(button){button.classList.remove('on');button.removeAttribute('aria-current');});liveButton.classList.add('on');liveButton.setAttribute('aria-current','page');main.style.setProperty('display','none','important');panel.hidden=false;panel.style.setProperty('display','block','important');if(sportsStrip)sportsStrip.style.setProperty('display','none','important');urlMode(true);load(true);
    }
    function exit(){
      if(!state.active)return;state.active=false;clearTimeout(state.timer);liveButton.classList.remove('on');liveButton.removeAttribute('aria-current');panel.hidden=true;panel.style.removeProperty('display');main.style.removeProperty('display');if(sportsStrip)sportsStrip.style.removeProperty('display');var selected=nav.querySelector('[data-view].on');if(!selected){selected=nav.querySelector('[data-view="'+state.previousView+'"]')||nav.querySelector('[data-view="research"]');if(selected){selected.classList.add('on');selected.setAttribute('aria-current','page');}}urlMode(false);
    }
    liveButton.addEventListener('click',enter);
    nav.addEventListener('click',function(event){var target=event.target.closest('[data-view]');if(target&&state.active)exit();});
    el('asLiveInlineRefresh').addEventListener('click',function(){load(true);});
    el('asLiveInlineSports').addEventListener('click',function(event){var button=event.target.closest('[data-inline-live-sport]');if(!button)return;state.sport=String(button.dataset.inlineLiveSport||'').toUpperCase();load(true);});
    document.addEventListener('visibilitychange',function(){if(document.hidden)clearTimeout(state.timer);else if(state.active)load(false);});
    window.addEventListener('resize',function(){setTimeout(fitNav,0);});
    fitNav();setTimeout(fitNav,50);setTimeout(fitNav,300);
    if(new URL(location.href).searchParams.get('view')==='live')setTimeout(enter,0);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  boot();
  var observer=new MutationObserver(function(){boot();if(started)observer.disconnect();});
  observer.observe(document.documentElement,{childList:true,subtree:true});
})();
`;

  return out + '\n' + runtime;
}
