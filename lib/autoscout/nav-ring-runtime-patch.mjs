function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Auto Scout nav/ring patch could not locate ${label}.`);
  return source.replace(from, to);
}

export function patchNavAndRingUi(source) {
  let out = String(source || '');

  // Preserve the product's existing headline-window selection. Only fix how
  // the visible ring derives O/U shares so we do not silently change which
  // research sample a card is summarizing.
  out = replaceOnce(
    out,
    `function gaugeRates(r,side){
 var h=headlineWindow(r);if(!h)return null;
 var rates=researchSideRates(h.w,r.side||side);if(!rates)return null;
 return {...rates,basis:(h.id==='season'?'SZN '+(r.season||''):h.w.label||h.id.toUpperCase())+(h.w.partial?' · partial':'')};
}`,
    `function gaugeRates(r,side){
 var h=headlineWindow(r);if(!h)return null;
 var w=h.w,direction=String(r?.side||side||'OVER').toUpperCase()==='UNDER'?'UNDER':'OVER';
 var games=num(w.games),hits=num(w.hits),misses=num(w.misses),pushes=num(w.pushes);
 var rates=null;
 // Build the circle from the same exact hit/miss/push counts used by the
 // research tiles. Invalid or incomplete samples stay unavailable.
 if(Number.isInteger(games)&&games>0&&Number.isInteger(hits)&&hits>=0&&Number.isInteger(misses)&&misses>=0&&Number.isInteger(pushes)&&pushes>=0&&hits+misses+pushes===games){
  var active=100*hits/games,opposite=100*misses/games,push=100*pushes/games;
  rates=direction==='UNDER'?{over:opposite,under:active,push:push,games:games}:{over:active,under:opposite,push:push,games:games};
 }
 if(!rates)return null;
 return {...rates,basis:(h.id==='season'?'SZN '+(r.season||''):w.label||h.id.toUpperCase())+(w.partial?' · partial':'')};
}`,
    'percentage ring calculation',
  );

  out = replaceOnce(
    out,
    `<button data-view="snipes" data-icon="trend" aria-label="Automatic snipes"><span class="asNavIcon" aria-hidden="true">◎</span><span>Snipes</span></button>`,
    `<a class="asNavBrand" href="/" aria-label="Oblige Props home">obligeprops.com</a><button data-view="snipes" data-icon="trend" aria-label="Automatic snipes"><span class="asNavIcon" aria-hidden="true">◎</span><span>Snipes</span></button>`,
    'Oblige Props navigation brand',
  );

  out = replaceOnce(
    out,
    `<button data-view="saved" data-icon="saved" aria-label="Saved props">`,
    `<a class="asNavNews" href="/news.html" aria-label="Sports news"><span class="asNavIcon" aria-hidden="true">▤</span><span>News</span></a><button data-view="saved" data-icon="saved" aria-label="Saved props">`,
    'sports news navigation',
  );

  const css = `
