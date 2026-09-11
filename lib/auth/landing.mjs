// The conversion landing page shown to signed-out visitors.
//
// Self-contained: no shared bundle, no build step, no external fetch. It is the
// first thing a stranger sees and the only thing standing between them and the
// product, so it loads from one response and works before anything else does.
//
// The teaser behind the hero is CSS, not real props. Painting live cards there
// would mean either leaking the product the gate exists to protect, or faking
// prop data on a marketing page — and a fabricated card with a real-looking
// player name and price is exactly the thing this app refuses to do anywhere
// else. Blurred abstract shapes suggest the interface without asserting
// anything false about it.

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
    </form>`
    : `<p class="note">Account sign-up is being switched on. Check back shortly.</p>`;

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Auto Scout — Prop Intelligence &amp; Line Discrepancies</title>
<meta name="description" content="Institutional-grade prop intelligence and line discrepancies. Free during beta.">
<style>
*{box-sizing:border-box}
:root{--bg:#081321;--panel:#102139;--line:#29425f;--text:#eaf2ff;--muted:#a5b7ce;--blue:#306fee;--green:#33e49b}
html,body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
a{color:inherit}
button,input{font:inherit}
button{cursor:pointer}
button:focus-visible,input:focus-visible,a:focus-visible{outline:2px solid #82b1ff;outline-offset:3px}
/* The teaser: abstract shapes standing in for the board, never real props. */
.teaser{position:fixed;inset:0;z-index:0;overflow:hidden;filter:blur(14px);opacity:.32;pointer-events:none}
.teaser i{position:absolute;display:block;height:96px;border-radius:14px;background:linear-gradient(100deg,#16304f,#0e2036);border:1px solid #2b4468}
.teaser i:nth-child(odd){background:linear-gradient(100deg,#193a5e,#0e2036)}
.teaser i:before{content:"";position:absolute;left:18px;top:22px;width:52px;height:52px;border-radius:50%;background:#24456d}
.teaser i:after{content:"";position:absolute;right:18px;top:34px;width:34%;height:28px;border-radius:8px;background:#1d3a5c}
.wrap{position:relative;z-index:1;max-width:1120px;margin:0 auto;padding:32px 20px 64px}
header{display:flex;align-items:center;gap:12px;margin-bottom:48px}
.logo{width:36px;height:36px;border-radius:10px;background:linear-gradient(145deg,#599bff,#2263da);display:grid;place-items:center;font-weight:800;color:#fff}
.brand{font-size:20px;font-weight:800;letter-spacing:-.4px}
.beta{margin-left:auto;border:1px solid #285449;background:#102f2c;color:#7ce4b5;border-radius:999px;padding:7px 13px;font-size:12px;font-weight:700}
.hero{display:grid;grid-template-columns:1.1fr minmax(360px,.9fr);gap:52px;align-items:center;min-height:44vh}
h1{margin:0 0 18px;font-size:44px;line-height:1.08;letter-spacing:-1.6px;font-weight:800}
h1 em{font-style:normal;color:var(--green)}
.sub{margin:0 0 26px;font-size:17px;color:var(--muted);max-width:32em}
.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:26px;box-shadow:0 30px 80px #0006}
.card h2{margin:0 0 6px;font-size:21px}
.card .lead{margin:0 0 20px;color:var(--muted);font-size:14px}
.tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;background:#0b1a2c;border:1px solid var(--line);border-radius:10px;padding:4px;margin-bottom:20px}
.tabs button{height:38px;border:0;border-radius:7px;background:transparent;color:var(--muted);font-weight:650;font-size:13px}
.tabs button[aria-selected=true]{background:var(--blue);color:#fff}
label{display:block;font-size:13px;color:var(--muted);margin-bottom:7px}
input[type=email],input[type=password]{width:100%;height:46px;background:#0c1b2e;border:1px solid #304762;border-radius:10px;color:var(--text);padding:0 12px;margin-bottom:16px}
.check{display:flex;align-items:center;gap:10px;margin-bottom:18px;color:var(--muted);font-size:13px}
.check input{width:18px;height:18px;accent-color:var(--blue)}
.primary{width:100%;height:48px;border:0;border-radius:10px;background:var(--blue);color:#fff;font-weight:700;font-size:15px}
.primary:hover{background:#3d7bf5}
.primary:disabled{opacity:.55;cursor:wait}
.gBtn{display:flex;align-items:center;justify-content:center;gap:10px;height:48px;border-radius:10px;background:#fff;color:#1f2733;font-weight:650;text-decoration:none}
.gMark{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#4285f4;color:#fff;font-weight:800;font-size:13px}
.or{display:flex;align-items:center;gap:12px;margin:18px 0;color:#8ba3c1;font-size:12px}
.or:before,.or:after{content:"";flex:1;border-top:1px solid var(--line)}
.err{min-height:20px;margin:12px 0 0;color:#ff9aa6;font-size:13px}
.note{margin:0;color:var(--muted);font-size:14px;line-height:1.7}
.features{margin-top:72px;display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.feat{background:#0e1e33cc;border:1px solid var(--line);border-radius:14px;padding:20px}
.feat b{display:block;font-size:15.5px;margin:13px 0 7px;letter-spacing:-.2px}
.feat span{color:var(--muted);font-size:13.5px;line-height:1.6}
.mark{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:#16305a;color:#8fc2ff;font-size:17px}
footer{margin-top:56px;padding-top:24px;border-top:1px solid var(--line);color:#7d93b3;font-size:13px;line-height:1.7}
@media(max-width:900px){
 .hero{grid-template-columns:1fr;gap:32px}
 h1{font-size:32px;letter-spacing:-1px}
 .features{grid-template-columns:1fr}
 .wrap{padding:22px 16px 48px}
 header{margin-bottom:30px}
}
</style></head><body>
<div class="teaser" aria-hidden="true" id="teaser"></div>
<div class="wrap">
 <header>
  <div class="logo">A</div><span class="brand">AUTOSCOUT</span>
  <span class="beta">Free during beta</span>
 </header>

 <div class="hero">
  <div>
   <h1>Institutional-grade prop intelligence &amp; <em>line discrepancies</em> — free during beta.</h1>
   <p class="sub">Measured hit rates from real game logs, calibrated projections, and the moment a retail book is slower than a sharp one. Create an account to see the board — it costs nothing and takes about ten seconds.</p>
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
 </footer>
</div>
<script>
(function(){
 // Teaser rows, laid out once. Purely decorative.
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
 var mode='signup', next=${JSON.stringify(target)};
 function setMode(value){
  mode=value;
  document.getElementById('tabUp').setAttribute('aria-selected',String(mode==='signup'));
  document.getElementById('tabIn').setAttribute('aria-selected',String(mode==='signin'));
  document.getElementById('submit').textContent=mode==='signup'?'Create free account':'Sign in';
  document.getElementById('password').setAttribute('autocomplete',mode==='signup'?'new-password':'current-password');
  document.getElementById('err').textContent='';
 }
 document.querySelectorAll('[data-mode]').forEach(function(b){b.onclick=function(){setMode(b.dataset.mode);};});
 form.onsubmit=async function(event){
  event.preventDefault();
  var button=document.getElementById('submit'), err=document.getElementById('err');
  button.disabled=true; err.textContent='';
  try{
   var response=await fetch(mode==='signup'?'/api/account/register':'/api/account/login',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({
     email:document.getElementById('email').value.trim(),
     password:document.getElementById('password').value,
     rememberMe:document.getElementById('remember').checked
    })
   });
   var data=await response.json().catch(function(){return null;});
   if(data&&data.ok&&data.authenticated!==false&&(data.user||data.authenticated)){location.href=next;return;}
   if(data&&data.requiresVerification){err.textContent='Check your email for a code, then sign in.';return;}
   err.textContent=(data&&data.message)||'That did not work. Please try again.';
  }catch(e){
   err.textContent='Something went wrong. Please try again.';
  }finally{ button.disabled=false; }
 };
 setMode('signup');
})();
</script>
</body></html>`;
}
