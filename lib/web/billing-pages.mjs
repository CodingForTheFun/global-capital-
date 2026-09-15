// Pricing and checkout: the two pages that turn an account into a paying one.
//
// The billing backend verifies the plan price against PayPal rather than trusting
// browser state, refuses to grant Pro from anything customer-controlled, and
// stays off until BILLING_ENABLED is set alongside a complete subscription
// verification chain.
//
// The paid price is never written here. It comes from /api/payments/config,
// which re-reads the configured PayPal plan. That lets this page market Founding
// Pro without ever advertising a price the processor would not actually charge.
import { PLANS } from '../billing/entitlements.mjs';
import { pageShell, escapeHtml } from './page-shell.mjs';
import { siteOrigin } from './public-surface.mjs';

const CSS = `
.launch{border:1px solid #2f6b52;background:linear-gradient(145deg,#102b24,#0b1a2c);border-radius:16px;padding:20px;margin:0 0 24px}
.launchKicker{display:inline-block;margin:0 0 8px;color:#7ef0bd;font-size:11px;font-weight:800;letter-spacing:.15em;text-transform:uppercase}
.launch h1{margin:0 0 8px}.launch p{margin:0;color:#cfe3dd;max-width:62ch}
.tiers{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:26px 0 8px}
.tier{border:1px solid var(--line);background:var(--panel2);border-radius:14px;padding:20px}
.tier.featured{border-color:#2f6b52;background:linear-gradient(180deg,#0e2a20,#0b1a2c);box-shadow:0 18px 45px #0003}
.tier h3{margin:0 0 4px;font-size:15px;letter-spacing:.06em;text-transform:uppercase;color:#8ba2bd}
.tier.featured h3{color:#7ef0bd}
.tier .price{font-size:32px;font-weight:800;letter-spacing:-.03em;margin:6px 0 2px}
.tier .price small{font-size:14px;font-weight:600;color:var(--muted);letter-spacing:0}
.tier ul{padding-left:18px;margin:14px 0 0}
.tier li{font-size:14px;margin-bottom:6px}
.cta{display:block;width:100%;margin-top:18px;padding:13px 16px;border:0;border-radius:10px;
 background:var(--blue);color:#fff;font:inherit;font-weight:700;font-size:15px;text-align:center;text-decoration:none;cursor:pointer}
.cta:hover{background:#7ab4ff}
.cta.secondary{background:transparent;border:1px solid var(--line);color:var(--text)}
.cta[disabled]{opacity:.55;cursor:default}
.status{margin-top:16px;font-size:14px;color:var(--muted);min-height:1.5em}
.status.bad{color:#f0a3ae}
.status.good{color:#7ef0bd}
.funding{margin:32px 0 8px}
.funding h2{margin-bottom:6px}.funding>.sub{margin-bottom:16px}
.fundingGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.fundingCard{border:1px solid var(--line);background:#0d1d30;border-radius:12px;padding:16px}
.fundingCard b{display:block;margin-bottom:5px;color:#eaf2ff}.fundingCard span{display:block;color:var(--muted);font-size:13px;line-height:1.6}
.milestone{margin:18px 0 0;border-left:3px solid #33e49b;padding:12px 14px;background:#0d211dcc;border-radius:0 10px 10px 0;color:#cfe3dd;font-size:14px}
.membershipNote{font-size:13px;color:var(--muted);line-height:1.65;margin-top:14px}
@media(max-width:620px){.tiers,.fundingGrid{grid-template-columns:1fr}.launch{padding:18px}.tier{padding:18px}}
`;

const feature = (plan) => [
  `${plan.predictionsPerDay} modelled projections a day`,
  `${plan.askPerDay} follow-up questions a day`,
  plan.staleLineAlerts ? 'Stale line alerts when a sharp book moves' : 'Stale line alerts not included',
  `Up to ${plan.slipSize} saved picks`,
];