/* Premium Auto Scout visual system — glossy, dense, mobile-first. */
#as5{--premium-bg:#050915;--premium-panel:#0a1323;--premium-panel2:#0d182b;--premium-line:rgba(98,126,171,.32);--premium-blue:#4e83ff;--premium-green:#35e6a1;--premium-red:#ff526c;background:radial-gradient(900px 420px at 50% -140px,rgba(72,78,255,.24),transparent 64%),radial-gradient(700px 360px at 8% 18%,rgba(31,105,255,.08),transparent 62%),#050915!important;color:#f7f9fd!important}
#as5 .asTop{background:linear-gradient(180deg,rgba(6,10,24,.95),rgba(8,13,29,.86))!important;border-bottom:1px solid rgba(107,130,174,.2)!important;box-shadow:0 10px 34px rgba(0,0,0,.22)!important;backdrop-filter:blur(22px) saturate(135%)!important;-webkit-backdrop-filter:blur(22px) saturate(135%)!important}
#as5 .asLogo{background:linear-gradient(145deg,#6d74ff,#3f7eff)!important;box-shadow:0 8px 22px rgba(67,89,255,.28),inset 0 1px 0 rgba(255,255,255,.28)!important}
#as5 .asSport.on,#as5 .asChip.on{background:linear-gradient(180deg,rgba(66,91,194,.52),rgba(39,57,129,.48))!important;border-color:rgba(106,134,255,.48)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.08)!important}
#as5 .asRow,#as5 .asCard{position:relative!important;overflow:hidden!important;border:1px solid rgba(91,120,166,.34)!important;background:linear-gradient(145deg,rgba(15,27,47,.96),rgba(5,11,23,.98))!important;border-radius:20px!important;box-shadow:0 18px 44px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.045),inset 0 -1px 0 rgba(75,105,165,.08)!important;transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease!important}
#as5 .asRow:before,#as5 .asCard:before{content:"";position:absolute;inset:0 0 auto 0;height:38%;pointer-events:none;background:linear-gradient(180deg,rgba(255,255,255,.035),transparent);z-index:0}
#as5 .asRow:hover,#as5 .asCard:hover{border-color:rgba(104,143,214,.55)!important;box-shadow:0 20px 48px rgba(0,0,0,.34),0 0 0 1px rgba(65,107,194,.08),inset 0 1px 0 rgba(255,255,255,.06)!important}
#as5 .asCardHead,#as5 .asPlayerCell,#as5 .asBadges,#as5 .asBookRail,#as5 .asRowActions{position:relative;z-index:1}
#as5 .asCardHead{padding:15px 16px 11px!important}
#as5 .asAvatar{border:1px solid rgba(110,139,187,.58)!important;background:linear-gradient(145deg,#15243d,#0d1728)!important;box-shadow:0 6px 16px rgba(0,0,0,.24),inset 0 1px 0 rgba(255,255,255,.06)!important}
#as5 .asPlayer,#as5 .asCardName .asPlayer{font-weight:800!important;letter-spacing:-.025em!important;color:#f9fbff!important}
#as5 .asCardMarket,#as5 .asMarket{font-weight:650!important;color:#e4edfb!important}
#as5 .asCardMatch,#as5 .asGame{color:#93a7c2!important}
#as5 .asMatchPills{padding:0 14px 10px!important;gap:6px!important}
#as5 .asPill{border:1px solid rgba(88,116,159,.34)!important;background:linear-gradient(180deg,rgba(20,35,59,.9),rgba(12,23,41,.94))!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.035)!important}
#as5 .asBadges{background:rgba(10,18,33,.72)!important;border-top:1px solid rgba(69,100,146,.28)!important;border-bottom:1px solid rgba(69,100,146,.28)!important;gap:1px!important}
#as5 .asBadge{background:linear-gradient(180deg,rgba(11,24,39,.92),rgba(7,15,27,.96))!important;border-right:1px solid rgba(75,101,140,.24)!important;min-height:72px!important;display:grid!important;align-content:center!important;box-shadow:inset 0 -18px 30px rgba(16,130,94,.055)!important}
#as5 .asBadge:last-child{border-right:0!important}
#as5 .asBadge small{color:#8195b0!important;font-weight:700!important;letter-spacing:.02em!important}
#as5 .asBadge b{font-variant-numeric:tabular-nums!important;font-weight:800!important}
#as5 .asBadge .good,#as5 .asBadge.good b{color:#5cf0b1!important;text-shadow:0 0 18px rgba(53,230,161,.14)!important}
#as5 .asBadge .bad,#as5 .asBadge.bad b{color:#ff7185!important}
#as5 .asBookRail{display:flex!important;padding:10px 12px 12px!important;gap:8px!important;overflow-x:auto!important;scrollbar-width:none!important;background:rgba(3,8,18,.55)!important;border-top:1px solid rgba(74,99,137,.28)!important}
#as5 .asBookRail::-webkit-scrollbar{display:none!important}
#as5 .asBookChip{min-width:134px!important;border:1px solid rgba(83,111,155,.34)!important;background:linear-gradient(180deg,rgba(17,30,50,.92),rgba(9,17,30,.98))!important;border-radius:13px!important;padding:9px 10px!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.045)!important}
#as5 .asBookTop{color:#8ca0bd!important}
#as5 .asBookVals .o{color:#55ebb0!important}#as5 .asBookVals .u{color:#ff687c!important}
#as5 .asRing:not(.asRingEmpty){position:relative!important;display:grid!important;grid-template-columns:92px 76px!important;align-items:center!important;gap:8px!important;width:176px!important;min-height:94px!important;padding:0!important}
#as5 .asRingSvg{width:92px!important;height:92px!important;filter:drop-shadow(0 5px 16px rgba(0,0,0,.32))!important}
#as5 .asRingText{display:none!important}
#as5 .asHitChance{position:absolute!important;left:0!important;top:0!important;width:92px!important;height:92px!important;display:grid!important;place-content:center!important;text-align:center!important;pointer-events:none!important}
#as5 .asHitChance strong{font-size:22px!important;line-height:1!important;font-weight:850!important;letter-spacing:-.04em!important;color:#f7fbff!important;font-variant-numeric:tabular-nums!important}
#as5 .asHitChance span{font-size:8px!important;color:#8398b5!important;margin-top:5px!important;text-transform:uppercase!important;letter-spacing:.045em!important}
#as5 .asRingLegend{grid-column:2!important;display:grid!important;gap:7px!important;align-content:center!important;min-width:0!important}
#as5 .asRingLegend span{display:grid!important;grid-template-columns:7px 1fr!important;column-gap:6px!important;align-items:center!important;font-size:10px!important;line-height:1.05!important;color:#879bb7!important;white-space:nowrap!important}
#as5 .asRingLegend i{width:7px!important;height:16px!important;border-radius:3px!important;background:#6d7f99!important;grid-row:1/3!important}
#as5 .asRingLegend b{font-size:12px!important;font-weight:800!important;color:#eef5ff!important;font-variant-numeric:tabular-nums!important}
#as5 .asRingLegend small{font-size:8px!important;color:#7d91ae!important}
#as5 .asRingLegend .over i{background:#25e891!important;box-shadow:0 0 16px rgba(37,232,145,.28)!important}#as5 .asRingLegend .over b{color:#53efa9!important}
#as5 .asRingLegend .under i{background:#ff455f!important}#as5 .asRingLegend .under b{color:#ff6f82!important}
#as5 .asRingLegend .push i{background:#71839f!important}#as5 .asRingLegend .push b{color:#b9c6d8!important}
#as5 .asRingEmpty{border-color:rgba(90,118,162,.36)!important;background:rgba(10,18,31,.58)!important;border-radius:15px!important}
#as5 .asNav{bottom:calc(10px + env(safe-area-inset-bottom))!important;left:50%!important;right:auto!important;transform:translateX(-50%)!important;width:min(900px,calc(100% - 28px))!important;display:grid!important;grid-template-columns:repeat(3,minmax(74px,1fr)) minmax(150px,1.25fr) repeat(4,minmax(74px,1fr))!important;align-items:center!important;gap:3px!important;padding:5px!important;background:linear-gradient(180deg,rgba(19,29,49,.72),rgba(7,13,26,.78))!important;border:1px solid rgba(124,151,190,.36)!important;border-radius:22px!important;box-shadow:0 16px 46px rgba(0,0,0,.36),inset 0 1px 0 rgba(255,255,255,.055)!important;backdrop-filter:blur(26px) saturate(150%)!important;-webkit-backdrop-filter:blur(26px) saturate(150%)!important}
#as5 .asNav button,#as5 .asNav a{height:48px!important;min-width:0!important;padding:3px 8px!important;border-radius:16px!important;font-size:11px!important;line-height:1.05!important;gap:1px!important;color:#aebdd2!important}
#as5 .asNav button,#as5 .asNav .asNavNews{display:grid!important;grid-template-rows:24px 14px!important;place-items:center!important}
#as5 .asNavNews{text-decoration:none!important}
#as5 .asNavIcon{font-size:19px!important;line-height:1!important}
#as5 .asNav .on{background:linear-gradient(145deg,rgba(72,124,255,.98),rgba(57,91,214,.92))!important;color:#f8fbff!important;box-shadow:0 8px 22px rgba(54,106,255,.28),inset 0 1px 0 rgba(255,255,255,.16)!important}
#as5 .asNavBrand{display:grid!important;place-items:center!important;height:40px!important;margin:0 7px!important;border:1px solid rgba(119,148,191,.38)!important;background:linear-gradient(180deg,rgba(31,43,65,.72),rgba(18,27,44,.72))!important;color:#f7f9fd!important;border-radius:999px!important;font-size:13px!important;font-weight:850!important;letter-spacing:.01em!important;text-decoration:none!important;white-space:nowrap!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.04)!important}
#as5{padding-bottom:calc(78px + env(safe-area-inset-bottom))!important}
@media(max-width:700px){#as5 .asCardHead{grid-template-columns:42px minmax(0,1fr) 150px!important;gap:9px!important;padding:12px 11px 9px!important}#as5 .asCard .asAvatar{width:42px!important;height:42px!important}#as5 .asRing:not(.asRingEmpty){grid-template-columns:78px 64px!important;width:148px!important;min-height:80px!important;gap:6px!important}#as5 .asRingSvg{width:78px!important;height:78px!important}#as5 .asHitChance{width:78px!important;height:78px!important}#as5 .asHitChance strong{font-size:18px!important}#as5 .asHitChance span{font-size:7px!important}#as5 .asRingLegend{gap:5px!important}#as5 .asRingLegend span{font-size:8px!important;column-gap:4px!important}#as5 .asRingLegend b{font-size:10px!important}#as5 .asRingLegend small{font-size:7px!important}#as5 .asBadge{min-height:64px!important}#as5 .asBookChip{min-width:124px!important}}
@media(max-width:650px){#as5 .asNav{bottom:calc(6px + env(safe-area-inset-bottom))!important;width:calc(100% - 14px)!important;grid-template-columns:repeat(7,minmax(0,1fr))!important;padding:4px!important;border-radius:19px!important;gap:1px!important}#as5 .asNavBrand{display:none!important}#as5 .asNav button,#as5 .asNav a{height:44px!important;padding:2px 2px!important;border-radius:14px!important;font-size:9px!important}#as5 .asNav button,#as5 .asNav .asNavNews{grid-template-rows:22px 13px!important}#as5 .asNavIcon{font-size:18px!important}#as5{padding-bottom:calc(70px + env(safe-area-inset-bottom))!important}}
@media(max-width:430px){#as5 .asCardHead{grid-template-columns:38px minmax(0,1fr) 130px!important;gap:7px!important}#as5 .asCard .asAvatar{width:38px!important;height:38px!important}#as5 .asRing:not(.asRingEmpty){grid-template-columns:70px 54px!important;width:128px!important;gap:4px!important;min-height:72px!important}#as5 .asRingSvg{width:70px!important;height:70px!important}#as5 .asHitChance{width:70px!important;height:70px!important}#as5 .asHitChance strong{font-size:16px!important}#as5 .asHitChance span{font-size:6px!important}#as5 .asRingLegend i{height:13px!important;width:6px!important}#as5 .asRingLegend b{font-size:9px!important}#as5 .asRingLegend small{display:none!important}#as5 .asBadges{grid-template-columns:repeat(4,minmax(0,1fr))!important}#as5 .asBadge{min-height:58px!important;padding:6px 2px!important}}
`;

  out = replaceOnce(out, '</style>`;}', css + '</style>`;}', 'navigation style close');

  // The existing ring already contains the verified Over/Under values. This
  // presentation layer surfaces those values as a clear center hit-rate and a
  // compact O/U/Push legend without changing the underlying research maths.
  out += `\n;(function premiumAutoScoutCards(){\n  function numeric(text){var m=String(text||'').match(/-?\\d+(?:\\.\\d+)?/);return m?Number(m[0]):null;}\n  function fmt(v){if(!Number.isFinite(v))return '—';var r=Math.round(v*10)/10;return (Math.abs(r-Math.round(r))<.05?Math.round(r):r.toFixed(1))+'%';}\n  function decorateRing(ring){\n    if(!ring||ring.classList.contains('asRingEmpty')||ring.dataset.premiumRing==='1')return;\n    var overEl=ring.querySelector('.asOverPct'),underEl=ring.querySelector('.asUnderPct');\n    var over=numeric(overEl&&overEl.textContent),under=numeric(underEl&&underEl.textContent);\n    if(!Number.isFinite(over)||!Number.isFinite(under))return;\n    var push=Math.max(0,Math.min(100,100-over-under));\n    var side=under>over?'UNDER':'OVER',hit=Math.max(over,under);\n    var center=document.createElement('div');center.className='asHitChance';center.innerHTML='<strong>'+fmt(hit)+'</strong><span>'+side+' hit rate</span>';\n    var legend=document.createElement('div');legend.className='asRingLegend';legend.innerHTML='<span class="over"><i></i><b>'+fmt(over)+'</b><small>Over</small></span><span class="under"><i></i><b>'+fmt(under)+'</b><small>Under</small></span><span class="push"><i></i><b>'+fmt(push)+'</b><small>Push</small></span>';\n    ring.appendChild(center);ring.appendChild(legend);ring.dataset.premiumRing='1';\n    ring.setAttribute('aria-label','Over '+fmt(over)+', Under '+fmt(under)+', Push '+fmt(push)+'. '+side+' hit rate '+fmt(hit));\n  }\n  function decorate(){document.querySelectorAll('.asRing').forEach(decorateRing);}\n  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',decorate,{once:true});else decorate();\n  new MutationObserver(function(){decorate();}).observe(document.documentElement,{subtree:true,childList:true});\n})();\n`;

  return out;
}