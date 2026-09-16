// Pricing and checkout surfaces for Oblige Props.
//
// Paid amounts are never trusted from page source or browser state. The pricing
// page reads Stripe's configured recurring Prices through the verified server
// endpoint, and Checkout receives only a strict cadence key. Stripe remains the
// source of truth for the amount actually charged.
//
// /checkout remains available for legacy PayPal return traffic so an existing
// Founding Pro customer can still finish the already-supported verification
// flow. New purchases use hosted Stripe Checkout.
import { PLANS } from '../billing/entitlements.mjs';
import { pageShell, escapeHtml } from './page-shell.mjs';
import { siteOrigin } from './public-surface.mjs';

const CSS = `
.launch{border:1px solid #2f6b52;background:linear-gradient(145deg,#102b24,#0b1a2c);border-radius:16px;padding:20px;margin:0 0 24px}
.launchKicker{display:inline-block;margin:0 0 8px;color:#7ef0bd;font-size:11px;font-weight:800;letter-spacing:.15em;text-transform:uppercase}
.launch h1{margin:0 0 8px}.launch p{margin:0;color:#cfe3dd;max-width:68ch}
.tiers{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:26px 0 8px}
.tier{border:1px solid var(--line);background:var(--panel2);border-radius:14px;padding:18px;min-width:0}
.tier.featured{border-color:#2f6b52;background:linear-gradient(180deg,#0e2a20,#0b1a2c);box-shadow:0 18px 45px #0003}
.tier h3{margin:0 0 4px;font-size:14px;letter-spacing:.06em;text-transform:uppercase;color:#8ba2bd}
.tier.featured h3{color:#7ef0bd}
.tier .badge{display:inline-block;margin:2px 0 5px;padding:3px 7px;border-radius:999px;background:#173728;color:#7ef0bd;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.tier .price{font-size:29px;font-weight:800;letter-spacing:-.03em;margin:6px 0 2px;min-height:43px}
.tier .price small{font-size:12px;font-weight:600;color:var(--muted);letter-spacing:0}
.tier .effective{min-height:20px;font-size:11px;color:var(--muted);margin-bottom:8px}
.tier ul{padding-left:18px;margin:12px 0 0}
.tier li{font-size:13px;margin-bottom:6px}
.cta{display:block;width:100%;margin-top:16px;padding:12px 14px;border:0;border-radius:10px;background:var(--blue);color:#fff;font:inherit;font-weight:700;font-size:14px;text-align:center;text-decoration:none;cursor:pointer}
.cta:hover{background:#7ab4ff}.cta.secondary{background:transparent;border:1px solid var(--line);color:var(--text)}
.cta[disabled]{opacity:.55;cursor:default}.status{margin-top:16px;font-size:14px;color:var(--muted);min-height:1.5em}.status.bad{color:#f0a3ae}.status.good{color:#7ef0bd}
.valueNote{margin:20px 0;padding:14px 16px;border:1px solid var(--line);background:#0d1d30;border-radius:12px;color:#cfe3dd;font-size:13px;line-height:1.65}
.funding{margin:30px 0 8px}.funding h2{margin-bottom:6px}.funding>.sub{margin-bottom:16px}.fundingGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.fundingCard{border:1px solid var(--line);background:#0d1d30;border-radius:12px;padding:16px}.fundingCard b{display:block;margin-bottom:5px;color:#eaf2ff}.fundingCard span{display:block;color:var(--muted);font-size:13px;line-height:1.6}
.membershipNote{font-size:13px;color:var(--muted);line-height:1.65;margin-top:14px}
@media(max-width:980px){.tiers{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:620px){.tiers,.fundingGrid{grid-template-columns:1fr}.launch{padding:18px}.tier{padding:18px}}
`;

const feature = (plan) => [
  `${plan.predictionsPerDay} modelled projections a day`,
  `${plan.askPerDay} follow-up questions a day`,
  plan.staleLineAlerts ? 'Stale line alerts when a sharp book moves' : 'Stale line alerts not included',
  `Up to ${plan.slipSize} saved picks`,
];