function pricingBody() {
  const tier = (plan, { featured = false, priceSlot, displayName = plan.name }) => `
  <div class="tier${featured ? ' featured' : ''}">
    <h3>${escapeHtml(displayName)}</h3>
    <div class="price">${priceSlot}</div>
    <ul>${feature(plan).map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
    ${featured ? '<button class="cta" id="upgrade" disabled>Checking availability…</button>' : '<a class="cta secondary" href="/">Create a free account</a>'}
  </div>`;

  return `<section class="launch">
<span class="launchKicker">Founding access</span>
<h1>Help build the next version of Oblige Props</h1>
<p>Founding Pro memberships help fund faster live sportsbook coverage, permanent line-history storage, reliable infrastructure and deeper verified player research while giving early members the highest customer limits.</p>
</section>
<p class="sub">Keep the useful core free. Upgrade when the extra limits, alerts and continued product development are worth it to you.</p>
<div class="tiers">
  ${tier(PLANS.free, { priceSlot: '$0 <small>/ forever</small>' })}
  ${tier(PLANS.pro, { featured: true, displayName: 'Founding Pro', priceSlot: '<span id="price">—</span>' })}
</div>
<p class="status" id="status" role="status" aria-live="polite"></p>

<section class="funding" aria-labelledby="fundingTitle">
<h2 id="fundingTitle">What Founding Pro helps fund</h2>
<p class="sub">The goal is to let customer revenue pay for the data and infrastructure that make the product better.</p>
<div class="fundingGrid">
 <div class="fundingCard"><b>Faster live sportsbook data</b><span>Broader multi-book coverage and faster updates when a verified commercial feed becomes sustainable.</span></div>
 <div class="fundingCard"><b>Permanent line history</b><span>Store opening numbers, every verified movement and closing lines so Oblige Props builds its own research history over time.</span></div>
 <div class="fundingCard"><b>Deeper verified research</b><span>Improve H2H, fantasy-score history and market coverage only when the underlying game-log components can be proven.</span></div>
 <div class="fundingCard"><b>Infrastructure &amp; monitoring</b><span>Pay for production hosting, data storage, feed health checks and the reliability work paying customers should expect.</span></div>
</div>
<p class="milestone"><b>First milestone:</b> enough recurring Founding Pro memberships to sustainably fund the next live multi-book data upgrade. No fake progress counter — we will only publish revenue-backed milestones we can verify.</p>
<p class="membershipNote">Founding Pro is a subscription for access to Oblige Props features. It is not an investment, does not provide equity or ownership, and does not promise financial returns.</p>
</section>

<div class="callout">
<p><b>Every plan sees the same measured numbers.</b> Hit rates, line comparisons and fair-value calculations remain grounded in the same verified data. Founding Pro raises product limits and unlocks paid-tier conveniences; it does not manufacture a better answer.</p>
<p>Oblige Props does not accept wagers or hold funds. See <a href="/terms">Terms</a> and <a href="/responsible-gaming">Responsible gaming</a>.</p>
</div>

<script>
(function(){
 var status=document.getElementById('status'),button=document.getElementById('upgrade'),price=document.getElementById('price');
 function say(message,tone){status.textContent=message||'';status.className='status'+(tone?' '+tone:'');}
 function json(url,options){return fetch(url,Object.assign({credentials:'same-origin'},options||{})).then(function(r){return r.json().catch(function(){return {};});});}
 var csrf=null,signedIn=false,plan='free';
 Promise.all([
  json('/api/payments/config'),
  json('/api/account/me').catch(function(){return {};})
 ]).then(function(results){
  var config=results[0]||{},account=results[1]||{};
  csrf=account.csrfToken||null;
  signedIn=!!(account.user&&account.user.id);
  plan=(account.entitlement&&account.entitlement.plan&&account.entitlement.plan.id)||'free';
  if(config.price&&config.currency){
   var unit=String(config.intervalUnit||'month').toLowerCase();
   var every=config.intervalCount>1?('/ '+config.intervalCount+' '+unit+'s'):('/ '+unit);
   price.innerHTML=escapeText(config.currency==='USD'?'$'+config.price:config.price+' '+config.currency)+' <small>'+escapeText(every)+'</small>';
  } else {
   price.textContent='Opening soon';
  }
  if(!config.enabled){
   button.textContent='Founding Pro opens soon';
   say('Verified recurring billing is not open yet. Create a free beta account now; paid checkout will only open after the processor plan and webhook are fully verified.');
   return;
  }
  if(plan==='pro'){button.textContent='You are a Founding Member';say('Your account already has Founding Pro. Thank you for helping build Oblige Props.','good');return;}
  if(!signedIn){button.textContent='Sign in to become a Founding Member';button.disabled=false;
   button.onclick=function(){location.href='/';};return;}
  button.textContent='Become a Founding Member';button.disabled=false;
  button.onclick=function(){
   button.disabled=true;say('Opening verified PayPal checkout…');
   json('/api/payments/create-subscription',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf||''},body:'{}'})
    .then(function(r){
     if(r&&r.ok&&r.approvalUrl){location.href=r.approvalUrl;return;}
     button.disabled=false;
     say((r&&r.message)||'Checkout could not be started. Please try again.','bad');
    })
    .catch(function(){button.disabled=false;say('Checkout could not be started. Please try again.','bad');});
  };
 }).catch(function(){
  price.textContent='Unavailable';
  say('Founding Pro availability could not be loaded right now.','bad');
 });
 function escapeText(value){var d=document.createElement('div');d.textContent=String(value==null?'':value);return d.innerHTML;}
})();
</script>`;
}

