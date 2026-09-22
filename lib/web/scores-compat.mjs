
const STYLE = String.raw`
<style id="oblige-scores-compat-style">
#oblige-scores-compat{max-width:1100px;margin:0 auto;padding:18px 12px 90px;color:#edf3fb;font-family:Inter,system-ui,sans-serif}
#oblige-scores-compat *{box-sizing:border-box}
.osc-head{display:flex;align-items:end;justify-content:space-between;gap:14px;margin-bottom:14px}.osc-kicker{font-size:10px;font-weight:800;letter-spacing:.15em;color:#48ed9b;text-transform:uppercase}.osc-head h1{margin:4px 0 0;font-size:34px;letter-spacing:-.045em}.osc-head p{margin:5px 0 0;color:#74879c;font-size:11px}.osc-refresh{height:36px;border:1px solid #1a2d40;border-radius:10px;background:#09131f;color:#b7c5d5;padding:0 12px;font-size:11px;font-weight:700}
.osc-shell{overflow:hidden;border:1px solid #1a2d40;border-radius:14px;background:#0f1115;box-shadow:0 16px 42px rgba(0,0,0,.24)}.osc-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px;border-bottom:1px solid #202631;background:#14171d}.osc-sports{display:flex;min-width:0;gap:4px;overflow:auto;scrollbar-width:none}.osc-sports::-webkit-scrollbar{display:none}.osc-sports button,.osc-filters button{border:0;border-radius:7px;background:transparent;color:#8793a5;height:30px;padding:0 11px;font-size:10px;font-weight:800;white-space:nowrap}.osc-sports button.on,.osc-filters button.on{background:#252b35;color:#fff}.osc-filters{display:flex;flex:0 0 auto;gap:2px;padding:2px;border:1px solid #242a34;border-radius:8px;background:#090c10}.osc-filters i{display:inline-block;width:6px;height:6px;margin-right:5px;border-radius:50%;background:#ef4444}.osc-live-count{margin-left:4px;color:#f87171;font-family:ui-monospace,monospace}
.osc-rows{min-height:80px}.osc-row{display:grid;grid-template-columns:72px minmax(0,1fr) 58px minmax(0,1fr) 86px;align-items:center;min-height:48px;padding:7px 12px;border-bottom:1px solid #202631}.osc-row:last-child{border-bottom:0}.osc-status{font-size:9px;color:#8995a6;font-variant-numeric:tabular-nums}.osc-status.live{color:#ef4444;font-weight:900}.osc-status.live:before{content:"";display:inline-block;width:6px;height:6px;margin-right:5px;border-radius:50%;background:#ef4444}.osc-team{display:flex;min-width:0;align-items:center;gap:7px}.osc-team.away{justify-content:flex-end;text-align:right;padding-right:8px}.osc-team.home{justify-content:flex-start;padding-left:8px}.osc-team span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;color:#d8dee8}.osc-team.win span:last-child{color:#fff;font-weight:800}.osc-mark{display:grid;width:18px;height:18px;flex:0 0 18px;place-items:center;border-radius:50%;background:#202733;color:#98a7ba;font-size:6px;font-weight:900}.osc-score{width:54px;margin:auto;padding:4px 2px;border:1px solid #282f39;border-radius:7px;background:#090c10;text-align:center;font-family:ui-monospace,monospace;font-size:9px;font-weight:900}.osc-score.live{color:#34d399}.osc-score.pending{color:#667085}.osc-context{text-align:right;color:#66758a;font-size:7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.osc-empty,.osc-loading{padding:32px 14px;text-align:center;color:#6f7e92;font-size:11px}.osc-note{padding:7px 12px;border-top:1px solid #202631;color:#657489;text-align:right;font-size:8px}
@media(max-width:650px){#oblige-scores-compat{padding:12px 8px 86px}.osc-head h1{font-size:28px}.osc-head p{display:none}.osc-toolbar{flex-direction:column;align-items:stretch}.osc-filters{align-self:flex-start}.osc-row{grid-template-columns:58px minmax(0,1fr) 50px minmax(0,1fr);padding:8px 6px}.osc-context{display:none}.osc-team{gap:4px}.osc-team span:last-child{font-size:9px}.osc-score{width:48px;font-size:8px}}
nav[aria-label="Sections"]{width:100%!important;max-width:100vw!important;grid-template-columns:repeat(5,minmax(0,1fr))!important;overflow:hidden!important}nav[aria-label="Sections"]>a{min-width:0!important;overflow:hidden!important}
</style>
`;

