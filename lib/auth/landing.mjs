import { headTags, siteOrigin } from '../web/public-surface.mjs';
// The conversion landing page shown to signed-out visitors.
// Self-contained: no shared bundle, no build step, no external fetch.
// Blurred abstract shapes decorate the background; they are never real props or invented player data.

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
));

const FEATURES = [
  ['⚡', 'Stale line alerts', 'When a sharp book moves and a retail book has not, the gap is flagged on the card with both prices side by side.'],
  ['◎', 'Calibrated AI projections', 'Every projection is anchored on the player’s own game log, then reconciled against it — and written down so it can be graded later.'],
  ['▲', 'Edge and EV labels', 'Strong, lean or pass, derived in code from the model’s probability and the price a book is actually offering.'],
  ['⊞', 'Multi-book consensus', 'Up to eighteen sportsbooks on one row, so the best number is visible instead of hunted.'],
  ['☲', 'Real hit rates', 'L5, L10, L15, season and head-to-head, counted from completed games. Pushes excluded, never estimated.'],
  ['◈', 'Betslip with Kelly sizing', 'Stake suggestions from your own bankroll, capped, with correlation warnings.'],
];

export function landingPage({ passwordSignup = true, googleSignup = false, beta = true, next = '/' } = {}) {
  const target = escapeHtml(next.startsWith('/') && !next.startsWith('//') ? next : '/');
  const google = googleSignup
    ? `<a class="gBtn" href="/api/account/google/start"><span class="gMark" aria-hidden="true">G</span>Continue with Google</a><div class="or"><span>or</span></div>`
    : '';
  const form = passwordSignup ? `
    <div class="tabs" role="tablist">
      <button role="tab" id="tabUp" aria-selected="true" data-mode="signup">Create free account</button>
      <button role="tab" id="tabIn" aria-selected="false" data-mode="signin">Sign in</button>
    </div>
    <form id="authForm" novalidate>
      <label for="email">Email</label>
      <input id="email" name="email" type="email" autocomplete="email" required>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <label class="check"><input id="remember" type="checkbox" checked> Remember me for 30 days</label>
      <button class="primary" type="submit" id="submit">Create free account</button>
      <p class="err" id="err" role="alert"></p>
    </form>

    <section id="verifyStep" class="authStep" hidden>
      <h3>Verify your email</h3>
      <p class="stepCopy" id="verifyCopy">Enter the 6-digit code sent to your inbox.</p>
      <label for="verifyCode">6-digit code</label>
      <input id="verifyCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}">
      <button class="primary" type="button" id="verifySubmit">Verify email</button>
      <div class="stepActions">
        <button class="textBtn" type="button" id="verifyResend">Send a new code</button>
        <button class="textBtn" type="button" id="verifyBack">Back to sign in</button>
      </div>
      <p class="stepMsg" id="verifyMsg" role="status"></p>
    </section>

    <section id="forgotStep" class="authStep" hidden>
      <h3>Reset your password</h3>
      <p class="stepCopy">Enter the email on the account. We’ll send a 6-digit reset code if the account exists.</p>
      <label for="resetEmail">Email</label>
      <input id="resetEmail" type="email" autocomplete="email">
      <button class="primary" type="button" id="forgotSubmit">Email reset code</button>
      <div class="stepActions"><button class="textBtn" type="button" id="forgotBack">Back to sign in</button></div>
      <p class="stepMsg" id="forgotMsg" role="status"></p>
    </section>

    <section id="resetStep" class="authStep" hidden>
      <h3>Choose a new password</h3>
      <p class="stepCopy">Enter the 6-digit code from your Oblige Props email and choose a new password.</p>
      <label for="resetCode">6-digit code</label>
      <input id="resetCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}">
      <label for="newPassword">New password</label>
      <input id="newPassword" type="password" autocomplete="new-password" minlength="10">
      <label for="confirmPassword">Confirm new password</label>
      <input id="confirmPassword" type="password" autocomplete="new-password" minlength="10">
      <button class="primary" type="button" id="resetSubmit">Reset password</button>
      <div class="stepActions">
        <button class="textBtn" type="button" id="resetResend">Send a new code</button>
        <button class="textBtn" type="button" id="resetBack">Back to sign in</button>
      </div>
      <p class="stepMsg" id="resetMsg" role="status"></p>
    </section>`
    : `<p class="note">Account sign-up is being switched on. Check back shortly.</p>`;

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Auto Scout — Prop Intelligence &amp; Line Discrepancies</title>
<meta name="description" content="Player prop research, verified game logs and sportsbook line comparisons. Free during beta.">
${headTags(siteOrigin(), { path: '/' })}
<style>
*{box-sizing:border-box}
:root{--bg:#081321;--panel:#102139;--line:#29425f;--text:#eaf2ff;--muted:#a5b7ce;--blue:#306fee;--green:#33e49b}
html,body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
a{color:inherit}button,input{font:inherit}button{cursor:pointer}
button:focus-visible,input:focus-visible,a:focus-visible{outline:2px solid #82b1ff;outline-offset:3px}
.teaser{position:fixed;inset:0;z-index:0;overflow:hidden;filter:blur(14px);opacity:.32;pointer-events:none}
.teaser i{position:absolute;display:block;height:96px;border-radius:14px;background:linear-gradient(100deg,#16304f,#0e2036);border:1px solid #2b4468}
.teaser i:nth-child(odd){background:linear-gradient(100deg,#193a5e,#0e2036)}
.teaser i:before{content:"";position:absolute;left:18px;top:22px;width:52px;height:52px;border-radius:50%;background:#24456d}
.teaser i:after{content:"";position:absolute;right:18px;top:34px;width:34%;height:28px;border-radius:8px;background:#1d3a5c}
.wrap{position:relative;z-index:1;max-width:1120px;margin:0 auto;padding:32px 20px 64px}
header{display:flex;align-items:center;gap:12px;margin-bottom:48px}
.logo{width:36px;height:36px;border-radius:10px;background:linear-gradient(145deg,#599bff,#2263da);display:grid;place-items:center;font-weight:800;color:#fff}
.brand{font-size:20px;font-weight:800;letter-spacing:-.4px}.beta{margin-left:auto;border:1px solid #285449;background:#102f2c;color:#7ce4b5;border-radius:999px;padding:7px 13px;font-size:12px;font-weight:700}
.hero{display:grid;grid-template-columns:1.1fr minmax(360px,.9fr);gap:52px;align-items:center;min-height:44vh}
h1{margin:0 0 18px;font-size:44px;line-height:1.08;letter-spacing:-1.6px;font-weight:800}h1 em{font-style:normal;color:var(--green)}
.sub{margin:0 0 26px;font-size:17px;color:var(--muted);max-width:32em}.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:26px;box-shadow:0 30px 80px #0006}
.card h2{margin:0 0 6px;font-size:21px}.card .lead{margin:0 0 20px;color:var(--muted);font-size:14px}
.tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;background:#0b1a2c;border:1px solid var(--line);border-radius:10px;padding:4px;margin-bottom:20px}.tabs button{height:38px;border:0;border-radius:7px;background:transparent;color:var(--muted);font-weight:650;font-size:13px}.tabs button[aria-selected=true]{background:var(--blue);color:#fff}
label{display:block;font-size:13px;color:var(--muted);margin-bottom:7px}
input[type=email],input[type=password],input[type=text]{width:100%;height:46px;background:#0c1b2e;border:1px solid #304762;border-radius:10px;color:var(--text);padding:0 12px;margin-bottom:16px}
.check{display:flex;align-items:center;gap:10px;margin-bottom:18px;color:var(--muted);font-size:13px}.check input{width:18px;height:18px;accent-color:var(--blue)}
.primary{width:100%;height:48px;border:0;border-radius:10px;background:var(--blue);color:#fff;font-weight:700;font-size:15px}.primary:hover{background:#3d7bf5}.primary:disabled{opacity:.55;cursor:wait}
.gBtn{display:flex;align-items:center;justify-content:center;gap:10px;height:48px;border-radius:10px;background:#fff;color:#1f2733;font-weight:650;text-decoration:none}.gMark{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#4285f4;color:#fff;font-weight:800;font-size:13px}.or{display:flex;align-items:center;gap:12px;margin:18px 0;color:#8ba3c1;font-size:12px}.or:before,.or:after{content:"";flex:1;border-top:1px solid var(--line)}
.err{min-height:20px;margin:12px 0 0;color:#ff9aa6;font-size:13px}.err.ok,.stepMsg.ok{color:#7ce4b5}.note{margin:0;color:var(--muted);font-size:14px;line-height:1.7}
.authStep{border-top:1px solid #29425f80;padding-top:4px}.authStep h3{margin:0 0 8px;font-size:21px}.stepCopy{margin:0 0 18px;color:var(--muted);font-size:13px;line-height:1.6}.stepActions{display:flex;justify-content:center;flex-wrap:wrap;gap:14px;margin-top:12px}.textBtn{border:0;background:transparent;color:#8fb9ff;padding:4px;font-weight:650}.stepMsg{min-height:20px;margin:12px 0 0;color:#ff9aa6;font-size:13px;text-align:center}
.features{margin-top:72px;display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.feat{background:#0e1e33cc;border:1px solid var(--line);border-radius:14px;padding:20px}.feat b{display:block;font-size:15.5px;margin:13px 0 7px;letter-spacing:-.2px}.feat span{color:var(--muted);font-size:13.5px;line-height:1.6}.mark{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:#16305a;color:#8fc2ff;font-size:17px}
footer{margin-top:56px;padding-top:24px;border-top:1px solid var(--line);color:#7d93b3;font-size:13px;line-height:1.7}footer .legal-links{margin:12px 0 0}footer .legal-links a{color:#93a9c6;text-decoration:none}footer .legal-links a:hover{color:var(--text);text-decoration:underline}
@media(max-width:900px){.hero{grid-template-columns:1fr;gap:24px;min-height:0}.wrap{max-width:640px;padding:20px 20px 40px}header{margin-bottom:32px;padding-bottom:18px}.features{grid-template-columns:1fr;margin-top:36px;gap:12px}.feat{padding:20px}h1{font-size:clamp(36px,8vw,50px);margin-bottom:18px}.card{padding:24px}.beta{font-size:11px;padding:6px 10px}.brand{font-size:18px}}
/* Welcome page hierarchy; account form and authentication behavior stay intact. */
.wrap{max-width:1200px;padding-top:30px}header{padding-bottom:24px;border-bottom:1px solid #29425f80;margin-bottom:56px}.hero{gap:64px;grid-template-columns:minmax(0,1.2fr) minmax(340px,.85fr)}.eyebrow{font-size:11px;font-weight:700;letter-spacing:.16em;color:#8ddcc3;margin:0 0 20px}h1{font-size:clamp(38px,4.5vw,62px);font-weight:750;line-height:1.06;letter-spacing:-.045em;margin-bottom:24px}.sub{font-size:17px;line-height:1.75;max-width:31em;color:#b2c3d7}.card{border-radius:20px;padding:30px;box-shadow:0 24px 64px #0003;background:linear-gradient(145deg,#15263b,#0e1d30)}.card h2{font-size:24px;letter-spacing:-.025em}.tabs button{height:44px}input[type=email],input[type=password],input[type=text]{height:50px}.primary{height:50px}.features{gap:20px;margin-top:64px}.feat{background:#0d1d30;border-color:#253c53;padding:24px;border-radius:14px}.feat span{color:#b0c2d7;line-height:1.7}.mark{background:#12352f;color:#8ce8c4}.teaser{opacity:.14}footer{color:#a0b3ca}
@media(max-width:900px){.hero{grid-template-columns:1fr;gap:24px}.wrap{max-width:640px;padding:20px 20px 40px}header{margin-bottom:32px;padding-bottom:18px}.eyebrow{font-size:10px;letter-spacing:.12em;margin-bottom:14px}h1{font-size:clamp(36px,8vw,50px);margin-bottom:18px}.sub{font-size:16px;line-height:1.6;margin-bottom:0}.card{padding:24px}.features{margin-top:36px;gap:12px}.feat{padding:20px}.beta{font-size:11px;padding:6px 10px}.brand{font-size:18px}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
</style></head><body>
<div class="teaser" aria-hidden="true" id="teaser"></div>
<div class="wrap">
 <header>
  <div class="logo">A</div><span class="brand">AUTOSCOUT</span>
  <span class="beta">Free during beta</span>
 </header>
 <div class="hero">
  <div>
   <p class="eyebrow">THE PLAYER PROP RESEARCH WORKSPACE</p>
   <h1>Know the player.<br><em>Compare the line.</em></h1>
   <p class="sub">Research recent form, compare sportsbook lines and inspect the evidence behind each prop. Real game logs, clear sources and your saved research in one place.</p>
  </div>
  <div class="card">
   <h2>Get in free</h2>
   <p class="lead">${beta ? 'No card, no trial timer. Beta accounts stay free.' : 'Create an account to open the board.'}</p>
   ${google}${form}
  </div>
 </div>
 <div class="features">
  ${FEATURES.map(([mark, title, copy]) => `<div class="feat"><span class="mark" aria-hidden="true">${mark}</span><b>${escapeHtml(title)}</b><span>${escapeHtml(copy)}</span></div>`).join('')}
 </div>
 <footer>
  Auto Scout is a research tool. It reports what the connected sportsbook feeds and game logs actually returned — it does not take bets, hold funds, or guarantee outcomes. 18+. Past results do not predict future ones.
  <p class="legal-links"><a href="/pricing">Pricing</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/responsible-gaming">Responsible gaming</a> · <a href="tel:1-800-522-4700">Gambling problem? Call 1-800-GAMBLER</a></p>
 </footer>
</div>
<script>
(function(){
 var t=document.getElementById('teaser');
 for(var i=0;i<9;i++){
  var el=document.createElement('i');
  el.style.top=(40+i*118)+'px';
  el.style.left=(i%2?'46%':'4%');
  el.style.width=(i%2?'50%':'42%');
  t.appendChild(el);
 }
 var form=document.getElementById('authForm');
 if(!form)return;
 var mode='signup', next=${JSON.stringify(target)}, pendingEmail='', resetEmail='';
 var tabs=document.querySelector('.tabs');
 var verifyStep=document.getElementById('verifyStep');
 var forgotStep=document.getElementById('forgotStep');
 var resetStep=document.getElementById('resetStep');
 var emailInput=document.getElementById('email');
 var passwordInput=document.getElementById('password');
 var err=document.getElementById('err');
 function setMode(value){
  mode=value;
  document.getElementById('tabUp').setAttribute('aria-selected',String(mode==='signup'));
  document.getElementById('tabIn').setAttribute('aria-selected',String(mode==='signin'));
  document.getElementById('submit').textContent=mode==='signup'?'Create free account':'Sign in';
  passwordInput.setAttribute('autocomplete',mode==='signup'?'new-password':'current-password');
  err.textContent='';err.classList.remove('ok');
 }
 function showStep(step){
  form.hidden=Boolean(step);tabs.hidden=Boolean(step);
  verifyStep.hidden=step!=='verify';forgotStep.hidden=step!=='forgot';resetStep.hidden=step!=='reset';
 }
 function showMain(message,success){
  showStep('');
  if(message){err.textContent=message;err.classList.toggle('ok',Boolean(success));}
 }
 function busy(button,on){if(button)button.disabled=Boolean(on);}
 function codeValue(id){return String(document.getElementById(id).value||'').replace(/\D/g,'').slice(0,6);}
 async function post(path,body){
  var response=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',body:JSON.stringify(body)});
  var data=await response.json().catch(function(){return null;});
  return {response:response,data:data};
 }
 function safeNext(){return next&&next.charAt(0)==='/'&&next.slice(0,2)!=='//' ? next : '/';}
 document.querySelectorAll('[data-mode]').forEach(function(b){b.onclick=function(){setMode(b.dataset.mode);};});
 form.onsubmit=async function(event){
  event.preventDefault();
  var button=document.getElementById('submit');
  busy(button,true);err.textContent='';err.classList.remove('ok');
  try{
   var email=emailInput.value.trim();
   var result=await post(mode==='signup'?'/api/account/register':'/api/account/login',{email:email,password:passwordInput.value,rememberMe:document.getElementById('remember').checked});
   var data=result.data;
   if(data&&data.ok&&data.authenticated!==false&&(data.user||data.authenticated)){location.href=safeNext();return;}
   if(data&&data.requiresVerification){
    pendingEmail=email;
    document.getElementById('verifyCode').value='';
    document.getElementById('verifyCopy').textContent='Enter the 6-digit code sent to '+pendingEmail+'.';
    document.getElementById('verifyMsg').textContent='';
    showStep('verify');document.getElementById('verifyCode').focus();return;
   }
   err.textContent=(data&&data.message)||'That did not work. Please try again.';
  }catch(e){err.textContent='Something went wrong. Please try again.';}
  finally{busy(button,false);}
 };
 document.getElementById('verifySubmit').onclick=async function(){
  var button=this,msg=document.getElementById('verifyMsg'),code=codeValue('verifyCode');
  msg.classList.remove('ok');
  if(code.length!==6){msg.textContent='Enter the 6-digit code from your email.';return;}
  busy(button,true);msg.textContent='Verifying…';
  try{
   var result=await post('/api/account/verify',{email:pendingEmail,code:code});
   if(result.response.ok&&result.data&&result.data.ok){setMode('signin');emailInput.value=pendingEmail;passwordInput.value='';showMain('Email verified. Sign in to continue.',true);passwordInput.focus();return;}
   msg.textContent=(result.data&&result.data.message)||'That code could not be verified.';
  }catch(_){msg.textContent='Could not reach the server. Try again.';}
  finally{busy(button,false);}
 };
 document.getElementById('verifyResend').onclick=async function(){
  var msg=document.getElementById('verifyMsg');msg.classList.remove('ok');msg.textContent='Sending…';
  try{var result=await post('/api/account/resend',{email:pendingEmail});msg.textContent=(result.data&&result.data.message)||'If the account can receive a code, a new one is on the way.';msg.classList.toggle('ok',result.response.ok);}catch(_){msg.textContent='Could not reach the server. Try again.';}
 };
 document.getElementById('verifyBack').onclick=function(){setMode('signin');emailInput.value=pendingEmail;showMain('',false);passwordInput.focus();};
 var forgotLink=document.querySelector('a[href="/reset-password.html"]');
 if(forgotLink){forgotLink.id='forgotPassword';forgotLink.onclick=function(event){event.preventDefault();document.getElementById('resetEmail').value=emailInput.value.trim();document.getElementById('forgotMsg').textContent='';showStep('forgot');document.getElementById('resetEmail').focus();};}
 document.getElementById('forgotSubmit').onclick=async function(){
  var button=this,msg=document.getElementById('forgotMsg');resetEmail=document.getElementById('resetEmail').value.trim();msg.classList.remove('ok');
  if(!resetEmail){msg.textContent='Enter your account email.';return;}
  busy(button,true);msg.textContent='Sending…';
  try{
   var result=await post('/api/account/password/forgot',{email:resetEmail});
   msg.textContent=(result.data&&result.data.message)||'If that email has an account, a code is on its way.';
   if(result.response.ok){document.getElementById('resetCode').value='';document.getElementById('newPassword').value='';document.getElementById('confirmPassword').value='';document.getElementById('resetMsg').textContent='';showStep('reset');document.getElementById('resetCode').focus();}
  }catch(_){msg.textContent='Could not reach the server. Try again.';}
  finally{busy(button,false);}
 };
 document.getElementById('forgotBack').onclick=function(){showMain('',false);emailInput.focus();};
 document.getElementById('resetResend').onclick=async function(){
  var msg=document.getElementById('resetMsg');msg.classList.remove('ok');msg.textContent='Sending…';
  try{var result=await post('/api/account/password/forgot',{email:resetEmail});msg.textContent=(result.data&&result.data.message)||'If that email has an account, a new code is on the way.';msg.classList.toggle('ok',result.response.ok);}catch(_){msg.textContent='Could not reach the server. Try again.';}
 };
 document.getElementById('resetBack').onclick=function(){setMode('signin');emailInput.value=resetEmail;showMain('',false);passwordInput.focus();};
 document.getElementById('resetSubmit').onclick=async function(){
  var button=this,msg=document.getElementById('resetMsg'),code=codeValue('resetCode'),password=document.getElementById('newPassword').value,confirm=document.getElementById('confirmPassword').value;
  msg.classList.remove('ok');
  if(code.length!==6){msg.textContent='Enter the 6-digit reset code from your email.';return;}
  if(!password||password!==confirm){msg.textContent='The new passwords do not match.';return;}
  busy(button,true);msg.textContent='Updating password…';
  try{
   var result=await post('/api/account/password/reset',{email:resetEmail,code:code,password:password});
   if(!(result.response.ok&&result.data&&result.data.ok)){msg.textContent=(result.data&&result.data.message)||'That password could not be updated.';return;}
   msg.textContent='Password updated. Signing you in…';msg.classList.add('ok');
   var signed=await post('/api/account/login',{email:resetEmail,password:password,rememberMe:document.getElementById('remember').checked});
   if(signed.response.ok&&signed.data&&signed.data.ok){location.href=safeNext();return;}
   setMode('signin');emailInput.value=resetEmail;passwordInput.value='';showMain('Password updated. Sign in with your new password.',true);passwordInput.focus();
  }catch(_){msg.textContent='Could not reach the server. Try again.';}
  finally{busy(button,false);}
 };
 setMode('signup');
})();
</script>
</body></html>`;
}