function checkoutBody() {
  return `<h1>Founding Pro checkout</h1>
<p class="sub" id="sub">Confirming your subscription…</p>
<p class="status" id="status" role="status" aria-live="polite"></p>
<p><a class="cta secondary" id="back" href="/pricing">Back to Founding Pro</a></p>

<script>
(function(){
 var params=new URLSearchParams(location.search);
 var mode=params.get('billing');
 var sub=document.getElementById('sub'),status=document.getElementById('status'),back=document.getElementById('back');
 function say(message,tone){status.textContent=message||'';status.className='status'+(tone?' '+tone:'');}
 if(mode==='cancel'){
  sub.textContent='Checkout cancelled.';
  say('Nothing was charged. You can become a Founding Member whenever you are ready.');
  return;
 }
 // PayPal appends the subscription id to the return URL. Everything that
 // matters is verified server-side against the account before Pro is granted.
 var subscriptionId=params.get('subscription_id')||params.get('subscriptionId');
 if(mode!=='return'||!subscriptionId){
  sub.textContent='Nothing to confirm.';
  say('Open this page from checkout to finish a Founding Pro upgrade.');
  return;
 }
 fetch('/api/account/me',{credentials:'same-origin'}).then(function(r){return r.json();}).then(function(account){
  return fetch('/api/payments/confirm-subscription',{
   method:'POST',credentials:'same-origin',
   headers:{'content-type':'application/json','x-csrf-token':(account&&account.csrfToken)||''},
   body:JSON.stringify({subscriptionId:subscriptionId})
  });
 }).then(function(r){return r.json().catch(function(){return {};});}).then(function(result){
  if(result&&result.ok){
   sub.textContent='You are a Founding Member.';
   say('Thank you. Your Founding Pro access is active.','good');
   back.textContent='Open Oblige Props';back.href='/';
   return;
  }
  sub.textContent='Not confirmed yet.';
  // PayPal can take a moment to activate; the verified webhook grants it either way.
  say((result&&result.message)||'PayPal has not activated this subscription yet. It will apply automatically once it does.','bad');
 }).catch(function(){
  sub.textContent='Not confirmed yet.';
  say('We could not reach the billing service. If PayPal took payment, your account will be upgraded automatically after the verified billing event arrives.','bad');
 });
})();
</script>`;
}

const PAGES = Object.freeze({
  '/pricing': { title: 'Founding Pro', description: 'Support the next stage of Oblige Props and see what Free and Founding Pro include.', body: pricingBody },
  '/checkout': { title: 'Founding Pro Checkout', description: 'Finish upgrading your Oblige Props account to Founding Pro.', body: checkoutBody },
});

export const BILLING_PATHS = Object.freeze(Object.keys(PAGES));

/** Render a billing page, or null when the path is not one. */
export function billingPage(pathname, { origin = siteOrigin() } = {}) {
  const page = PAGES[String(pathname || '').replace(/\/+$/, '') || '/'];
  if (!page) return null;
  return pageShell({
    title: page.title, description: page.description, path: pathname,
    body: page.body(), origin, css: CSS,
  });
}

/**
 * Serve a billing page if this request is for one.
 * @returns true when the response has been written.
 */
export function serveBillingPages(req, res, options = {}) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  const html = billingPage(pathname, options);
  if (!html) return false;
  const body = Buffer.from(html, 'utf8');
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    // Checkout reflects account state, so it must never sit in a shared cache.
    'cache-control': pathname.startsWith('/checkout') ? 'no-store' : 'public, max-age=600',
    'content-length': body.length,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}
