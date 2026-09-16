const SCRIPT_ID = 'oblige-fast-signin';
const STORAGE_KEY = 'obligeprops.rememberedEmail.v1';

const FAST_SIGNIN_SCRIPT = `<script id="${SCRIPT_ID}">
(function(){
  var KEY=${JSON.stringify(STORAGE_KEY)};
  var nativeFetch=window.fetch.bind(window);
  function readEmail(){try{return String(localStorage.getItem(KEY)||'').trim();}catch(_){return '';}}
  function saveEmail(value){try{localStorage.setItem(KEY,String(value||'').trim());}catch(_){}}
  function clearEmail(){try{localStorage.removeItem(KEY);}catch(_){}}
  function showAccountNotice(message){
    if(!message)return;
    var style=document.getElementById('oblige-blocked-notice-style');
    if(!style){
      style=document.createElement('style');style.id='oblige-blocked-notice-style';
      style.textContent='#obligeBlockedNotice{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(1,5,14,.82);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}#obligeBlockedNotice .obnCard{width:min(450px,100%);padding:24px;border:1px solid rgba(94,139,199,.52);border-radius:20px;background:linear-gradient(155deg,#0d2038,#061222);box-shadow:0 28px 80px rgba(0,0,0,.55);color:#eef6ff;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}#obligeBlockedNotice .obnEyebrow{display:block;color:#68a5ff;font-size:10px;font-weight:850;letter-spacing:.14em;text-transform:uppercase}#obligeBlockedNotice h2{margin:8px 0 9px;font-size:23px;line-height:1.15;letter-spacing:-.03em}#obligeBlockedNotice p{margin:0;color:#b7c8db;font-size:14px;line-height:1.6}#obligeBlockedNotice button{width:100%;height:46px;margin-top:20px;border:1px solid #438fff;border-radius:12px;background:linear-gradient(145deg,#1687ff,#1763ef);color:#fff;font:800 14px/1 inherit;cursor:pointer}';
      (document.head||document.documentElement).appendChild(style);
    }
    var old=document.getElementById('obligeBlockedNotice');if(old)old.remove();
    var node=document.createElement('div');node.id='obligeBlockedNotice';node.setAttribute('role','dialog');node.setAttribute('aria-modal','true');node.setAttribute('aria-labelledby','obnTitle');
    node.innerHTML='<div class="obnCard"><span class="obnEyebrow">Account notice</span><h2 id="obnTitle">Account banned</h2><p></p><button type="button">Got it</button></div>';
    node.querySelector('p').textContent=String(message);
    node.querySelector('button').onclick=function(){node.remove();};
    document.body.appendChild(node);setTimeout(function(){node.querySelector('button').focus();},0);
  }
  function inspectLoginResponse(input,response){
    try{
      var url=typeof input==='string'?input:(input&&input.url)||'';
      if(url.indexOf('/api/account/login')<0)return;
      response.clone().json().then(function(data){
        if(!data)return;
        if(data.code==='AUTH_ACCOUNT_DISABLED_NOTICE')showAccountNotice(data.message||'Your account is currently disabled.');
        if(data.code==='AUTH_ACCOUNT_DISABLED'||data.code==='AUTH_ACCOUNT_DISABLED_NOTICE'){
          setTimeout(function(){var err=document.getElementById('err');if(err)err.textContent=data.message||'This account is currently disabled.';},0);
        }
      }).catch(function(){});
    }catch(_){}
  }
  window.fetch=function(input,init){return nativeFetch(input,init).then(function(response){inspectLoginResponse(input,response);return response;});};
  document.addEventListener('DOMContentLoaded',function(){
    var form=document.getElementById('authForm');
    var email=document.getElementById('email');
    var password=document.getElementById('password');
    var remember=document.getElementById('remember');
    var signIn=document.getElementById('tabIn');
    if(!form||!email||!remember)return;

    email.setAttribute('autocomplete','username');
    email.setAttribute('autocapitalize','none');
    email.setAttribute('spellcheck','false');
    if(password)password.setAttribute('autocomplete','current-password');

    var saved=readEmail();
    if(saved){
      email.value=saved;
      remember.checked=true;
      if(signIn)signIn.click();
    }

    remember.addEventListener('change',function(){
      if(!remember.checked)clearEmail();
      else if(email.value.trim())saveEmail(email.value);
    });

    email.addEventListener('change',function(){
      if(remember.checked&&email.value.trim())saveEmail(email.value);
    });

    form.addEventListener('submit',function(){
      var value=email.value.trim();
      if(remember.checked&&value)saveEmail(value);
      else clearEmail();
    });
  });
})();
</script>`;

/**
 * Make returning-customer sign-in faster without weakening auth boundaries.
 * Only the email address is remembered in localStorage. Passwords and session
 * tokens are never written by this client helper; browser password managers and
 * the existing HttpOnly account cookie continue to handle those separately.
 */
export function rememberSigninLanding(html) {
  let out = String(html ?? '');
  if (!out.includes('id="authForm"')) return out;

  out = out.replace('Remember me for 30 days', 'Keep me signed in on this device');

  const rememberLabel = '<label class="check"><input id="remember" type="checkbox" checked> Keep me signed in on this device</label>';
  if (out.includes(rememberLabel) && !out.includes('id="obligeRememberNote"')) {
    out = out.replace(
      rememberLabel,
      `${rememberLabel}<p id="obligeRememberNote" style="margin:-9px 0 16px;color:#8fa4bf;font-size:12px;line-height:1.45">We’ll remember your email on this device. Password saving stays with your browser or password manager.</p>`,
    );
  }

  if (!out.includes(`id="${SCRIPT_ID}"`)) {
    if (out.includes('</head>')) out = out.replace('</head>', `${FAST_SIGNIN_SCRIPT}</head>`);
    else if (out.includes('</body>')) out = out.replace('</body>', `${FAST_SIGNIN_SCRIPT}</body>`);
  }
  return out;
}
