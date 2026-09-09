import { sportsDataIoPropBoard } from '../lib/data-sources/sportsdataio/prop-board.mjs';

const SPORTS = ['NFL','NBA','MLB','NHL','WNBA','NCAAF','NCAAB'];

function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, max-age=0',
    'content-length': Buffer.byteLength(body),
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

function page() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#07101b"><title>Apex Props</title><style>
:root{--bg:#050914;--panel:#0a1221;--panel2:#0d1728;--line:#1d2940;--text:#f7f9fc;--muted:#8d9ab3;--green:#50e6a5;--blue:#67a6ff;--red:#ff7686;--amber:#ffc857}*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:radial-gradient(900px 480px at 15% -10%,#17325e55,transparent),var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select{font:inherit}.shell{min-height:100vh}.top{position:sticky;top:0;z-index:20;background:#050914e8;backdrop-filter:blur(18px);border-bottom:1px solid var(--line)}.topin,.content{max-width:1500px;margin:auto}.topin{padding:14px 18px 10px}.bar{display:flex;align-items:center;gap:10px}.brand{font-size:22px;font-weight:950;letter-spacing:-.045em}.brand span{color:var(--green)}.badge{font-size:10px;font-weight:900;letter-spacing:.08em;color:var(--green);border:1px solid #245d4b;background:#0c2920;padding:5px 7px;border-radius:999px}.grow{flex:1}.toggle{display:flex;border:1px solid var(--line);background:#09111f;border-radius:10px;padding:3px}.toggle button{border:0;background:transparent;color:var(--muted);padding:6px 9px;border-radius:7px;font-size:12px;font-weight:900}.toggle button.on{background:#1a2a46;color:#fff}.refresh{border:0;border-radius:10px;background:var(--green);color:#05110d;padding:9px 12px;font-weight:900}.sports{display:flex;gap:7px;overflow:auto;padding-top:11px;scrollbar-width:none}.sports::-webkit-scrollbar{display:none}.sport{white-space:nowrap;border:1px solid var(--line);background:#09111f;color:#aab5c9;border-radius:10px;padding:8px 11px;font-weight:800}.sport.on{background:#162640;color:#fff;border-color:#3b5c8d}.content{padding:14px 18px 90px}.filters{display:grid;grid-template-columns:minmax(240px,1.5fr) repeat(3,minmax(130px,.5fr));gap:9px;margin-bottom:12px}.control{width:100%;border:1px solid var(--line);background:#09111f;color:#fff;border-radius:11px;padding:11px 12px;outline:none}.control:focus{border-color:#426497}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-bottom:12px}.stat{border:1px solid var(--line);background:linear-gradient(180deg,#0d1728,#09111e);border-radius:14px;padding:13px}.stat small{display:block;color:var(--muted);font-size:11px;margin-bottom:3px}.stat strong{font-size:19px}.notice{display:none;border:1px solid #6c3440;background:#2b1118;color:#ffb4bd;border-radius:12px;padding:12px 14px;margin-bottom:12px}.notice.show{display:block}.table{border:1px solid var(--line);background:#08101d;border-radius:16px;overflow:hidden}.head,.row{display:grid;grid-template-columns:minmax(190px,1.3fr) minmax(180px,1.25fr) 84px 80px 110px 120px 125px;align-items:center}.head{padding:10px 14px;background:#0f1a2d;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;font-size:10px;font-weight:900}.row{padding:12px 14px;border-top:1px solid #172238;min-height:65px}.row:hover{background:#0e192a}.player{font-weight:900}.muted{color:var(--muted);font-size:11px;margin-top:3px}.market{font-weight:780}.side{display:inline-block;width:max-content;font-size:10px;font-weight:950;text-transform:uppercase;border-radius:8px;padding:5px 7px}.over{color:var(--green);background:#113127}.under{color:#ff9aa6;background:#351820}.lineval{font-size:18px;font-weight:950}.edge{font-weight:900}.edge.pos{color:var(--green)}.edge.neg{color:var(--red)}.book{font-size:12px;font-weight:750}.empty{text-align:center;padding:52px 18px;color:var(--muted)}.loading{opacity:.5;pointer-events:none}.foot{color:#71809b;font-size:10px;line-height:1.5;padding:11px 3px}.bottom{display:none}@media(max-width:900px){.filters{grid-template-columns:1fr 1fr}.filters .search{grid-column:1/-1}.stats{grid-template-columns:1fr 1fr}.head{display:none}.table{border:0;background:transparent}.row{grid-template-columns:1fr auto auto;gap:8px;border:1px solid var(--line);border-radius:14px;background:#0a1322;margin-bottom:9px}.row>div:nth-child(2){grid-column:1/2}.row>div:nth-child(6){grid-column:1/2}.bottom{position:fixed;display:flex;left:0;right:0;bottom:0;z-index:30;justify-content:space-around;background:#060c17ee;backdrop-filter:blur(18px);border-top:1px solid var(--line);padding:8px 8px calc(8px + env(safe-area-inset-bottom))}.bottom div{font-size:10px;color:#8996ad;text-align:center}.bottom b{display:block;color:#fff;font-size:17px}.content,.topin{padding-left:12px;padding-right:12px}.brand{font-size:20px}}@media(max-width:560px){.grow{display:none}.stats strong{font-size:17px}.row{grid-template-columns:1fr auto}.row>div:nth-child(2),.row>div:nth-child(6){grid-column:1/-1}.row>div:nth-child(7){font-size:11px}.toggle{margin-left:auto}}
</style></head><body><div class="shell"><header class="top"><div class="topin"><div class="bar"><div class="brand">APEX <span>PROPS</span></div><span class="badge">PRODUCTION</span><div class="grow"></div><div class="toggle"><button id="raw" class="on">RAW</button><button id="smart">SMART</button></div><button id="refresh" class="refresh">Refresh</button></div><div id="sports" class="sports"></div></div></header><main class="content"><section class="filters"><input id="search" class="control search" placeholder="Search player, team, market or sportsbook"><select id="side" class="control"><option value="all">All sides</option><option value="OVER">Over</option><option value="UNDER">Under</option></select><select id="book" class="control"><option value="all">All sportsbooks</option></select><select id="availability" class="control"><option value="all">All current lines</option><option value="consensus">Consensus only</option><option value="books">Named books only</option></select></section><section class="stats"><div class="stat"><small>Visible props</small><strong id="count">—</strong></div><div class="stat"><small>Games scanned</small><strong id="games">—</strong></div><div class="stat"><small>Sportsbooks</small><strong id="books">—</strong></div><div class="stat"><small>Provider update</small><strong id="updated">—</strong></div></section><div id="notice" class="notice"></div><section class="table"><div class="head"><div>Player</div><div>Market</div><div>Side</div><div>Line</div><div>Market edge</div><div>Sportsbook</div><div>Game</div></div><div id="rows"><div class="empty">Loading the live SportsDataIO board…</div></div></section><div class="foot">Market edge compares a posted line with the median current line for the same player, market and side across the returned books. It is market-comparison information, not a guarantee or recommendation.</div></main><nav class="bottom"><div><b>⌁</b>Props</div><div><b>◉</b>Live</div><div><b>＋</b>Picks</div><div><b>⌕</b>Search</div></nav></div><script>
const SPORT_LIST=${JSON.stringify(SPORTS)};let sport='NFL',rows=[],meta={},smart=false;const $=id=>document.getElementById(id);const esc=v=>String(v??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));function median(a){const b=a.filter(Number.isFinite).sort((x,y)=>x-y);if(!b.length)return null;const m=Math.floor(b.length/2);return b.length%2?b[m]:(b[m-1]+b[m])/2}function tabs(){$('sports').innerHTML=SPORT_LIST.map(s=>'<button class="sport '+(s===sport?'on':'')+'" data-s="'+s+'">'+s+'</button>').join('');document.querySelectorAll('[data-s]').forEach(b=>b.onclick=()=>{sport=b.dataset.s;tabs();load()})}function enriched(input){const g=new Map;for(const p of input){const k=[p.playerName,p.market,p.side].join('|').toLowerCase();if(!g.has(k))g.set(k,[]);if(Number.isFinite(p.line))g.get(k).push(p.line)}return input.map(p=>{const m=median(g.get([p.playerName,p.market,p.side].join('|').toLowerCase())||[]);return {...p,consensus:m,edge:Number.isFinite(p.line)&&Number.isFinite(m)?p.line-m:null}})}function render(){let list=enriched(rows);const q=$('search').value.trim().toLowerCase(),side=$('side').value,book=$('book').value,a=$('availability').value;list=list.filter(p=>(!q||[p.playerName,p.team,p.market,p.sportsbook,p.homeTeam,p.awayTeam].some(x=>String(x||'').toLowerCase().includes(q)))&&(side==='all'||p.side===side)&&(book==='all'||p.sportsbook===book)&&(a==='all'||(a==='consensus'&&p.consensusSource)||(a==='books'&&!p.consensusSource)));if(smart)list.sort((a,b)=>Math.abs(b.edge||0)-Math.abs(a.edge||0));$('count').textContent=list.length.toLocaleString();const bs=[...new Set(rows.map(x=>x.sportsbook).filter(Boolean))];$('books').textContent=bs.length;$('games').textContent=meta.gamesScanned??'—';$('updated').textContent=meta.fetchedAt?new Date(meta.fetchedAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'—';$('rows').innerHTML=list.length?list.map(p=>{const e=Number.isFinite(p.edge)?p.edge:null,edge=e===null?'—':(e>0?'+':'')+e.toFixed(1),game=[p.awayTeam,p.homeTeam].filter(Boolean).join(' @ ')||p.gameId||'—';return '<div class="row"><div><div class="player">'+esc(p.playerName||'Player')+'</div><div class="muted">'+esc(p.team||p.sport)+'</div></div><div><div class="market">'+esc(p.market)+'</div><div class="muted">Median '+(Number.isFinite(p.consensus)?esc(p.consensus):'—')+'</div></div><div><span class="side '+p.side.toLowerCase()+'">'+esc(p.side)+'</span></div><div class="lineval">'+esc(p.line)+'</div><div class="edge '+(e>0?'pos':e<0?'neg':'')+'">'+edge+'</div><div class="book">'+esc(p.sportsbook)+'</div><div class="muted">'+esc(game)+'</div></div>'}).join(''):'<div class="empty">No current props match these filters.</div>'}async function load(){document.body.classList.add('loading');$('notice').className='notice';try{const r=await fetch('/api/apex/props?sport='+encodeURIComponent(sport));const j=await r.json();if(!r.ok)throw new Error(j.error||'Provider request failed');rows=j.props||[];meta=j.meta||{};const bs=[...new Set(rows.map(x=>x.sportsbook).filter(Boolean))].sort();const cur=$('book').value;$('book').innerHTML='<option value="all">All sportsbooks</option>'+bs.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join('');if(bs.includes(cur))$('book').value=cur;if(meta.warning){$('notice').textContent=meta.warning;$('notice').className='notice show'}render()}catch(e){rows=[];meta={};$('notice').textContent=e.message;$('notice').className='notice show';render()}finally{document.body.classList.remove('loading')}}['search','side','book','availability'].forEach(id=>$(id).addEventListener(id==='search'?'input':'change',render));$('refresh').onclick=load;$('raw').onclick=()=>{smart=false;$('raw').className='on';$('smart').className='';render()};$('smart').onclick=()=>{smart=true;$('smart').className='on';$('raw').className='';render()};tabs();load();setInterval(load,30000);
</script></body></html>`;
}

function propsFromBoard(board, sport) {
  return (board?.offers || []).map((offer, i) => ({
    id: [sport, offer.gameId, offer.bettingMarketId, offer.bettingOutcomeId, offer.sportsbookKey, i].filter(Boolean).join(':'),
    sport: offer.sport || sport,
    playerName: offer.playerName || null,
    playerId: offer.playerId ?? null,
    team: offer.team || null,
    market: offer.market || 'Player Prop',
    side: offer.side || 'OVER',
    line: Number.isFinite(Number(offer.line)) ? Number(offer.line) : null,
    sportsbook: offer.sportsbook || (offer.consensus ? 'Consensus' : 'SportsDataIO'),
    consensusSource: Boolean(offer.consensus),
    gameId: offer.gameId ?? null,
    gameStartTime: offer.gameStartTime ?? null,
    homeTeam: offer.homeTeam || null,
    awayTeam: offer.awayTeam || null,
    updatedAt: offer.updatedAt ?? null,
  })).filter((p) => p.playerName && p.market && p.line !== null && (p.side === 'OVER' || p.side === 'UNDER'));
}

export async function handleApexRequest(req, res, url) {
  const pathname = url.pathname;
  if (pathname === '/apex' || pathname === '/apex/') {
    const body = page();
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(body),
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin',
      'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'",
    });
    res.end(body);
    return true;
  }
  if (pathname === '/api/apex/health' && req.method === 'GET') {
    return json(res, 200, { ok: true, app: 'apex-props', provider: 'SportsDataIO', keyConfigured: Boolean(process.env.SPORTSDATAIO_API_KEY), time: new Date().toISOString() }), true;
  }
  if (pathname === '/api/apex/props' && req.method === 'GET') {
    const sport = String(url.searchParams.get('sport') || 'NFL').toUpperCase();
    if (!SPORTS.includes(sport)) return json(res, 400, { ok: false, error: 'Unsupported sport.' }), true;
    try {
      const board = await sportsDataIoPropBoard.fetchBoard({ sports: [sport], force: url.searchParams.get('force') === '1' });
      const coverage = Array.isArray(board?.coverage) ? board.coverage : [];
      const c = coverage[0] || {};
      const props = propsFromBoard(board, sport);
      return json(res, 200, {
        ok: true,
        props,
        meta: {
          sport,
          provider: 'SportsDataIO',
          fetchedAt: board?.fetchedAt || new Date().toISOString(),
          latencyMs: board?.latencyMs ?? null,
          gamesScanned: c.gamesChecked ?? 0,
          propCount: props.length,
          status: c.status ?? 0,
          warning: c.errorType && !props.length ? `SportsDataIO ${sport} feed: ${c.errorType}` : null,
        },
      }), true;
    } catch (error) {
      console.error('[Apex Props] provider request failed', error?.message || error);
      return json(res, 503, { ok: false, error: 'SportsDataIO is temporarily unavailable for this board.', props: [] }), true;
    }
  }
  return false;
}
