const MARKER = 'mobile-nav-scroll-hide-runtime-v3';

const SCROLL_NAV_CSS = `
#as5 .asNav.asNavAutoHideRail{
 transition:translate .20s cubic-bezier(.22,.61,.36,1),opacity .16s ease!important;
 will-change:translate,opacity!important;
}
#as5 .asNav.asNavAutoHideRail>.asNavDockToggle,
#as5 .asNav.asNavAutoHideRail>.asNavEdgeHandle{
 display:none!important;
}
@media(max-width:720px){
 #as5 .asNav.asNavAutoHideRail.asNavScrollHidden{
  translate:0 calc(-100% - 10px)!important;
  opacity:0!important;
  pointer-events:none!important;
 }
}
@media(min-width:721px){
 #as5 .asNav.asNavAutoHideRail{
  translate:0 0!important;
  opacity:1!important;
  pointer-events:auto!important;
 }
}
@media(prefers-reduced-motion:reduce){
 #as5 .asNav.asNavAutoHideRail{transition:none!important}
}
`;

const SCROLL_NAV_RUNTIME = `
;(function scrollAwareMobileNavRuntime(){
 var marker='${MARKER}';
 var styleId='obligeprops-scroll-nav-style';
 var mobileQuery='(max-width:720px)';
 var nav=null;
 var observer=null;
 var frame=0;
 var lastY=0;
 var directionAnchor=0;
 var direction=0;
 var hidden=false;

 function ensureStyle(){
  if(document.getElementById(styleId))return;
  var style=document.createElement('style');
  style.id=styleId;
  style.setAttribute('data-runtime',marker);
  style.textContent=${JSON.stringify(SCROLL_NAV_CSS)};
  (document.head||document.documentElement).appendChild(style);
 }

 function isMobile(){
  return !window.matchMedia||window.matchMedia(mobileQuery).matches;
 }

 function pageY(){
  var root=document.scrollingElement||document.documentElement||document.body;
  var value=typeof window.scrollY==='number'?window.scrollY:(root&&root.scrollTop)||0;
  return Math.max(0,Number(value)||0);
 }

 function setHidden(next){
  if(!nav)return;
  var shouldHide=!!next&&isMobile();
  if(hidden===shouldHide&&nav.classList.contains('asNavScrollHidden')===shouldHide)return;
  hidden=shouldHide;
  nav.classList.toggle('asNavScrollHidden',shouldHide);
 }

 function resetTracking(){
  lastY=pageY();
  directionAnchor=lastY;
  direction=0;
 }

 function updateFromScroll(){
  frame=0;
  if(!nav)return;
  var y=pageY();

  if(!isMobile()){
   setHidden(false);
   lastY=y;
   directionAnchor=y;
   direction=0;
   return;
  }

  if(y<=8){
   setHidden(false);
   lastY=y;
   directionAnchor=y;
   direction=0;
   return;
  }

  var delta=y-lastY;
  if(Math.abs(delta)<0.5)return;
  var nextDirection=delta>0?1:-1;

  if(nextDirection!==direction){
   direction=nextDirection;
   directionAnchor=lastY;
  }

  if(direction>0&&y-directionAnchor>=10){
   setHidden(true);
  }else if(direction<0&&directionAnchor-y>=2){
   setHidden(false);
  }

  lastY=y;
 }

 function queueScrollUpdate(){
  if(frame)return;
  frame=requestAnimationFrame(updateFromScroll);
 }

 function mount(){
  ensureStyle();
  var nextNav=document.querySelector('#as5 .asNav');
  if(!nextNav)return false;
  if(nav&&nav!==nextNav){
   nav.classList.remove('asNavAutoHideRail','asNavScrollHidden','asNavSlideRail','asNavCollapsed');
   nav.style.removeProperty('translate');
  }
  nav=nextNav;
  if(nav.dataset.scrollHideReady==='1')return true;
  nav.dataset.scrollHideReady='1';
  nav.dataset.slideRailReady='0';
  nav.classList.remove('asNavDockOpen','asNavSlideRail','asNavCollapsed');
  nav.classList.add('asNavAutoHideRail');
  nav.style.removeProperty('translate');
  var oldToggle=nav.querySelector('.asNavDockToggle');if(oldToggle)oldToggle.remove();
  var oldHandle=nav.querySelector('.asNavEdgeHandle');if(oldHandle)oldHandle.remove();
  hidden=false;
  setHidden(false);
  resetTracking();
  return true;
 }

 window.addEventListener('scroll',queueScrollUpdate,{passive:true});
 window.addEventListener('resize',function(){
  if(!isMobile())setHidden(false);
  resetTracking();
 },{passive:true});
 window.addEventListener('pageshow',function(){
  setHidden(false);
  resetTracking();
 },{passive:true});

 mount();
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){mount();setHidden(false);resetTracking();},{once:true});
 if(typeof MutationObserver==='function'){
  var timer=0;
  observer=new MutationObserver(function(){clearTimeout(timer);timer=setTimeout(mount,24);});
  observer.observe(document.documentElement,{subtree:true,childList:true});
 }
})();
`;

export function patchMobileNavDockUi(source) {
  const text = String(source || '');
  if (text.includes(MARKER)) return text;
  return text + '\n' + SCROLL_NAV_RUNTIME + '\n';
}
