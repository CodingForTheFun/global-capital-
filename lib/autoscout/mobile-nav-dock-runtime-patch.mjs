const MARKER = 'mobile-nav-dock-runtime-v1';

const MOBILE_DOCK_CSS = `
#as5 .asNavDockToggle{display:none!important}
@media(max-width:720px){
 #as5 .asNav{
  top:58%!important;
  bottom:auto!important;
  left:auto!important;
  right:calc(8px + env(safe-area-inset-right,0px))!important;
  transform:translateY(-50%)!important;
  box-sizing:border-box!important;
  display:flex!important;
  flex-direction:column!important;
  align-items:stretch!important;
  width:54px!important;
  max-width:54px!important;
  max-height:54px!important;
  gap:4px!important;
  padding:4px!important;
  overflow:hidden!important;
  border-radius:18px!important;
  border:1px solid rgba(151,184,223,.20)!important;
  background:rgba(4,12,25,.17)!important;
  box-shadow:0 8px 24px rgba(0,0,0,.14),inset 0 1px 0 rgba(255,255,255,.055)!important;
  backdrop-filter:blur(18px) saturate(135%)!important;
  -webkit-backdrop-filter:blur(18px) saturate(135%)!important;
  overscroll-behavior:contain!important;
  scrollbar-width:none!important;
  transition:width .2s ease,max-width .2s ease,max-height .2s ease,background .2s ease,border-color .2s ease,border-radius .2s ease,box-shadow .2s ease!important;
 }
 #as5 .asNav::-webkit-scrollbar{display:none!important}
 #as5 .asNav.asNavDockOpen{
  width:min(168px,calc(100vw - 20px))!important;
  max-width:min(168px,calc(100vw - 20px))!important;
  max-height:min(72vh,520px)!important;
  overflow-x:hidden!important;
  overflow-y:auto!important;
  border-radius:20px!important;
  border-color:rgba(151,184,223,.29)!important;
  background:rgba(4,12,25,.46)!important;
  box-shadow:0 14px 38px rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.075)!important;
  backdrop-filter:blur(24px) saturate(145%)!important;
  -webkit-backdrop-filter:blur(24px) saturate(145%)!important;
 }
 #as5 .asNav>.asNavBrand{display:none!important}
 #as5 .asNav>*:not(.asNavDockToggle){display:none!important}
 #as5 .asNav .asNavDockToggle{
  order:-100!important;
  display:grid!important;
  place-items:center!important;
  align-self:flex-end!important;
  box-sizing:border-box!important;
  width:46px!important;
  min-width:46px!important;
  max-width:46px!important;
  height:46px!important;
  min-height:46px!important;
  padding:0!important;
  margin:0!important;
  border:1px solid rgba(183,207,236,.15)!important;
  border-radius:14px!important;
  background:rgba(255,255,255,.045)!important;
  color:rgba(235,245,255,.92)!important;
  box-shadow:none!important;
  cursor:pointer!important;
 }
 #as5 .asNav.asNavDockOpen .asNavDockToggle{
  background:rgba(255,255,255,.07)!important;
  border-color:rgba(183,207,236,.20)!important;
 }
 #as5 .asNavDockBars{
  width:20px!important;
  height:16px!important;
  display:flex!important;
  flex-direction:column!important;
  justify-content:space-between!important;
  pointer-events:none!important;
 }
 #as5 .asNavDockBars i{
  display:block!important;
  width:20px!important;
  height:2px!important;
  border-radius:999px!important;
  background:currentColor!important;
  transform-origin:center!important;
  transition:transform .2s ease,opacity .16s ease!important;
 }
 #as5 .asNav.asNavDockOpen .asNavDockBars i:nth-child(1){transform:translateY(7px) rotate(45deg)!important}
 #as5 .asNav.asNavDockOpen .asNavDockBars i:nth-child(2){opacity:0!important}
 #as5 .asNav.asNavDockOpen .asNavDockBars i:nth-child(3){transform:translateY(-7px) rotate(-45deg)!important}
 #as5 .asNav.asNavDockOpen>button:not(.asNavDockToggle),
 #as5 .asNav.asNavDockOpen>a:not(.asNavBrand){
  display:grid!important;
  grid-template-columns:28px minmax(0,1fr)!important;
  grid-template-rows:1fr!important;
  align-items:center!important;
  justify-items:start!important;
  box-sizing:border-box!important;
  width:100%!important;
  min-width:0!important;
  height:44px!important;
  min-height:44px!important;
  padding:0 10px!important;
  margin:0!important;
  gap:8px!important;
  border:1px solid transparent!important;
  border-radius:13px!important;
  background:transparent!important;
  box-shadow:none!important;
  color:rgba(224,235,248,.82)!important;
  font-size:11px!important;
  line-height:1!important;
  text-decoration:none!important;
 }
 #as5 .asNav.asNavDockOpen>button:not(.asNavDockToggle).on,
 #as5 .asNav.asNavDockOpen>a.on{
  border-color:rgba(104,181,239,.22)!important;
  background:rgba(45,145,222,.13)!important;
  color:#f4f9ff!important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.045)!important;
 }
 #as5 .asNav.asNavDockOpen .asNavIcon{
  display:grid!important;
  place-items:center!important;
  width:26px!important;
  height:26px!important;
  padding:2px!important;
  margin:0!important;
  border-radius:9px!important;
  background:transparent!important;
  color:inherit!important;
  font-size:18px!important;
  line-height:1!important;
 }
 #as5 .asNav.asNavDockOpen>button:not(.asNavDockToggle)>span:last-child,
 #as5 .asNav.asNavDockOpen>a:not(.asNavBrand)>span:last-child{
  position:static!important;
  width:auto!important;
  height:auto!important;
  margin:0!important;
  padding:0!important;
  overflow:visible!important;
  clip:auto!important;
  clip-path:none!important;
  white-space:nowrap!important;
  font-size:11px!important;
  font-weight:700!important;
  letter-spacing:0!important;
 }
 #as5 .asNavDockSrOnly{
  position:absolute!important;
  width:1px!important;
  height:1px!important;
  padding:0!important;
  margin:-1px!important;
  overflow:hidden!important;
  clip:rect(0,0,0,0)!important;
  clip-path:inset(50%)!important;
  white-space:nowrap!important;
  border:0!important;
 }
}
@media(max-width:430px){
 #as5 .asNav.asNavDockOpen{
  width:min(158px,calc(100vw - 18px))!important;
  max-width:min(158px,calc(100vw - 18px))!important;
 }
 #as5 .asNav.asNavDockOpen>button:not(.asNavDockToggle),
 #as5 .asNav.asNavDockOpen>a:not(.asNavBrand){height:43px!important;min-height:43px!important;font-size:10px!important}
 #as5 .asNav.asNavDockOpen>button:not(.asNavDockToggle)>span:last-child,
 #as5 .asNav.asNavDockOpen>a:not(.asNavBrand)>span:last-child{font-size:10px!important}
}
@media(prefers-reduced-motion:reduce){
 #as5 .asNav,#as5 .asNavDockBars i{transition:none!important}
}
`;

