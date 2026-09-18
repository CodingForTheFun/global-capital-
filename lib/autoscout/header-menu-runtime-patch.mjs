const MARKER = '__OBLIGE_LIVE_HEADER_MENU_V1__';

const RUNTIME = `
;(function obligeLiveHeaderMenu(){
  var marker='__OBLIGE_LIVE_HEADER_MENU_V1__';
  if(window[marker])return;
  window[marker]=true;

  var style=document.createElement('style');
  style.id='oblige-live-header-menu-style';
  style.textContent=\`
#as5 .asRight{
  grid-area:actions!important;
  display:flex!important;
  align-items:center!important;
  justify-self:end!important;
  min-width:38px!important;
  max-width:none!important;
  overflow:visible!important;
  margin-left:8px!important;
}
#as5 .asRight .asProfileMenu{
  position:relative!important;
  z-index:70!important;
  margin:0!important;
}
#as5 .asRight .asProfileMenu>summary{
  display:grid!important;
  place-items:center!important;
  width:38px!important;
  height:38px!important;
  min-width:38px!important;
  padding:0!important;
  border:1px solid rgba(255,255,255,.10)!important;
  border-radius:10px!important;
  background:#0c0f14!important;
  color:#dce5f2!important;
  box-shadow:none!important;
  cursor:pointer!important;
  list-style:none!important;
  overflow:visible!important;
  font-size:0!important;
}
#as5 .asRight .asProfileMenu>summary::-webkit-details-marker{display:none!important}
#as5 .asRight .asProfileMenu>summary::marker{content:""!important}
#as5 .asRight .asProfileMenu>summary:hover,
#as5 .asRight .asProfileMenu>summary:focus-visible,
#as5 .asRight .asProfileMenu[open]>summary{
  border-color:rgba(97,232,173,.48)!important;
  background:#111722!important;
  outline:none!important;
  box-shadow:0 0 0 2px rgba(97,232,173,.08)!important;
}
#as5 .asHeaderMenuIcon{
  display:grid!important;
  width:18px!important;
  height:14px!important;
  align-content:space-between!important;
}
#as5 .asHeaderMenuIcon i{
  display:block!important;
  width:18px!important;
  height:1.5px!important;
  border-radius:999px!important;
  background:currentColor!important;
}
#as5 .asRight .asProfileAvatarShell,
#as5 .asRight .asProfileCameraBadge{
  display:none!important;
}
#as5 .asRight .asProfileDropdown{
  right:0!important;
  left:auto!important;
  margin-top:8px!important;
}
@media(max-width:760px){
  #as5 .asBar{
    grid-template-columns:auto minmax(0,1fr) 38px!important;
    grid-template-areas:"brand search actions" "filters filters filters"!important;
    column-gap:8px!important;
  }
  #as5 .asGrow,
  #as5 .asStatus{
    display:none!important;
  }
  #as5 .asHeaderSearch{
    min-width:0!important;
    width:100%!important;
    margin:0!important;
  }
  #as5 .asRight{
    width:38px!important;
    min-width:38px!important;
    max-width:38px!important;
    margin-left:0!important;
    overflow:visible!important;
  }
  #as5 .asRight .asProfileMenu>summary{
    width:36px!important;
    height:36px!important;
    min-width:36px!important;
    border-radius:9px!important;
  }
  #as5 .asRight .asProfileDropdown{
    position:fixed!important;
    top:52px!important;
    right:8px!important;
    width:min(290px,calc(100vw - 16px))!important;
  }
}
\`;
  (document.head||document.documentElement).appendChild(style);

  function syncLabel(menu,summary){
    var open=!!menu.open;
    summary.setAttribute('aria-label',open?'Close menu':'Open menu');
    summary.setAttribute('title',open?'Close menu':'Menu');
    summary.setAttribute('aria-expanded',String(open));
  }

  function ensure(){
    var root=document.getElementById('as5');
    if(!root)return;
    var bar=root.querySelector('.asBar');
    var menu=root.querySelector('#asProfileMenu');
    if(!bar||!menu)return;

    var right=bar.querySelector('.asRight');
    if(!right){
      right=document.createElement('div');
      right.className='asRight';
      bar.appendChild(right);
    }
    if(menu.parentElement!==right)right.appendChild(menu);

    var summary=menu.querySelector('summary');
    if(!summary)return;
    if(summary.dataset.obligeHeaderMenu!=='1'){
      summary.dataset.obligeHeaderMenu='1';
      summary.innerHTML='<span class="asHeaderMenuIcon" aria-hidden="true"><i></i><i></i><i></i></span>';
    }
    syncLabel(menu,summary);

    if(menu.dataset.obligeHeaderMenuBound!=='1'){
      menu.dataset.obligeHeaderMenuBound='1';
      menu.addEventListener('toggle',function(){syncLabel(menu,summary);});
    }
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ensure,{once:true});
  else ensure();

  var timer=0;
  new MutationObserver(function(){
    clearTimeout(timer);
    timer=setTimeout(ensure,16);
  }).observe(document.documentElement,{subtree:true,childList:true});
}());
`;

export function patchHeaderMenuUi(source) {
  const input = String(source || '');
  if (input.includes(MARKER)) return input;
  if (!input.includes('class="asBar"')) {
    throw new Error('Live header menu patch could not locate the production header.');
  }
  if (!input.includes('id="asProfileMenu"')) {
    throw new Error('Live header menu patch could not locate the existing account menu.');
  }
  return input + '\n' + RUNTIME + '\n';
}