function pricingBody() {
  const freeTier = `
  <div class="tier">
    <h3>${escapeHtml(PLANS.free.name)}</h3>
    <div class="price">$0 <small>/ forever</small></div>
    <div class="effective">Research first. Upgrade only when you need more.</div>
    <ul>${feature(PLANS.free).map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
    <a class="cta secondary" href="/">Create a free account</a>
  </div>`;

  const paidTier = (key, title, { featured = false, badge = '' } = {}) => `
  <div class="tier${featured ? ' featured' : ''}" data-tier="${key}">
    <h3>${escapeHtml(title)}</h3>
    ${badge ? `<span class="badge">${escapeHtml(badge)}</span>` : ''}
    <div class="price" id="price-${key}">—</div>
    <div class="effective" id="effective-${key}"></div>
    <ul>${feature(PLANS.pro).map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
    <button class="cta upgrade" data-plan="${key}" disabled>Checking availability…</button>
  </div>`;

  return `<section class="launch">
<span class="launchKicker">Oblige Pro</span>
<h1>More research. More alerts. Same verified numbers.</h1>
<p>Pick the billing cadence that fits you. Every paid cadence unlocks the same Pro research limits; longer terms simply lower the effective monthly cost.</p>
</section>
<p class="sub">Free stays useful. Pro is for customers who use Oblige Props heavily enough to need higher limits and line-movement alerts.</p>
<div class="tiers">
  ${freeTier}
  ${paidTier('monthly', 'Pro Monthly')}
  ${paidTier('quarterly', 'Pro 3 Months', { featured: true, badge: 'Popular' })}
  ${paidTier('annual', 'Pro Annual', { badge: 'Best value' })}
</div>
<p class="status" id="status" role="status" aria-live="polite"></p>
<div class="valueNote"><b>One Pro feature set.</b> Monthly, 3-month and annual customers receive the same Pro limits and data. Billing cadence never changes the numbers, model output, or research quality shown to you.</div>

<section class="funding" aria-labelledby="fundingTitle">
<h2 id="fundingTitle">What Pro helps fund</h2>
<p class="sub">Recurring memberships support the live data, storage and monitoring behind the research experience.</p>
<div class="fundingGrid">
 <div class="fundingCard"><b>Live sportsbook data</b><span>Reliable multi-book coverage and faster updates without fabricating missing markets.</span></div>
 <div class="fundingCard"><b>Line history</b><span>Opening numbers, movement and closing lines kept for deeper research.</span></div>
 <div class="fundingCard"><b>Verified research</b><span>More historical context and analysis only when the underlying game data supports it.</span></div>
 <div class="fundingCard"><b>Infrastructure &amp; monitoring</b><span>Hosting, storage, account systems and monitoring that keeps the customer surface healthy.</span></div>
</div>
<p class="membershipNote">Oblige Pro is a subscription for access to Oblige Props features. It is not an investment, does not provide equity or ownership, and does not promise financial returns.</p>
</section>

<div class="callout">
<p><b>Every plan sees the same underlying numbers.</b> Paying raises product limits and unlocks alerts; it does not buy a different statistical answer.</p>
<p>Oblige Props does not accept wagers or hold funds. See <a href="/terms">Terms</a> and <a href="/responsible-gaming">Responsible gaming</a>.</p>
</div>

<script>
(function(){
 var status=document.getElementById('status');
 var buttons=Array.prototype.slice.call(document.querySelectorAll('.upgrade[data-plan]'));
 var csrf=null,signedIn=false,currentPlan='free';
 function say(message,tone){status.textContent=message||'';status.className='status'+(tone?' '+tone:'');}
 function json(url,options){return fetch(url,Object.assign({credentials:'same-origin'},options||{})).then(function(r){return r.json().catch(function(){return {};});});}
 function money(cents,currency){
  var value=Number(cents)/100;
  if(!Number.isFinite(value)) return null;
  try{return new Intl.NumberFormat(undefined,{style:'currency',currency:String(currency||'USD').toUpperCase()}).format(value);}catch(e){return '$'+value.toFixed(2);}
 }
 function cadence(plan){
  if(!plan) return '';
  if(plan.key==='monthly') return '/ month';
  if(plan.key==='quarterly') return '/ 3 months';
  if(plan.key==='annual') return '/ year';
  return '';
 }
 function effective(plan){
  if(!plan) return '';
  var months=plan.key==='annual'?12:(plan.key==='quarterly'?3:1);
  if(months===1) return '';
  var each=money(Math.round(Number(plan.unitAmount)/months),plan.currency);
  return each?('About '+each+' / month'):'';
 }
 function disableAll(label){buttons.forEach(function(button){button.disabled=true;if(label)button.textContent=label;});}
 function openCheckout(planKey,button){
  if(!signedIn){location.href='/?next=/pricing';return;}
  button.disabled=true;say('Opening secure checkout…');
  json('/api/billing/stripe/checkout',{
   method:'POST',
   headers:{'content-type':'application/json','x-csrf-token':csrf||''},
   body:JSON.stringify({plan:planKey})
  }).then(function(result){
   if(result&&result.ok&&result.url){location.href=result.url;return;}
   button.disabled=false;
   if(result&&result.code==='SUBSCRIPTION_EXISTS'){disableAll('Current plan');say('Your account already has Pro access.','good');return;}
   say('Checkout could not be started. Please try again.','bad');
  }).catch(function(){button.disabled=false;say('Checkout could not be started. Please try again.','bad');});
 }
 Promise.all([
  json('/api/billing/stripe/config'),
  json('/api/account/me').catch(function(){return {};})
 ]).then(function(results){
  var config=results[0]||{},account=results[1]||{};
  csrf=account.csrfToken||null;
  signedIn=!!(account.user&&account.user.id);
  currentPlan=(account.entitlement&&account.entitlement.plan&&account.entitlement.plan.id)||
   (account.entitlement&&account.entitlement.plan)||'free';
  var plans={};
  (Array.isArray(config.plans)?config.plans:[]).forEach(function(plan){if(plan&&plan.key)plans[plan.key]=plan;});
  ['monthly','quarterly','annual'].forEach(function(key){
   var plan=plans[key],price=document.getElementById('price-'+key),eff=document.getElementById('effective-'+key),button=document.querySelector('.upgrade[data-plan="'+key+'"]');
   if(plan){
    var amount=money(plan.unitAmount,plan.currency);
    price.innerHTML=(amount||'Unavailable')+' <small>'+cadence(plan)+'</small>';
    eff.textContent=effective(plan);
   }else{price.textContent='Opening soon';eff.textContent='';}
   if(currentPlan==='pro'){button.textContent='Current plan';button.disabled=true;return;}
   if(!config.enabled||!plan){button.textContent='Not open yet';button.disabled=true;return;}
   if(!signedIn){button.textContent='Sign in to upgrade';button.disabled=false;button.onclick=function(){location.href='/?next=/pricing';};return;}
   button.textContent='Choose '+(plan.label||key);
   button.disabled=false;
   button.onclick=function(){openCheckout(key,button);};
  });
  if(currentPlan==='pro'){say('Your account already has Oblige Pro.','good');return;}
  if(!config.enabled){say('Pro checkout is not open yet. Free accounts continue to work while verified billing is configured.');return;}
  if(!config.launchConfigured){say('Some Pro billing cadences are still being configured. Only verified options are enabled.');return;}
  say('Secure subscription checkout is available.');
 }).catch(function(){
  disableAll('Unavailable');
  ['monthly','quarterly','annual'].forEach(function(key){var price=document.getElementById('price-'+key);if(price)price.textContent='Unavailable';});
  say('Pro availability could not be loaded right now.','bad');
 });
})();
</script>`;
}

