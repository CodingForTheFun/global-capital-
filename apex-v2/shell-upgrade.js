(function(){
  'use strict';

  var nativeFetch = window.fetch.bind(window);
  var latestPayload = null;
  window.fetch = function(input, init){
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/api/props') === 0) url = '/api/apex/props' + url.slice('/api/props'.length);
    var request = typeof input === 'string' ? url : input;
    return nativeFetch(request, init).then(function(response){
      if (url.indexOf('/api/apex/props') === 0 && response && response.ok) {
        response.clone().json().then(function(data){ latestPayload = data; updateProviderStatus(); }).catch(function(){});
      }
      return response;
    });
  };

  var watch = new Set(JSON.parse(localStorage.getItem('apex-market-watch-v1') || '[]'));
  var pref = JSON.parse(localStorage.getItem('apex-market-ui-v1') || '{}');
  var currentPage = pageFromPath();
  var observerTimer = null;

  function pageFromPath(){
    var p = location.pathname.toLowerCase();
    if (p.indexOf('/live') >= 0) return 'live';
    if (p.indexOf('/watch') >= 0) return 'watch';
    if (p.indexOf('/search') >= 0) return 'search';
    return 'props';
  }
  function esc(v){ return String(v == null ? '' : v).replace(/[&<>\"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c];}); }
  function saveWatch(){ localStorage.setItem('apex-market-watch-v1', JSON.stringify(Array.from(watch))); }
  function savePrefs(){ localStorage.setItem('apex-market-ui-v1', JSON.stringify(pref)); }
  function rowKey(row){
    var player = row.querySelector('.player');
    var market = row.querySelector('.market');
    return ((player && player.textContent) || '').trim().toLowerCase() + '|' + ((market && market.textContent) || '').trim().toLowerCase();
  }
  function closeOverlay(id){ var x=document.getElementById(id); if(x) x.classList.remove('apx-open'); document.body.style.overflow=''; }
  function closeAll(){ closeOverlay('apxMenu'); closeOverlay('apxSettings'); }

  function injectStyle(){
    var style=document.createElement('style');
    style.textContent='.apxTopAction{height:38px;min-width:38px;border:1px solid var(--line,#22324a);background:#0d1827;color:#eaf2fb;border-radius:11px;padding:0 11px;font-weight:850;cursor:pointer;transition:.18s}.apxTopAction:hover{border-color:#456486;background:#132238}.apxDeskNav{display:flex;gap:4px;margin-left:12px}.apxDeskNav button{border:0;background:transparent;color:#8fa0b8;border-radius:9px;padding:8px 10px;font-size:12px;font-weight:900;cursor:pointer}.apxDeskNav button.apx-on,.apxDeskNav button:hover{background:#17283f;color:#fff}.apxOverlay{position:fixed;inset:0;z-index:150;background:rgba(2,7,13,.66);backdrop-filter:blur(6px);opacity:0;pointer-events:none;transition:.2s}.apxOverlay.apx-open{opacity:1;pointer-events:auto}.apxSheet{position:absolute;right:0;top:0;width:min(460px,100%);height:100%;overflow:auto;background:#091421;border-left:1px solid #22324a;box-shadow:-24px 0 80px rgba(0,0,0,.36);transform:translateX(102%);transition:.25s cubic-bezier(.2,.8,.2,1)}.apx-open .apxSheet{transform:none}.apxSheetHead{position:sticky;top:0;z-index:2;background:rgba(9,20,33,.95);backdrop-filter:blur(18px);border-bottom:1px solid #22324a;padding:17px}.apxSheetHead h2{margin:0;font-size:20px;letter-spacing:-.04em}.apxSheetHead p{margin:5px 42px 0 0;color:#8fa0b8;font-size:11px}.apxX{position:absolute;right:14px;top:14px;width:36px;height:36px;border:1px solid #22324a;background:#111e31;color:#fff;border-radius:10px;cursor:pointer}.apxSheetBody{padding:14px 16px 28px}.apxCard{border:1px solid #22324a;background:#0d1828;border-radius:13px;padding:13px;margin-bottom:9px}.apxCard h3{margin:0 0 5px;font-size:13px}.apxCard p{margin:0;color:#8fa0b8;font-size:11px;line-height:1.55}.apxMenuButton{display:flex;width:100%;align-items:center;justify-content:space-between;border:1px solid #22324a;background:#101d30;color:#f4f7fb;border-radius:11px;padding:12px;margin:0 0 7px;cursor:pointer;font-weight:850}.apxMenuButton.apx-on{border-color:#486a92;background:#152945}.apxToggleRow{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid rgba(34,50,74,.72)}.apxToggleRow:last-child{border-bottom:0}.apxToggleRow b{font-size:12px}.apxToggleRow small{display:block;color:#8fa0b8;font-size:10px;margin-top:3px}.apxSwitch{width:44px;height:24px;border-radius:999px;border:1px solid #2b3d59;background:#102033;position:relative;cursor:pointer}.apxSwitch:after{content:"";position:absolute;left:2px;top:2px;width:18px;height:18px;border-radius:50%;background:#8094ac;transition:.18s}.apxSwitch.apx-on{background:#153c31;border-color:#2a6650}.apxSwitch.apx-on:after{left:22px;background:#35e0a1}.apxPageBanner{max-width:1580px;margin:12px auto 0;padding:0 20px}.apxPageBanner>div{display:flex;align-items:center;gap:12px;border:1px solid #22324a;background:linear-gradient(180deg,#101f32,#0b1726);border-radius:14px;padding:13px 15px}.apxPageBanner h1{margin:0;font-size:18px;letter-spacing:-.03em}.apxPageBanner p{margin:3px 0 0;color:#8fa0b8;font-size:10px}.apxWatch{position:absolute;right:8px;top:50%;transform:translateY(-50%);width:31px;height:31px;border:1px solid transparent;background:transparent;color:#657b97;border-radius:9px;cursor:pointer;font-size:16px;z-index:4}.apxWatch.apx-on{color:#ffd15f;background:#2b2515;border-color:#5c4d21}.apxProviderBadge{display:inline-flex;align-items:center;gap:5px;color:#a9f1d3}.apxProviderBadge:before{content:"";width:6px;height:6px;border-radius:50%;background:#35e0a1}.apxHidden{display:none!important}.apxBottomOn{color:#fff!important}.apxBottomOn b{color:#35e0a1!important}@media(max-width:1050px){.apxDeskNav{display:none}}@media(max-width:720px){.apxPageBanner{padding:0 12px}.apxTopAction{padding:0;width:36px;min-width:36px}}';
    document.head.appendChild(style);
  }

  function buildOverlay(id,title,subtitle){
    var root=document.createElement('div'); root.id=id; root.className='apxOverlay';
    root.innerHTML='<aside class="apxSheet"><div class="apxSheetHead"><button class="apxX">×</button><h2>'+esc(title)+'</h2><p>'+esc(subtitle)+'</p></div><div class="apxSheetBody"></div></aside>';
    root.addEventListener('click',function(e){if(e.target===root)closeOverlay(id);});
    root.querySelector('.apxX').onclick=function(){closeOverlay(id);};
    document.body.appendChild(root); return root;
  }

  function navItems(){ return [{id:'props',label:'Prop Board',icon:'⌁'},{id:'live',label:'Live Games',icon:'◉'},{id:'watch',label:'Watchlist',icon:'★'},{id:'search',label:'Search',icon:'⌕'}]; }
  function setPage(page,push){
    currentPage=page||'props';
    if(push!==false){var path='/apex'+(currentPage==='props'?'':'/'+currentPage);if(location.pathname!==path)history.pushState({page:currentPage},'',path);}
    updateNavigation(); applyPage();
    if(currentPage==='search'){var s=document.getElementById('search');if(s)setTimeout(function(){s.focus();},50);}
  }

  function updateNavigation(){
    document.querySelectorAll('[data-apx-page]').forEach(function(btn){btn.classList.toggle('apx-on',btn.dataset.apxPage===currentPage);});
    var bottom=document.querySelector('.bottom'); if(bottom){Array.from(bottom.children).forEach(function(btn,i){btn.classList.toggle('apxBottomOn',navItems()[i]&&navItems()[i].id===currentPage);});}
    var banner=document.getElementById('apxBanner'); if(!banner)return;
    var copy={props:['Prop Board','Compare player lines across the books and DFS apps returned by The Odds API.'],live:['Live Games','Only player markets for games currently in progress.'],watch:['Watchlist','Saved player and market combinations on this device.'],search:['Market Search','Search the current sport by player, team, market or sportsbook.']}[currentPage];
    banner.innerHTML='<div><div><h1>'+copy[0]+'</h1><p>'+copy[1]+'</p></div></div>';
    banner.style.display=currentPage==='props'?'none':'';
  }

  function decorateRows(){
    document.querySelectorAll('.proprow').forEach(function(row){
      if(!row.querySelector('.apxWatch')){
        var star=document.createElement('button');star.className='apxWatch';star.textContent='★';star.setAttribute('aria-label','Add to watchlist');
        star.onclick=function(e){e.stopPropagation();var k=rowKey(row);if(watch.has(k))watch.delete(k);else watch.add(k);saveWatch();decorateRows();applyPage();};
        row.appendChild(star);
      }
      var k=rowKey(row),star=row.querySelector('.apxWatch');if(star)star.classList.toggle('apx-on',watch.has(k));
    });
  }

  function applyPage(){
    decorateRows();
    var rows=document.querySelectorAll('.proprow');
    rows.forEach(function(row){
      var show=true;
      if(currentPage==='live') show=!!row.querySelector('.status.live');
      if(currentPage==='watch') show=watch.has(rowKey(row));
      row.classList.toggle('apxHidden',!show);
    });
    var visible=Array.from(rows).filter(function(r){return !r.classList.contains('apxHidden');}).length;
    var old=document.getElementById('apxPageEmpty');if(old)old.remove();
    if(currentPage==='watch'&&rows.length&&visible===0){
      var box=document.createElement('div');box.id='apxPageEmpty';box.className='empty';box.innerHTML='<strong style="color:#fff">Watchlist empty</strong><br>Tap ★ on any prop to save it here.';document.getElementById('rows').appendChild(box);
    }
    if(currentPage==='search'){var s=document.getElementById('search'); if(s&&s.value==='') rows.forEach(function(r){r.classList.add('apxHidden');});}
  }

  function updateProviderStatus(){
    var p=document.getElementById('provider');if(!p||!latestPayload)return;
    var meta=latestPayload.meta||{};var quota=meta.quota||{};
    p.innerHTML='<span class="apxProviderBadge">'+esc(meta.provider||'The Odds API')+'</span>'+(meta.events!=null?' · '+esc(meta.events)+' events':'')+(quota.remaining!=null?' · '+esc(quota.remaining)+' API credits left':'');
  }

  function openMenu(){
    var menu=document.getElementById('apxMenu'),body=menu.querySelector('.apxSheetBody'),meta=(latestPayload&&latestPayload.meta)||{},quota=meta.quota||{};
    body.innerHTML='<div class="apxCard"><h3>Market data</h3><p><b>'+esc(meta.provider||'The Odds API')+'</b><br>'+esc(meta.propCount||0)+' lines · '+esc(meta.sportsbookCount||0)+' books'+(quota.remaining!=null?' · '+esc(quota.remaining)+' credits left':'')+'</p></div>'+navItems().map(function(x){return '<button class="apxMenuButton '+(x.id===currentPage?'apx-on':'')+'" data-menu-page="'+x.id+'"><span>'+x.icon+' &nbsp; '+x.label+'</span><span>›</span></button>';}).join('')+'<button class="apxMenuButton" id="apxOpenSettings"><span>⚙ &nbsp; Settings</span><span>›</span></button><div class="apxCard" style="margin-top:12px"><h3>Apex Market</h3><p>Production prop comparison interface. Regular lines only. Your provider key remains server-side.</p></div>';
    body.querySelectorAll('[data-menu-page]').forEach(function(b){b.onclick=function(){closeOverlay('apxMenu');setPage(b.dataset.menuPage);};});
    document.getElementById('apxOpenSettings').onclick=function(){closeOverlay('apxMenu');openSettings();};
    menu.classList.add('apx-open');document.body.style.overflow='hidden';
  }

  function openSettings(){
    var root=document.getElementById('apxSettings'),body=root.querySelector('.apxSheetBody');
    body.innerHTML='<div class="apxCard"><h3>Board preferences</h3><div class="apxToggleRow"><div><b>Compact rows</b><small>Fit more props on screen.</small></div><button id="apxCompact" class="apxSwitch '+(pref.compact?'apx-on':'')+'"></button></div><div class="apxToggleRow"><div><b>Regular lines only</b><small>Alternate, goblin/demon and milestone markets stay excluded.</small></div><button class="apxSwitch apx-on" disabled></button></div><div class="apxToggleRow"><div><b>Remember watchlist</b><small>Saved locally on this device.</small></div><button class="apxSwitch apx-on" disabled></button></div></div><div class="apxCard"><h3>Data provider</h3><p>The Odds API is the primary Apex feed. API quota, caching and normalization are handled on the server.</p></div>';
    document.getElementById('apxCompact').onclick=function(){pref.compact=!pref.compact;savePrefs();var density=document.getElementById('density');if(density)density.click();this.classList.toggle('apx-on',pref.compact);};
    root.classList.add('apx-open');document.body.style.overflow='hidden';
  }

  function install(){
    injectStyle();
    var row=document.querySelector('.brandrow');
    if(row){
      var brand=row.querySelector('.logo');
      var nav=document.createElement('nav');nav.className='apxDeskNav';nav.innerHTML=navItems().map(function(x){return '<button data-apx-page="'+x.id+'">'+x.label+'</button>';}).join('');
      if(brand&&brand.nextSibling)row.insertBefore(nav,brand.nextSibling);else row.appendChild(nav);
      nav.querySelectorAll('[data-apx-page]').forEach(function(b){b.onclick=function(){setPage(b.dataset.apxPage);};});
      var refresh=document.getElementById('refresh');
      var settings=document.createElement('button');settings.className='apxTopAction';settings.textContent='⚙';settings.setAttribute('aria-label','Settings');settings.onclick=openSettings;
      var menu=document.createElement('button');menu.className='apxTopAction';menu.textContent='☰';menu.setAttribute('aria-label','Menu');menu.onclick=openMenu;
      if(refresh){row.insertBefore(settings,refresh);row.insertBefore(menu,refresh);}else{row.appendChild(settings);row.appendChild(menu);}
    }
    var banner=document.createElement('div');banner.id='apxBanner';banner.className='apxPageBanner';var top=document.querySelector('.topbar');if(top&&top.parentNode)top.parentNode.insertBefore(banner,top.nextSibling);
    buildOverlay('apxMenu','Apex Market','Navigation, status and tools');buildOverlay('apxSettings','Settings','Customize your market board');
    var bottom=document.querySelector('.bottom');if(bottom){Array.from(bottom.children).forEach(function(btn,i){var item=navItems()[i];if(item)btn.onclick=function(){setPage(item.id);};});}
    var rows=document.getElementById('rows');if(rows){new MutationObserver(function(){clearTimeout(observerTimer);observerTimer=setTimeout(function(){decorateRows();applyPage();updateProviderStatus();},25);}).observe(rows,{childList:true,subtree:true});}
    if(pref.compact){setTimeout(function(){var d=document.getElementById('density');if(d&&d.textContent==='Compact')d.click();},200);}
    window.addEventListener('popstate',function(){currentPage=pageFromPath();updateNavigation();applyPage();});
    document.addEventListener('keydown',function(e){if(e.key==='Escape')closeAll();});
    updateNavigation();decorateRows();applyPage();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();
