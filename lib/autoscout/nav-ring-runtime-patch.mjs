function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Auto Scout nav/ring patch could not locate ${label}.`);
  return source.replace(from, to);
}

export function patchNavAndRingUi(source) {
  let out = String(source || '');

  out = replaceOnce(
    out,
    `function headlineWindow(r){
 if(!r||!r.available||!r.windows)return null;
 var ids=['season','l20','l15','l10','l5'];
 for(var i=0;i<ids.length;i++){var w=r.windows[ids[i]];if(w&&researchRate(w)!=null)return{id:ids[i],w:w};}
 return null;
}`,
    `function headlineWindow(r){
 if(!r||!r.available||!r.windows)return null;
 // Use L10 as the card-ring headline when possible. It is both recent and
 // substantially less noisy than L5. Fall back only to other verified samples.
 var ids=['l10','l15','l20','season','l5'];
 for(var i=0;i<ids.length;i++){
  var w=r.windows[ids[i]],games=num(w?.games);
  if(w&&researchRate(w)!=null&&games!=null&&games>0)return{id:ids[i],w:w};
 }
 return null;
}`,
    'headline percentage window',
  );

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
 // Recompute the visible ring from the exact verified hit/miss/push counts so
 // the card, detail page and research windows all use the same denominator.
 if(Number.isInteger(games)&&games>0&&Number.isInteger(hits)&&hits>=0&&Number.isInteger(misses)&&misses>=0&&Number.isInteger(pushes)&&pushes>=0&&hits+misses+pushes===games){
  var active=100*hits/games,opposite=100*misses/games,push=100*pushes/games;
  rates=direction==='UNDER'?{over:opposite,under:active,push:push,games:games}:{over:active,under:opposite,push:push,games:games};
 }else{
  rates=researchSideRates(w,direction);
 }
 if(!rates)return null;
 return {...rates,basis:(h.id==='season'?'SZN '+(r.season||''):w.label||h.id.toUpperCase())+(w.partial?' · partial':'')};
}`,
    'percentage ring calculation',
  );

  out = replaceOnce(
    out,
    `<button data-view="snipes" data-icon="trend" aria-label="Automatic snipes"><span class="asNavIcon" aria-hidden="true">◎</span><span>Snipes</span></button>`,
    `<a class="asNavBrand" href="/" aria-label="ObligePay home">obligepay.com</a><button data-view="snipes" data-icon="trend" aria-label="Automatic snipes"><span class="asNavIcon" aria-hidden="true">◎</span><span>Snipes</span></button>`,
    'ObligePay navigation brand',
  );

  const css = `.asNav{bottom:calc(10px + env(safe-area-inset-bottom))!important;left:50%!important;right:auto!important;transform:translateX(-50%)!important;width:min(900px,calc(100% - 28px))!important;display:grid!important;grid-template-columns:repeat(3,minmax(74px,1fr)) minmax(150px,1.25fr) repeat(3,minmax(74px,1fr))!important;align-items:center!important;gap:3px!important;padding:5px!important;background:rgba(10,17,30,.68)!important;border:1px solid rgba(124,151,190,.34)!important;border-radius:21px!important;box-shadow:0 12px 38px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.035)!important;backdrop-filter:blur(24px) saturate(145%)!important;-webkit-backdrop-filter:blur(24px) saturate(145%)!important}.asNav button,.asNav a{height:48px!important;min-width:0!important;padding:3px 8px!important;border-radius:15px!important;font-size:11px!important;line-height:1.05!important;gap:1px!important}.asNav button{display:grid!important;grid-template-rows:24px 14px!important;place-items:center!important}.asNavIcon{font-size:19px!important;line-height:1!important}.asNav .on{background:linear-gradient(145deg,rgba(73,126,246,.95),rgba(60,98,220,.9))!important;color:#f4fff9!important;box-shadow:0 7px 20px rgba(49,105,235,.22)!important}.asNavBrand{display:grid!important;place-items:center!important;height:40px!important;margin:0 7px!important;border:1px solid rgba(119,148,191,.34)!important;background:rgba(28,38,57,.62)!important;color:#f7f9fd!important;border-radius:999px!important;font-size:13px!important;font-weight:850!important;letter-spacing:.01em!important;text-decoration:none!important;white-space:nowrap!important}.as5{padding-bottom:calc(78px + env(safe-area-inset-bottom))!important}@media(max-width:650px){.asNav{bottom:calc(6px + env(safe-area-inset-bottom))!important;width:calc(100% - 14px)!important;grid-template-columns:repeat(6,minmax(0,1fr))!important;padding:4px!important;border-radius:18px!important;gap:1px!important}.asNavBrand{display:none!important}.asNav button,.asNav a{height:44px!important;padding:2px 2px!important;border-radius:13px!important;font-size:9px!important}.asNav button{grid-template-rows:22px 13px!important}.asNavIcon{font-size:18px!important}.as5{padding-bottom:calc(70px + env(safe-area-inset-bottom))!important}}`;

  out = replaceOnce(out, '</style>`;}', css + '</style>`;}', 'navigation style close');

  return out;
}