const MOBILE_DOCK_RUNTIME = `
;(function mobileNavDockRuntime(){
 var marker='${MARKER}';
 var styleId='mobile-nav-dock-style-v1';
 var mobileQuery='(max-width:720px)';
 var observer=null;
 function isMobile(){return !!(window.matchMedia&&window.matchMedia(mobileQuery).matches);}
 function getNav(){return document.querySelector('#as5 .asNav');}
 function updateToggle(toggle,open){
  if(!toggle)return;
  toggle.setAttribute('aria-expanded',open?'true':'false');
  toggle.setAttribute('aria-label',open?'Close navigation':'Open navigation');
  toggle.setAttribute('title',open?'Close menu':'Menu');
  var sr=toggle.querySelector('.asNavDockSrOnly');if(sr)sr.textContent=open?'Close navigation':'Open navigation';
 }
 function setOpen(nav,open){
  if(!nav)return;
  var next=!!open&&isMobile();
  nav.classList.toggle('asNavDockOpen',next);
  updateToggle(nav.querySelector('.asNavDockToggle'),next);
 }
 function ensureStyle(){
  if(document.getElementById(styleId))return;
  var style=document.createElement('style');style.id=styleId;style.setAttribute('data-runtime',marker);style.textContent=${JSON.stringify(MOBILE_DOCK_CSS)};(document.head||document.documentElement).appendChild(style);
 }
 function ensureDock(){
  ensureStyle();
  var nav=getNav();if(!nav)return;
  var toggle=nav.querySelector('.asNavDockToggle');
  if(!toggle){
   toggle=document.createElement('button');
   toggle.type='button';
   toggle.className='asNavDockToggle';
   toggle.innerHTML='<span class="asNavDockBars" aria-hidden="true"><i></i><i></i><i></i></span><span class="asNavDockSrOnly">Open navigation</span>';
   nav.insertBefore(toggle,nav.firstChild||null);
  }
  updateToggle(toggle,nav.classList.contains('asNavDockOpen'));
  if(!isMobile())setOpen(nav,false);
 }
 function onClick(event){
  var target=event.target&&event.target.closest?event.target:null;if(!target)return;
  var toggle=target.closest('#as5 .asNavDockToggle');
  if(toggle){
   event.preventDefault();event.stopPropagation();
   var nav=toggle.closest('.asNav');setOpen(nav,!nav.classList.contains('asNavDockOpen'));return;
  }
  var nav=getNav();if(!nav||!isMobile()||!nav.classList.contains('asNavDockOpen'))return;
  var item=target.closest('#as5 .asNav button:not(.asNavDockToggle),#as5 .asNav a:not(.asNavBrand)');
  if(item){setTimeout(function(){setOpen(nav,false);},0);return;}
  if(!nav.contains(target))setOpen(nav,false);
 }
 function onKeydown(event){if(event.key==='Escape')setOpen(getNav(),false);}
 function onViewportChange(){ensureDock();if(!isMobile())setOpen(getNav(),false);}
 ensureDock();
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ensureDock,{once:true});
 document.addEventListener('click',onClick,true);
 document.addEventListener('keydown',onKeydown);
 if(window.matchMedia){var mq=window.matchMedia(mobileQuery);if(mq.addEventListener)mq.addEventListener('change',onViewportChange);else if(mq.addListener)mq.addListener(onViewportChange);}
 if(typeof MutationObserver==='function'){
  var timer=0;observer=new MutationObserver(function(){clearTimeout(timer);timer=setTimeout(ensureDock,24);});
  observer.observe(document.documentElement,{subtree:true,childList:true});
 }
})();
`;

export function patchMobileNavDockUi(source) {
  const text = String(source || '');
  if (text.includes(MARKER)) return text;
  return text + '\n' + MOBILE_DOCK_RUNTIME + '\n';
}
