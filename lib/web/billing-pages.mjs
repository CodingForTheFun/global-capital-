// Pricing and checkout: the two pages that turn an account into a paying one.
//
// The billing backend already exists and is careful — it verifies the plan
// price against PayPal rather than trusting configuration, refuses to grant Pro
// from anything the customer controls, and stays off entirely until
// BILLING_ENABLED is set alongside a complete subscription chain. What was
// missing was somewhere for a person to actually see a price and click buy, and
// a /checkout page for PayPal to return to — its return URL pointed at a route
// that answered 404.
//
// The price is never written here. It comes from /api/payments/config, which
// reads it from the PayPal plan itself, so this page cannot advertise a number
// the processor would not charge. Until billing is switched on the page says
// the beta is free, which is the truth.
import { PLANS } from '../billing/entitlements.mjs';
import { pageShell, escapeHtml } from './page-shell.mjs';
import { siteOrigin } from './public-surface.mjs';

const CSS = `
.tiers{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:26px 0 8px}
.tier{border:1px solid var(--line);background:var(--panel2);border-radius:14px;padding:20px}
.tier.featured{border-color:#2f6b52;background:linear-gradient(180deg,#0e2a20,#0b1a2c)}
.tier h3{margin:0 0 4px;font-size:15px;letter-spacing:.06em;text-transform:uppercase;color:#8ba2bd}
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
@media(max-width:620px){.tiers{grid-template-columns:1fr}}
`;

const feature = (plan) => [
  `${plan.predictionsPerDay} modelled projections a day`,
  `${plan.askPerDay} follow-up questions a day`,
  plan.staleLineAlerts ? 'Stale line alerts when a sharp book moves' : 'Stale line alerts not included',
  `Up to ${plan.slipSize} saved picks`,
];

function pricingBody() {
  const tier = (plan, { featured = false, priceSlot }) => `
  <div class="tier${featured ? ' featured' : ''}">
    <h3>${escapeHtml(plan.name)}</h3>
    <div class="price">${priceSlot}</div>
    <ul>${feature(plan).map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
    ${featured ? '<button class="cta" id="upgrade" disabled>Checking availability…</button>' : '<a class="cta secondary" href="/">Create a free account</a>'}
  </div>`;

  return `<h1>Pricing</h1>
<p class="sub">The measured research is the product. Pro raises the limits on the parts that cost money to run.</p>
<div class="tiers">
  ${tier(PLANS.free, { priceSlot: '$0 <small>/ forever</small>' })}
  ${tier(PLANS.pro, { featured: true, priceSlot: '<span id="price">—</span>' })}
</div>
<p class="status" id="status" role="status" aria-live="polite"></p>

<div class="callout">
<p><b>Every plan sees the same numbers.</b> Hit rates, line comparisons and sharp-book fair value are counted from real data on both tiers — Pro does not unlock a better answer, it raises the daily limit on the model calls that cost money per request.</p>
<p>Auto Scout does not accept wagers or hold funds. See <a href="/terms">Terms</a> and <a href="/responsible-gaming">Responsible gaming</a>.</p>
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
   price.textContent='Free during beta';
  }
  if(!config.enabled){
   button.textContent='Free during beta';
   say('Pro is not being charged for yet. Beta accounts keep the higher limits at no cost.');
   return;
  }
  if(plan==='pro'){button.textContent='You are on Pro';say('Your account already has Pro.','good');return;}
  if(!signedIn){button.textContent='Sign in to upgrade';button.disabled=false;
   button.onclick=function(){location.href='/';};return;}
  button.textContent='Upgrade to Pro';button.disabled=false;
  button.onclick=function(){
   button.disabled=true;say('Opening PayPal…');
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
  say('Pricing could not be loaded right now.','bad');
 });
 function escapeText(value){var d=document.createElement('div');d.textContent=String(value==null?'':value);return d.innerHTML;}
})();
</script>`;
}

function checkoutBody() {
  return `<h1>Checkout</h1>
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
 // PayPal appends the subscription id to the return URL. Everything that
 // matters is verified server-side against the account before Pro is granted.
 var subscriptionId=params.get('subscription_id')||params.get('subscriptionId');
 if(mode!=='return'||!subscriptionId){
  sub.textContent='Nothing to confirm.';
  say('Open this page from checkout to finish an upgrade.');
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
   sub.textContent='You are on Pro.';
   say('Thank you. Your account has been upgraded.','good');
   back.textContent='Open Auto Scout';back.href='/';
   return;
  }
  sub.textContent='Not confirmed yet.';
  // PayPal can take a moment to activate; the webhook grants it either way.
  say((result&&result.message)||'PayPal has not activated this subscription yet. It will apply automatically once it does.','bad');
 }).catch(function(){
  sub.textContent='Not confirmed yet.';
  say('We could not reach the billing service. If PayPal took payment, your account will be upgraded automatically.','bad');
 });
})();
</script>`;
}

const PAGES = Object.freeze({
  '/pricing': { title: 'Pricing', description: 'What Auto Scout costs, and what each plan includes.', body: pricingBody },
  '/checkout': { title: 'Checkout', description: 'Finish upgrading your Auto Scout account.', body: checkoutBody },
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
