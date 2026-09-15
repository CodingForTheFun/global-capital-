export function patchObligePropsVisualUi(source) {
  const css = `
<style id="oblige-props-pixel-target">
/* Oblige Props screenshot-target layer. Presentation only; no data or API changes. */
#as5{background:#030817!important;background-image:radial-gradient(900px 460px at 50% -180px,rgba(34,91,196,.16),transparent 65%),linear-gradient(180deg,#061020 0%,#030817 45%,#020612 100%)!important}
#as5 .asTop{padding:12px 18px 14px!important;background:rgba(3,10,24,.9)!important;border-bottom:1px solid rgba(49,92,143,.28)!important;box-shadow:0 12px 34px rgba(0,0,0,.24)!important;backdrop-filter:blur(22px) saturate(145%)!important;-webkit-backdrop-filter:blur(22px) saturate(145%)!important}
#as5 .asBar{max-width:1480px!important;margin:0 auto!important;display:grid!important;grid-template-columns:auto minmax(180px,640px) auto!important;grid-template-areas:"brand search actions" "filters filters filters"!important;align-items:center!important;column-gap:18px!important;row-gap:14px!important}
#as5 .asLeft{display:contents!important}
#as5 .asMenu{display:none!important}
#as5 .asIdentity{grid-area:brand!important;display:flex!important;align-items:center!important;gap:0!important;text-decoration:none!important;white-space:nowrap!important;min-width:max-content!important}
#as5 .asIdentity .asLogo,#as5 .asIdentity .asBrand{display:none!important}
#as5 .asWordmark{font-size:26px!important;font-weight:900!important;letter-spacing:-.055em!important;line-height:1!important}
#as5 .asWordmark .asOblige{color:#f7fbff!important}
#as5 .asWordmark .asProps{color:#3f7dff!important}
#as5 .asHeaderSearch{grid-area:search!important;height:48px!important;display:flex!important;align-items:center!important;gap:10px!important;padding:0 16px!important;border:1px solid rgba(79,119,169,.38)!important;border-radius:14px!important;background:linear-gradient(180deg,rgba(10,27,47,.88),rgba(5,17,33,.94))!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.035),0 10px 24px rgba(0,0,0,.12)!important;color:#9db4d1!important}
#as5 .asHeaderSearchIcon{font-size:23px!important;line-height:1!important;color:#9ebce2!important}
#as5 .asHeaderSearch input{width:100%!important;border:0!important;outline:0!important;background:transparent!important;color:#edf5ff!important;font:600 15px/1.2 inherit!important;min-width:0!important}
#as5 .asHeaderSearch input::placeholder{color:#617a99!important}
#as5 .asRight{grid-area:actions!important;justify-self:end!important}
#as5 .asSports{grid-area:filters!important;display:flex!important;align-items:center!important;gap:9px!important;overflow-x:auto!important;scrollbar-width:none!important;padding:1px 0 2px!important}
#as5 .asSports::-webkit-scrollbar{display:none!important}
#as5 .asSport{height:44px!important;min-width:max-content!important;padding:0 16px!important;border-radius:14px!important;border:1px solid rgba(71,106,151,.34)!important;background:linear-gradient(180deg,rgba(9,23,42,.93),rgba(5,14,28,.96))!important;color:#dce8f8!important;font-weight:750!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.025)!important}
#as5 .asSport.on{background:linear-gradient(145deg,#1686ff,#1763f0)!important;border-color:#2e95ff!important;color:#fff!important;box-shadow:0 7px 22px rgba(28,116,255,.32),inset 0 1px 0 rgba(255,255,255,.18)!important}

/* Cards: compact glossy terminal layout. */
#as5 .asGrid{gap:16px!important;padding-bottom:10px!important}
#as5 .asCard{border-radius:20px!important;border:1px solid rgba(62,103,153,.43)!important;background:linear-gradient(145deg,rgba(10,31,52,.96),rgba(3,13,28,.985))!important;box-shadow:0 18px 40px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.045)!important}
#as5 .asCard:before{height:30%!important;background:linear-gradient(180deg,rgba(255,255,255,.025),transparent)!important}
#as5 .asCardHead{grid-template-columns:60px minmax(0,1fr) 190px!important;gap:13px!important;align-items:start!important;padding:16px 18px 13px!important}
#as5 .asCard .asAvatar{width:58px!important;height:58px!important;border-radius:50%!important;border:1px solid rgba(100,151,211,.65)!important;box-shadow:0 8px 18px rgba(0,0,0,.26)!important}
#as5 .asCardName .asPlayer{font-size:22px!important;line-height:1.05!important;font-weight:900!important;letter-spacing:-.035em!important}
#as5 .asCardMarket{font-size:17px!important;line-height:1.25!important;margin-top:8px!important;font-weight:850!important;color:#f5f8fd!important}
#as5 .asCardMatch{font-size:13px!important;margin-top:6px!important;color:#8fa6c2!important}
#as5 .asMatchPills{padding:0 18px 12px!important}
#as5 .asPill{font-size:11px!important}

/* One clear percentage in the donut; suppress legacy SVG midpoint and legacy text. */
#as5 .asRingMid,#as5 .asRingText{display:none!important}
/* The edge build replaces the SVG midpoint with its own .asRingCenter span, so
   the rule above misses it and two centre percentages stack in the same box —
   a rounded over% on top of the labelled hit rate. Hide it only where the
   premium decorator has actually added .asHitChance (it stamps
   data-premium-ring on the ring), so an edge-only deployment that has no
   replacement still keeps a centre percentage. The span carries inline styles,
   which !important overrides. */
#as5 .asRing[data-premium-ring="1"] .asRingCenter{display:none!important}
#as5 .asRing:not(.asRingEmpty){grid-template-columns:104px 72px!important;width:186px!important;min-height:104px!important;gap:10px!important}
#as5 .asRingSvg{width:104px!important;height:104px!important}
/* The centre used to carry the number AND a "OVER HIT RATE" caption. The donut
   hole is only 23/64 of the ring box, and the app's font stack names Inter but
   never loads it, so every device renders the wider system fallback: measured
   across all four ring sizes, both the number and the caption crossed the
   stroke on every card. The caption moves out of the hole (kept for screen
   readers) and the number is sized to the hole it actually has to fit, so the
   side it refers to is carried by the highlighted legend row instead. */
#as5 .asRingSvg circle{stroke-width:6!important}
#as5 .asHitChance{left:0!important;top:0!important;width:104px!important;height:104px!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important}
#as5 .asHitChance strong{font-size:19px!important;line-height:1!important;letter-spacing:-.02em!important;font-variant-numeric:tabular-nums!important}
#as5 .asHitChance span{position:absolute!important;width:1px!important;height:1px!important;margin:-1px!important;padding:0!important;border:0!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;clip-path:inset(50%)!important;white-space:nowrap!important}
/* An absent value is stated, never invented — but it should not wear the
   typography of a result. Muted and smaller, so a real number still leads. */
#as5 .asMatchMetric>strong.asUnavailable{font-size:.95rem!important;font-weight:500!important;color:#8fa4bd!important}
#as5 .asMatchMetric dd.asUnavailable,#as5 .asWindow b.asUnavailable{color:#8fa4bd!important;font-weight:400!important}
#as5 .asLineOpportunity strong.asUnavailable,#as5 .asMarketSummary b.asUnavailable{font-size:.95rem!important;font-weight:500!important;color:#8fa4bd!important}
#as5 .asCtx b.asUnavailable{font-size:.8125rem!important;font-weight:400!important;color:#91a4bb!important}
#as5 .asProjectedStat b.asUnavailable{font-size:.95rem!important;color:#8fa4bd!important}
#as5 .asRingLegend .asWin b{color:#f3f8ff!important}
#as5 .asRingLegend .asWin small{color:#b8cae1!important;font-weight:750!important}
#as5 .asRingLegend{gap:8px!important}
#as5 .asRingLegend span{grid-template-columns:8px 1fr!important;column-gap:7px!important}
#as5 .asRingLegend i{width:8px!important;height:18px!important;border-radius:4px!important}
#as5 .asRingLegend b{font-size:13px!important}
#as5 .asRingLegend small{font-size:9px!important;margin-top:2px!important}

/* Keep all eight research windows in one dense row like the reference. */
#as5 .asBadges{grid-template-columns:repeat(8,minmax(0,1fr))!important;gap:0!important;border-top:1px solid rgba(55,91,133,.35)!important;border-bottom:1px solid rgba(55,91,133,.35)!important;background:rgba(3,15,29,.72)!important}
#as5 .asBadge{min-height:70px!important;padding:9px 3px 8px!important;border-right:1px solid rgba(54,86,126,.36)!important;box-shadow:inset 0 -3px 0 rgba(40,220,158,.06)!important}
#as5 .asBadge:last-child{border-right:0!important}
#as5 .asBadge small{font-size:10px!important;line-height:1.05!important}
#as5 .asBadge b{font-size:18px!important;line-height:1.05!important;margin-top:4px!important}
#as5 .asBadge em,#as5 .asBadge span{font-size:9px!important}

/* Provider rail including the screenshot-style Available At label. */
#as5 .asBookRail{align-items:stretch!important;padding:11px 13px 13px!important;gap:8px!important;background:rgba(2,9,20,.55)!important}
#as5 .asBookRail:before{content:"Available\\A At";white-space:pre;display:flex;align-items:center;justify-content:center;flex:0 0 68px;color:#8097b4;font-size:11px;font-weight:700;line-height:1.1;text-align:center}
#as5 .asBookChip{min-width:138px!important;border-radius:13px!important;padding:9px 10px!important;background:linear-gradient(180deg,rgba(14,31,53,.96),rgba(7,18,34,.98))!important;border-color:rgba(65,105,153,.38)!important}

/* Save becomes the small star in the card corner instead of a giant full-width row. */
#as5 .asCard .asRowActions{position:absolute!important;top:10px!important;right:10px!important;z-index:6!important;width:auto!important;min-height:0!important;padding:0!important;margin:0!important;border:0!important;background:transparent!important;box-shadow:none!important;display:block!important}
#as5 .asCard .asRowActions>*:not(.asSave){display:none!important}
#as5 .asCard .asSave{display:grid!important;place-items:center!important;width:32px!important;height:32px!important;min-width:32px!important;padding:0!important;border:0!important;background:transparent!important;color:#8ba7c9!important;font-size:0!important;box-shadow:none!important}
#as5 .asCard .asSave:before{content:"☆";font-size:25px!important;line-height:1!important}
#as5 .asCard .asSave.asSaved:before{content:"★";color:#55a5ff!important;text-shadow:0 0 14px rgba(64,142,255,.4)!important}

/* Screenshot-like floating glass nav; brand capsule remains present on iPhone. */
#as5 .asNav{bottom:calc(8px + env(safe-area-inset-bottom))!important;width:min(900px,calc(100% - 28px))!important;grid-template-columns:repeat(3,minmax(62px,1fr)) minmax(140px,1.4fr) repeat(3,minmax(62px,1fr))!important;gap:2px!important;padding:6px!important;border-radius:24px!important;background:linear-gradient(180deg,rgba(11,34,57,.78),rgba(4,17,34,.86))!important;border:1px solid rgba(82,127,179,.5)!important;box-shadow:0 22px 55px rgba(0,0,0,.42),inset 0 1px 0 rgba(255,255,255,.07),0 0 38px rgba(23,105,206,.08)!important;backdrop-filter:blur(28px) saturate(155%)!important;-webkit-backdrop-filter:blur(28px) saturate(155%)!important}
#as5 .asNav button,#as5 .asNav a{height:50px!important;color:#b8c9dd!important}
#as5 .asNav .on{background:linear-gradient(150deg,#147dff,#125eea)!important;border:1px solid rgba(71,180,255,.8)!important;box-shadow:0 0 0 1px rgba(28,145,255,.18),0 8px 24px rgba(0,112,255,.38),inset 0 1px 0 rgba(255,255,255,.18)!important}
#as5 .asNavBrand{display:grid!important;height:40px!important;margin:0 5px!important;min-width:0!important;border-radius:999px!important;background:linear-gradient(180deg,rgba(14,39,65,.72),rgba(7,24,44,.78))!important;border:1px solid rgba(75,113,159,.4)!important;color:#f4f8fd!important;font-size:13px!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.045)!important}
#as5{padding-bottom:calc(82px + env(safe-area-inset-bottom))!important}

@media(max-width:700px){
 #as5 .asTop{padding:11px 12px 12px!important}
 #as5 .asBar{grid-template-columns:auto minmax(0,1fr) auto!important;column-gap:9px!important;row-gap:10px!important}
 #as5 .asWordmark{font-size:20px!important}
 #as5 .asHeaderSearch{height:41px!important;padding:0 11px!important;border-radius:12px!important}
 #as5 .asHeaderSearch input{font-size:12px!important}
 #as5 .asHeaderSearchIcon{font-size:18px!important}
 #as5 .asRight{max-width:52px!important;overflow:hidden!important}
 #as5 .asSports{gap:7px!important}
 #as5 .asSport{height:40px!important;padding:0 13px!important;border-radius:12px!important;font-size:11px!important}
 #as5 .asCardHead{grid-template-columns:48px minmax(0,1fr) 166px!important;gap:9px!important;padding:13px 11px 10px!important}
 #as5 .asCard .asAvatar{width:47px!important;height:47px!important}
 #as5 .asCardName .asPlayer{font-size:17px!important;padding-right:26px!important}
 #as5 .asCardMarket{font-size:15px!important;margin-top:5px!important}
 #as5 .asCardMatch{font-size:11px!important;margin-top:4px!important}
 #as5 .asMatchPills{padding:0 11px 9px!important}
 #as5 .asRing:not(.asRingEmpty){grid-template-columns:88px 68px!important;width:162px!important;min-height:88px!important;gap:6px!important}
 #as5 .asRingSvg{width:88px!important;height:88px!important}
 #as5 .asHitChance{width:88px!important;height:88px!important}
 #as5 .asHitChance strong{font-size:16px!important}
 #as5 .asRingLegend{gap:5px!important}
 #as5 .asRingLegend span{grid-template-columns:7px 1fr!important;column-gap:5px!important}
 #as5 .asRingLegend i{width:7px!important;height:15px!important}
 #as5 .asRingLegend b{font-size:10px!important}
 #as5 .asRingLegend small{font-size:7px!important}
 #as5 .asBadge{min-height:59px!important;padding:7px 1px 6px!important}
 #as5 .asBadge small{font-size:8px!important}
 #as5 .asBadge b{font-size:13px!important;margin-top:3px!important;letter-spacing:-.025em!important}
 #as5 .asBadge em,#as5 .asBadge span{font-size:7px!important}
 #as5 .asBookRail:before{flex-basis:54px;font-size:9px}
 #as5 .asBookChip{min-width:116px!important;padding:8px!important}
 #as5 .asNav{width:calc(100% - 18px)!important;grid-template-columns:repeat(3,minmax(0,1fr)) minmax(88px,1.45fr) repeat(3,minmax(0,1fr))!important;padding:5px!important;gap:1px!important;border-radius:22px!important}
 #as5 .asNavBrand{display:grid!important;height:38px!important;margin:0 2px!important;font-size:10px!important}
 #as5 .asNav button,#as5 .asNav a{height:46px!important;padding:2px!important;border-radius:14px!important;font-size:8px!important}
 #as5 .asNav button{grid-template-rows:22px 12px!important}
 #as5 .asNavIcon{font-size:17px!important}
 #as5{padding-bottom:calc(76px + env(safe-area-inset-bottom))!important}
}
@media(max-width:430px){
 #as5 .asTop{padding-left:9px!important;padding-right:9px!important}
 #as5 .asWordmark{font-size:18px!important}
 #as5 .asHeaderSearch{height:39px!important;padding:0 9px!important}
 #as5 .asHeaderSearch input{font-size:11px!important}
 #as5 .asCard{border-radius:18px!important}
 #as5 .asCardHead{grid-template-columns:44px minmax(0,1fr) 148px!important;gap:7px!important;padding:12px 9px 8px!important}
 #as5 .asCard .asAvatar{width:43px!important;height:43px!important}
 #as5 .asCardName .asPlayer{font-size:15px!important}
 #as5 .asCardMarket{font-size:13px!important}
 #as5 .asCardMatch{font-size:10px!important}
 #as5 .asRing:not(.asRingEmpty){grid-template-columns:79px 62px!important;width:145px!important;min-height:80px!important;gap:4px!important}
 #as5 .asRingSvg{width:79px!important;height:79px!important}
 #as5 .asHitChance{width:79px!important;height:79px!important}
 #as5 .asHitChance strong{font-size:14px!important}
 #as5 .asRingLegend b{font-size:9px!important}
 #as5 .asRingLegend small{font-size:6px!important;display:block!important}
 #as5 .asBadges{grid-template-columns:repeat(8,minmax(0,1fr))!important}
 #as5 .asBadge{min-width:0!important;min-height:56px!important;padding:6px 0!important}
 #as5 .asBadge small{font-size:7px!important}
 #as5 .asBadge b{font-size:11px!important;white-space:nowrap!important}
 #as5 .asBadge em,#as5 .asBadge span{font-size:6px!important}
 #as5 .asBookRail{padding:9px 8px 10px!important;gap:6px!important}
 #as5 .asBookChip{min-width:106px!important}
 #as5 .asNav{width:calc(100% - 14px)!important;grid-template-columns:repeat(3,minmax(0,1fr)) minmax(82px,1.5fr) repeat(3,minmax(0,1fr))!important;border-radius:20px!important}
 #as5 .asNavBrand{font-size:9px!important}
 #as5 .asNav button,#as5 .asNav a{font-size:7px!important}
}
@media(max-width:375px){
 #as5 .asWordmark{font-size:16px!important}
 #as5 .asHeaderSearch{padding:0 7px!important}
 #as5 .asHeaderSearch input{font-size:10px!important}
 #as5 .asCardHead{grid-template-columns:40px minmax(0,1fr) 136px!important}
 #as5 .asCard .asAvatar{width:39px!important;height:39px!important}
 #as5 .asCardName .asPlayer{font-size:14px!important}
 #as5 .asRing:not(.asRingEmpty){grid-template-columns:73px 57px!important;width:134px!important}
 #as5 .asRingSvg,#as5 .asHitChance{width:73px!important;height:73px!important}
 #as5 .asHitChance strong{font-size:13px!important}
 #as5 .asNav{grid-template-columns:repeat(3,minmax(0,1fr)) minmax(74px,1.45fr) repeat(3,minmax(0,1fr))!important}
 #as5 .asNavBrand{font-size:8px!important}
}
</style>`;

  const script = `
<script id="oblige-props-pixel-target-runtime">
(function(){
  function fireInput(el){
    try{el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}catch(_e){}
  }
  function ensureHeader(){
    var root=document.getElementById('as5'); if(!root)return;
    var identity=root.querySelector('.asIdentity');
    if(identity && !identity.classList.contains('asWordmark')){
      identity.classList.add('asWordmark');
      identity.innerHTML='<span class="asOblige">oblige</span><span class="asProps">props</span>';
    }
    var bar=root.querySelector('.asBar'),real=root.querySelector('#asSearch');
    if(bar && real && !bar.querySelector('.asHeaderSearch')){
      var label=document.createElement('label');label.className='asHeaderSearch';
      label.innerHTML='<span class="asHeaderSearchIcon" aria-hidden="true">⌕</span><input type="search" autocomplete="off" aria-label="Search props" placeholder="Search players, teams, props...">';
      var proxy=label.querySelector('input');
      proxy.value=real.value||'';
      proxy.addEventListener('input',function(){real.value=proxy.value;fireInput(real)});
      real.addEventListener('input',function(){if(proxy.value!==real.value)proxy.value=real.value||''});
      var right=bar.querySelector('.asRight');bar.insertBefore(label,right||null);
    }
  }
  function tidySaveButtons(){
    document.querySelectorAll('#as5 .asCard .asSave').forEach(function(btn){
      var saved=/saved/i.test(btn.textContent||'');btn.classList.toggle('asSaved',saved);
      btn.setAttribute('aria-label',saved?'Remove saved prop':'Save prop');
      btn.setAttribute('title',saved?'Saved':'Save');
    });
  }
  function tidyRings(){
    document.querySelectorAll('#as5 .asRing:not(.asRingEmpty)').forEach(function(ring){
      var legacy=ring.querySelector('.asRingMid');if(legacy)legacy.setAttribute('aria-hidden','true');
      var center=ring.querySelector('.asHitChance');
      if(center){
        var strong=center.querySelector('strong'),label=center.querySelector('span');
        if(strong&&label){label.textContent=(label.textContent||'').replace(/^OVER HIT RATE$/i,'Over hit rate').replace(/^UNDER HIT RATE$/i,'Under hit rate');}
        // The caption no longer sits inside the donut, so the legend has to say
        // which side the centre number belongs to. Highlight that row instead.
        if(label){
          var side=/under/i.test(label.textContent||'')?'under':'over';
          var legend=ring.querySelector('.asRingLegend');
          if(legend){
            var rows=legend.children;
            for(var i=0;i<rows.length;i++)rows[i].classList.toggle('asWin',rows[i].classList.contains(side));
          }
        }
      }
    });
  }
  // The board already renders a missing value muted and small via .asUnavailable.
  // The drawer panels never adopted it, so "Unavailable" appeared in the same
  // large green type as a real hit rate — a gap that read as a broken number
  // rather than an honest absence. Marking it here covers every panel at once,
  // including ones added later, without touching eight call sites.
  var UNAVAILABLE_SLOTS='#as5 .asMatchMetric>strong,#as5 .asMatchMetric dd,'
   +'#as5 .asLineOpportunity strong,#as5 .asMarketSummary b,#as5 .asCtx b,'
   +'#as5 .asProjectedStat b,#as5 .asWindow b';
  function tidyUnavailable(){
    document.querySelectorAll(UNAVAILABLE_SLOTS).forEach(function(el){
      // No regex: this string is emitted through a template literal, where an
      // escaped slash collapses and would terminate the pattern early.
      var text=(el.textContent||'').trim().toLowerCase();
      el.classList.toggle('asUnavailable',
        text==='unavailable'||text==='not available'||text==='n/a');
    });
  }
  function decorate(){ensureHeader();tidySaveButtons();tidyRings();tidyUnavailable();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',decorate,{once:true});else decorate();
  var timer=0;new MutationObserver(function(){clearTimeout(timer);timer=setTimeout(decorate,16)}).observe(document.documentElement,{subtree:true,childList:true,characterData:true});
})();
</script>`;

  const text = String(source || '');
  if (text.includes('id="oblige-props-pixel-target"')) return text;
  return text + '\n' + css + '\n' + script + '\n';
}