const SCRIPT = String.raw`
<script id="oblige-scores-compat-script">
(function(){
  var fallback=__FALLBACK__,rendered=false,timer=null,state={sport:'NFL',filter:'all',games:[],fetchedAt:null};
  var sports=[['NFL','NFL'],['NBA','NBA'],['SOCCER','EPL'],['NHL','NHL'],['MLB','MLB']];
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]});}
  function radioIcon(){return '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px"><path d="M4.9 19.1a10 10 0 0 1 0-14.2"/><path d="M7.8 16.2a6 6 0 0 1 0-8.4"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4"/><path d="M19.1 4.9a10 10 0 0 1 0 14.2"/></svg>';}
  function ensureLink(nav,desktop){
    if(!nav)return;
    var existing=nav.querySelector('a[href="/scores"]'),inserted=false;
    if(!existing){inserted=true;
      var research=nav.querySelector('a[href="/research"]'),base=research||nav.querySelector('a[href="/board"]'),link=document.createElement('a');
      link.href='/scores';if(base)link.className=base.className;
      if(desktop)link.textContent='Scores';else link.innerHTML=radioIcon()+'<span>Scores</span>';
      if(research)nav.insertBefore(link,research);else nav.appendChild(link);existing=link;
    }
    // Only a nav this script widened needs its columns reset. The app's own nav
    // already carries Scores and sizes itself; overriding it wrapped items.
    if(!desktop&&inserted){
      nav.style.gridTemplateColumns='repeat(5,minmax(0,1fr))';nav.style.width='100%';nav.style.maxWidth='100vw';nav.style.overflow='hidden';
      Array.prototype.forEach.call(nav.children,function(child){child.style.minWidth='0';child.style.overflow='hidden';});
    }
    if(location.pathname==='/scores'){
      Array.prototype.forEach.call(nav.querySelectorAll('a[aria-current="page"]'),function(a){a.removeAttribute('aria-current');});
      existing.setAttribute('aria-current','page');
    }
  }
  function ensureNav(){ensureLink(document.querySelector('nav[aria-label="Sections"]'),false);ensureLink(document.querySelector('header nav[aria-label="Primary"]'),true);}
  function mark(team){var s=String(team||'?').replace(/[^A-Za-z0-9]/g,'').slice(0,2).toUpperCase();return '<span class="osc-mark">'+esc(s||'?')+'</span>';}
  function time(v){if(!v)return 'TBD';var d=new Date(v);return isFinite(d.getTime())?d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'TBD';}
  function stat(g){var s=String(g.status||'').toUpperCase();if(s==='FINAL')return 'FT';if(s==='LIVE')return g.providerStatus||g.periodLabel||g.clock||'LIVE';return time(g.startTime);}
  function score(v){return v!==null&&v!==undefined&&v!==''?String(v):null;}
  function win(g,side){if(String(g.status).toUpperCase()!=='FINAL')return false;var h=Number(g.homeScore),a=Number(g.awayScore);if(!isFinite(h)||!isFinite(a)||h===a)return false;return side==='home'?h>a:a>h;}
  function row(g){var live=String(g.status).toUpperCase()==='LIVE',final=String(g.status).toUpperCase()==='FINAL',as=score(g.awayScore),hs=score(g.homeScore),has=as!==null&&hs!==null,away=g.awayName||g.awayTeam||'Away',home=g.homeName||g.homeTeam||'Home',ctx=g.venue||g.broadcast||g.league||'';return '<div class="osc-row"><div class="osc-status '+(live?'live':'')+'">'+esc(stat(g))+'</div><div class="osc-team away '+(win(g,'away')?'win':'')+'"><span>'+esc(away)+'</span>'+mark(g.awayTeam||away)+'</div><div class="osc-score '+(live?'live':has?'':'pending')+'">'+(has&&(live||final)?esc(as)+' - '+esc(hs):'VS')+'</div><div class="osc-team home '+(win(g,'home')?'win':'')+'">'+mark(g.homeTeam||home)+'<span>'+esc(home)+'</span></div><div class="osc-context">'+esc(ctx)+'</div></div>';}
  function filtered(){return state.games.filter(function(g){return String(g.sport||'').toUpperCase()===state.sport;}).filter(function(g){var s=String(g.status||'').toUpperCase();if(state.filter==='live')return s==='LIVE';if(state.filter==='finished')return s==='FINAL';return true;});}
  function renderRows(){var root=document.getElementById('oblige-scores-compat');if(!root)return;var live=state.games.filter(function(g){return String(g.sport||'').toUpperCase()===state.sport&&String(g.status||'').toUpperCase()==='LIVE';}).length,count=root.querySelector('.osc-live-count');if(count)count.textContent=live?String(live):'';Array.prototype.forEach.call(root.querySelectorAll('[data-osc-filter]'),function(b){b.classList.toggle('on',b.getAttribute('data-osc-filter')===state.filter);});Array.prototype.forEach.call(root.querySelectorAll('[data-osc-sport]'),function(b){b.classList.toggle('on',b.getAttribute('data-osc-sport')===state.sport);});var rows=filtered(),box=root.querySelector('.osc-rows');if(box)box.innerHTML=rows.length?rows.map(row).join(''):'<div class="osc-empty">'+(state.filter==='live'?'No games currently in play.':'No games in this view.')+'</div>';var note=root.querySelector('.osc-note');if(note)note.textContent=state.fetchedAt?'Updated '+new Date(state.fetchedAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'Waiting for score feed';}
  function schedule(){clearTimeout(timer);var live=state.games.some(function(g){return String(g.status||'').toUpperCase()==='LIVE';});timer=setTimeout(load,live?30000:90000);}
  async function load(){try{var res=await fetch('/api/live?sports=NFL,NBA,SOCCER,NHL,MLB',{credentials:'same-origin',headers:{accept:'application/json'},cache:'no-store'}),body=await res.json();if(!res.ok)throw new Error('Scores unavailable');state.games=Array.isArray(body.games)?body.games:[];state.fetchedAt=body.fetchedAt||new Date().toISOString();renderRows();}catch(_){var box=document.querySelector('#oblige-scores-compat .osc-rows');if(box)box.innerHTML='<div class="osc-empty">Scores are temporarily unavailable. Automatic retry is on.</div>';}schedule();}
  function renderScores(){if(!fallback||rendered||location.pathname!=='/scores')return;var main=document.querySelector('main#main')||document.querySelector('main');if(!main)return;rendered=true;main.innerHTML='<div id="oblige-scores-compat"><div class="osc-head"><div><div class="osc-kicker">Live sports</div><h1>Scores</h1><p>Live, scheduled and completed games.</p></div><button class="osc-refresh" type="button">Refresh</button></div><section class="osc-shell"><div class="osc-toolbar"><div class="osc-sports">'+sports.map(function(s){return '<button type="button" data-osc-sport="'+s[0]+'">'+s[1]+'</button>';}).join('')+'</div><div class="osc-filters"><button type="button" data-osc-filter="all">All</button><button type="button" data-osc-filter="live"><i></i>Live <span class="osc-live-count"></span></button><button type="button" data-osc-filter="finished">Finished</button></div></div><div class="osc-rows"><div class="osc-loading">UPDATING FEED...</div></div><div class="osc-note">Waiting for score feed</div></section></div>';main.querySelector('.osc-refresh').addEventListener('click',load);main.querySelector('.osc-sports').addEventListener('click',function(e){var b=e.target.closest('[data-osc-sport]');if(!b)return;state.sport=b.getAttribute('data-osc-sport');renderRows();});main.querySelector('.osc-filters').addEventListener('click',function(e){var b=e.target.closest('[data-osc-filter]');if(!b)return;state.filter=b.getAttribute('data-osc-filter');renderRows();});renderRows();load();}
  function boot(){ensureNav();renderScores();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  [120,500,1400].forEach(function(ms){setTimeout(ensureNav,ms);});window.addEventListener('pageshow',ensureNav);
})();
</script>
`;

export function injectScoresCompat(html, { renderFallback = false } = {}) {
  if (!/<html[\s>]/i.test(String(html || ''))) return String(html || '');
  const script = SCRIPT.replace('__FALLBACK__', renderFallback ? 'true' : 'false');
  const injection = (renderFallback ? STYLE : '') + script;
  return String(html).includes('</body>')
    ? String(html).replace('</body>', () => injection + '</body>')
    : String(html) + injection;
}
