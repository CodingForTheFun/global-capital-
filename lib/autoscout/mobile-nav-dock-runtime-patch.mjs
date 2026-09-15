const MARKER = 'mobile-nav-slide-runtime-v2';

const SLIDE_NAV_CSS = `
#as5 .asNav.asNavSlideRail{
 overflow:visible!important;
 transition:translate .26s cubic-bezier(.22,.61,.36,1),opacity .18s ease!important;
 will-change:translate!important;
}
#as5 .asNav.asNavSlideRail>.asNavEdgeHandle{
 position:absolute!important;
 left:2px!important;
 top:-28px!important;
 translate:0 0!important;
 transform:none!important;
 width:32px!important;
 min-width:32px!important;
 max-width:32px!important;
 height:28px!important;
 min-height:28px!important;
 padding:0!important;
 margin:0!important;
 flex:0 0 32px!important;
 display:grid!important;
 place-items:center!important;
 border:1px solid rgba(122,148,181,.58)!important;
 border-bottom:0!important;
 border-radius:10px 10px 0 0!important;
 background:rgba(8,18,31,.90)!important;
 color:#d6e2f2!important;
 font:800 19px/1 system-ui,-apple-system,sans-serif!important;
 z-index:4!important;
 box-shadow:0 -4px 16px rgba(0,0,0,.20)!important;
 opacity:.78!important;
 touch-action:pan-y!important;
 user-select:none!important;
 -webkit-user-select:none!important;
 cursor:ew-resize!important;
}
#as5 .asNav.asNavSlideRail>.asNavEdgeHandle:focus-visible{
 outline:2px solid #82b1ff!important;
 outline-offset:2px!important;
}
#as5 .asNav.asNavSlideRail.asNavCollapsed{
 opacity:.80!important;
}
#as5 .asNav.asNavSlideRail.asNavCollapsed>:not(.asNavEdgeHandle){
 opacity:0!important;
 pointer-events:none!important;
}
#as5 .asNav.asNavSlideRail.asNavCollapsed::after{
 content:'';
 position:absolute;
 left:13px;
 top:50%;
 width:4px;
 height:24px;
 translate:0 -50%;
 border-radius:999px;
 background:rgba(196,214,236,.68);
 pointer-events:none;
}
@media(max-width:720px){
 #as5 .asNav.asNavSlideRail>.asNavEdgeHandle{
  top:-25px!important;
  width:34px!important;
  min-width:34px!important;
  max-width:34px!important;
  height:25px!important;
  min-height:25px!important;
  border-radius:9px 9px 0 0!important;
 }
}
@media(prefers-reduced-motion:reduce){
 #as5 .asNav.asNavSlideRail{transition:none!important}
}
`;

