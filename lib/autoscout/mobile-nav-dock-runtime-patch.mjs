const MARKER = 'mobile-nav-scroll-hide-runtime-v4';

const SCROLL_NAV_CSS = `
#as5 .asNav.asNavAutoHideRail{
 transform:translate3d(0,0,0)!important;
 transition:transform .22s cubic-bezier(.22,.61,.36,1),opacity .16s ease!important;
 will-change:transform,opacity!important;
}
#as5 .asNav.asNavAutoHideRail>.asNavDockToggle,
#as5 .asNav.asNavAutoHideRail>.asNavEdgeHandle{
 display:none!important;
}
@media(max-width:720px){
 #as5 .asNav.asNavAutoHideRail.asNavScrollHidden{
  transform:translate3d(0,calc(100% + 24px + env(safe-area-inset-bottom)),0)!important;
  opacity:0!important;
  pointer-events:none!important;
 }
}
@media(min-width:721px){
 #as5 .asNav.asNavAutoHideRail{
  transform:translate3d(0,0,0)!important;
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
 var pendingSource=null;
 var trackedSource=null;
 var lastY=0;
 var directionAnchor=0;
 var direction=0;
 var hidden=false;
 var touchY=null;
 var touchSource=null;

 function ensureStyle(){
  var style=document.getElementById(styleId);
  if(!style){
   style=document.createElement('style');
   style.id=styleId;
   (document.head||document.documentElement).appendChild(style);
  }
  style.setAttribute('data-runtime',marker);
  style.textContent=${JSON.stringify(SCROLL_NAV_CSS)};
 }

 function isMobile(){
  return !window.matchMedia||window.matchMedia(mobileQuery).matches;
 }

 function rootScroller(){
  return document.scrollingElement||document.documentElement||document.body;
 }

 function rootY(){
  var root=rootScroller();
  var value=typeof window.scrollY==='number'?window.scrollY:(root&&root.scrollTop)||0;
  return Math.max(0,Number(value)||0);
 }

 function sourceY(source){
  if(!source||source===window||source===document||source===document.documentElement||source===document.body||source===rootScroller())return rootY();
  return Math.max(0,Number(source.scrollTop)||0);
 }

 function scrollSourceFor(target){
  if(!target||target===window||target===document||target===document.documentElement||target===document.body)return rootScroller();
  if(typeof target.scrollTop==='number'&&Number(target.scrollHeight)>Number(target.clientHeight)+1)return target;
  return rootScroller();
 }

 function scrollableAncestor(node){
  var root=rootScroller();
  var current=node&&node.nodeType===1?node:null;
  while(current&&current!==document.body&&current!==document.documentElement){
   if(Number(current.scrollHeight)>Number(current.clientHeight)+1)return current;
   current=current.parentElement;
  }
  return root;
 }

 function setHidden(next){
  if(!nav)return;
  var shouldHide=!!next&&isMobile();
  if(hidden===shouldHide&&nav.classList.contains('asNavScrollHidden')===shouldHide)return;
  hidden=shouldHide;
  nav.classList.toggle('asNavScrollHidden',shouldHide);
 }

 function resetTracking(source){
  trackedSource=source||rootScroller();
  lastY=sourceY(trackedSource);
  directionAnchor=lastY;
  direction=0;
 }

 function updateFromScroll(){
  frame=0;
  if(!nav)return;
  var source=pendingSource||rootScroller();
  pendingSource=null;
  var y=sourceY(source);

  if(!isMobile()){
   setHidden(false);
   resetTracking(source);
   return;
  }

  if(source!==trackedSource){
   resetTracking(source);
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

 function queueScrollUpdate(event){
  pendingSource=scrollSourceFor(event&&event.target);
  if(frame)return;
  frame=requestAnimationFrame(updateFromScroll);
 }

 function onTouchStart(event){
  if(!isMobile()||!event.touches||!event.touches.length)return;
  touchY=event.touches[0].clientY;
  touchSource=scrollableAncestor(event.target);
 }

 function onTouchMove(event){
  if(!isMobile()||touchY==null||!event.touches||!event.touches.length)return;
  var nextY=event.touches[0].clientY;
  var delta=nextY-touchY;
  if(Math.abs(delta)<6)return;
  var y=sourceY(touchSource||rootScroller());
  if(delta<0&&y>8)setHidden(true);
  else if(delta>0)setHidden(false);
  touchY=nextY;
 }

 function clearTouch(){
  touchY=null;
  touchSource=null;
 }

 function mount(){
  ensureStyle();
  var nextNav=document.querySelector('#as5 .asNav');
  if(!nextNav)return false;
  if(nav&&nav!==nextNav){
   nav.classList.remove('asNavAutoHideRail','asNavScrollHidden','asNavSlideRail','asNavCollapsed');
   nav.style.removeProperty('translate');
   nav.style.removeProperty('transform');
  }
  nav=nextNav;
  if(nav.dataset.scrollHideReady==='4')return true;
  nav.dataset.scrollHideReady='4';
  nav.dataset.slideRailReady='0';
  nav.classList.remove('asNavDockOpen','asNavSlideRail','asNavCollapsed');
  nav.classList.add('asNavAutoHideRail');
  nav.style.removeProperty('translate');
  nav.style.removeProperty('transform');
  var oldToggle=nav.querySelector('.asNavDockToggle');if(oldToggle)oldToggle.remove();
  var oldHandle=nav.querySelector('.asNavEdgeHandle');if(oldHandle)oldHandle.remove();
  hidden=false;
  setHidden(false);
  resetTracking(rootScroller());
  return true;
 }

 window.addEventListener('scroll',queueScrollUpdate,{passive:true});
 document.addEventListener('scroll',queueScrollUpdate,{passive:true,capture:true});
 document.addEventListener('touchstart',onTouchStart,{passive:true,capture:true});
 document.addEventListener('touchmove',onTouchMove,{passive:true,capture:true});
 document.addEventListener('touchend',clearTouch,{passive:true,capture:true});
 document.addEventListener('touchcancel',clearTouch,{passive:true,capture:true});
 window.addEventListener('resize',function(){
  if(!isMobile())setHidden(false);
  resetTracking(rootScroller());
 },{passive:true});
 window.addEventListener('pageshow',function(){
  setHidden(false);
  resetTracking(rootScroller());
 },{passive:true});

 mount();
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){mount();setHidden(false);resetTracking(rootScroller());},{once:true});
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