function checkoutBody() {
  return `<h1>Founding Pro checkout</h1>
<p class="sub" id="sub">Confirming your subscription…</p>
<p class="status" id="status" role="status" aria-live="polite"></p>
<p><a class="cta secondary" id="back" href="/pricing">Back to pricing</a></p>

<script>
(function(){
 var params=new URLSearchParams(location.search);
 var mode=params.get('billing');
 var sub=document.getElementById('sub'),status=document.getElementById('status'),back=document.getElementById('back');
 function say(message,tone){status.textContent=message||'';status.className='status'+(tone?' '+tone:'');}
 if(mode==='cancel'){
  sub.textContent='Checkout cancelled.';
  say('Nothing was charged. You can upgrade whenever you are ready.');
  return;
 }
 // This is retained only for PayPal subscriptions that were already using the
 // legacy return path. New purchases use Stripe hosted Checkout instead.
 var subscriptionId=params.get('subscription_id')||params.get('subscriptionId');
 if(mode!=='return'||!subscriptionId){
  sub.textContent='Nothing to confirm.';
  say('New Oblige Pro purchases finish through secure Stripe Checkout.');
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
   sub.textContent='Your Pro access is active.';
   say('Thank you. Your verified subscription is active.','good');
   back.textContent='Open Oblige Props';back.href='/';
   return;
  }
  sub.textContent='Not confirmed yet.';
  say((result&&result.message)||'The processor has not activated this subscription yet. It will apply automatically once verified.','bad');
 }).catch(function(){
  sub.textContent='Not confirmed yet.';
  say('We could not reach the billing service. If payment completed, access will update automatically after the verified billing event arrives.','bad');
 });
})();
</script>`;
}

const PAGES = Object.freeze({
  '/pricing': { title: 'Oblige Pro', description: 'Compare Free and Oblige Pro membership options and choose a billing cadence.', body: pricingBody },
  '/checkout': { title: 'Subscription Checkout', description: 'Finish an existing Oblige Props subscription checkout.', body: checkoutBody },
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