const SCRIPT_ID = 'oblige-fast-signin';
const STORAGE_KEY = 'obligeprops.rememberedEmail.v1';

const FAST_SIGNIN_SCRIPT = `<script id="${SCRIPT_ID}">
(function(){
  var KEY=${JSON.stringify(STORAGE_KEY)};
  function readEmail(){try{return String(localStorage.getItem(KEY)||'').trim();}catch(_){return '';}}
  function saveEmail(value){try{localStorage.setItem(KEY,String(value||'').trim());}catch(_){}}
  function clearEmail(){try{localStorage.removeItem(KEY);}catch(_){}}
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