const SLIDE_NAV_RUNTIME = `
;(function slideAwayNavRuntime(){
 var marker='${MARKER}';
 var styleId='obligeprops-slide-nav-style';
 var storageKey='obligeprops-nav-collapsed';
 var visibleEdge=36;
 var observer=null;
 var mountedNav=null;

 function ensureStyle(){
  if(document.getElementById(styleId))return;
  var style=document.createElement('style');
  style.id=styleId;
  style.setAttribute('data-runtime',marker);
  style.textContent=${JSON.stringify(SLIDE_NAV_CSS)};
  (document.head||document.documentElement).appendChild(style);
 }

 function savedCollapsed(){try{return window.localStorage.getItem(storageKey)==='1';}catch(_){return false;}}
 function persistCollapsed(value){try{window.localStorage.setItem(storageKey,value?'1':'0');}catch(_){}}

 function mount(){
  ensureStyle();
  var nav=document.querySelector('#as5 .asNav');
  if(!nav||nav===mountedNav||nav.dataset.slideRailReady==='1')return !!nav;
  mountedNav=nav;
  nav.dataset.slideRailReady='1';
  nav.classList.remove('asNavDockOpen');
  nav.classList.add('asNavSlideRail');
  if(!nav.id)nav.id='asMainNav';
  var oldToggle=nav.querySelector('.asNavDockToggle');if(oldToggle)oldToggle.remove();

  var handle=nav.querySelector('.asNavEdgeHandle');
  if(!handle){
   handle=document.createElement('button');
   handle.type='button';
   handle.className='asNavEdgeHandle';
   handle.setAttribute('aria-controls',nav.id);
   nav.prepend(handle);
  }

  var items=Array.from(nav.children).filter(function(node){return node!==handle&&node.matches&&(node.matches('button')||node.matches('a'));});
  var access=new Map(items.map(function(item){return [item,{tabindex:item.getAttribute('tabindex'),ariaHidden:item.getAttribute('aria-hidden')}];}));
  var collapsed=savedCollapsed();
  var offset=0;
  var drag=null;
  var didDrag=false;

  function maxOffset(){
   var rect=nav.getBoundingClientRect();
   var baseLeft=rect.left-offset;
   return Math.max(0,window.innerWidth-visibleEdge-baseLeft);
  }
  function accessItems(open){
   items.forEach(function(item){
    var previous=access.get(item)||{};
    if(open){
     if(previous.tabindex==null)item.removeAttribute('tabindex');else item.setAttribute('tabindex',previous.tabindex);
     if(previous.ariaHidden==null)item.removeAttribute('aria-hidden');else item.setAttribute('aria-hidden',previous.ariaHidden);
    }else{
     item.setAttribute('tabindex','-1');
     item.setAttribute('aria-hidden','true');
    }
   });
  }
  function render(save){
   offset=collapsed?maxOffset():0;
   nav.style.translate=Math.round(offset)+'px 0';
   nav.classList.toggle('asNavCollapsed',collapsed);
   handle.textContent=collapsed?'‹':'›';
   handle.setAttribute('aria-label',collapsed?'Show navigation':'Hide navigation');
   handle.setAttribute('aria-expanded',collapsed?'false':'true');
   handle.setAttribute('title',collapsed?'Slide navigation out':'Hide navigation');
   accessItems(!collapsed);
   if(save)persistCollapsed(collapsed);
  }
  function startDrag(event){
   if(event.button!==undefined&&event.button!==0)return;
   drag={id:event.pointerId,x:event.clientX,start:offset};
   didDrag=false;
   nav.style.transition='none';
   try{handle.setPointerCapture(event.pointerId);}catch(_){}
  }
  function moveDrag(event){
   if(!drag||event.pointerId!==drag.id)return;
   var dx=event.clientX-drag.x;
   if(Math.abs(dx)>5)didDrag=true;
   var max=maxOffset();
   offset=Math.min(max,Math.max(0,drag.start+dx));
   nav.style.translate=Math.round(offset)+'px 0';
  }
  function finishDrag(event){
   if(!drag||event.pointerId!==drag.id)return;
   var dx=event.clientX-drag.x;
   var max=maxOffset();
   nav.style.transition='';
   if(Math.abs(dx)>=24)collapsed=dx>0;
   else collapsed=offset>max/2;
   drag=null;
   requestAnimationFrame(function(){render(true);});
  }
  function cancelDrag(event){
   if(!drag||event.pointerId!==drag.id)return;
   drag=null;
   nav.style.transition='';
   requestAnimationFrame(function(){render(false);});
  }

  handle.addEventListener('pointerdown',startDrag);
  handle.addEventListener('pointermove',moveDrag);
  handle.addEventListener('pointerup',finishDrag);
  handle.addEventListener('pointercancel',cancelDrag);
  handle.addEventListener('click',function(event){
   if(didDrag){didDrag=false;event.preventDefault();return;}
   collapsed=!collapsed;
   render(true);
  });
  handle.addEventListener('keydown',function(event){
   if(event.key==='ArrowRight'&&!collapsed){collapsed=true;render(true);event.preventDefault();}
   if(event.key==='ArrowLeft'&&collapsed){collapsed=false;render(true);event.preventDefault();}
  });
  nav.addEventListener('pointerdown',function(event){
   if(collapsed&&event.target===nav)startDrag(event);
  });
  nav.addEventListener('pointermove',function(event){if(collapsed)moveDrag(event);});
  nav.addEventListener('pointerup',function(event){if(collapsed)finishDrag(event);});
  nav.addEventListener('pointercancel',function(event){if(collapsed)cancelDrag(event);});
  window.addEventListener('resize',function(){if(collapsed)requestAnimationFrame(function(){render(false);});},{passive:true});

  requestAnimationFrame(function(){render(false);});
  return true;
 }

 mount();
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});
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
  return text + '\n' + SLIDE_NAV_RUNTIME + '\n';
}
