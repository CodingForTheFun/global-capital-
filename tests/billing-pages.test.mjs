import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { billingPage, BILLING_PATHS, serveBillingPages } from '../lib/web/billing-pages.mjs';
import { PLANS } from '../lib/billing/entitlements.mjs';
import { robotsTxt, sitemapXml } from '../lib/web/public-surface.mjs';

function fakeRes() {
  const headers = {};
  return {
    statusCode: null, headers, body: null,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    hasHeader(k) { return Object.prototype.hasOwnProperty.call(headers, k.toLowerCase()); },
    writeHead(status, extra = {}) { this.statusCode = status; Object.assign(headers, extra); },
    end(body) { this.body = body; },
  };
}
const req = (url, method = 'GET') => ({ url, method });

test('pricing and legacy checkout both render', () => {
  for (const path of BILLING_PATHS) {
    const html = billingPage(path, { origin: 'https://example.test' });
    assert.ok(html && html.startsWith('<!doctype html>'), `${path} must render`);
  }
});

// Existing PayPal return URLs still land here. New purchases use Stripe.
test('/checkout remains available for legacy PayPal reconciliation', () => {
  const html = billingPage('/checkout');
  assert.ok(html);
  assert.match(html, /billing=cancel|'cancel'/);
  assert.match(html, /confirm-subscription/);
  assert.match(html, /subscription_id/);
});

test('checkout is never cached, pricing may be', () => {
  const checkout = fakeRes();
  serveBillingPages(req('/checkout?billing=return'), checkout);
  assert.equal(checkout.headers['cache-control'], 'no-store');
  const pricing = fakeRes();
  serveBillingPages(req('/pricing'), pricing);
  assert.match(pricing.headers['cache-control'], /public/);
});

// Paid amounts come from Stripe Price objects that the server re-reads. The
// page must never advertise a hand-written paid amount that checkout may not charge.
test('paid prices are not hard-coded into the pricing page', () => {
  const source = readFileSync(new URL('../lib/web/billing-pages.mjs', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('function pricingBody'), source.indexOf('function checkoutBody'));
  assert.match(billingPage('/pricing'), /\/api\/billing\/stripe\/config/, 'paid prices must come from verified Stripe config');
  assert.match(body, /unitAmount/);
  assert.doesNotMatch(body, /\$\s?(?:14\.99|37\.99|129\.99)/, 'paid launch prices must not be duplicated in page source');
});

test('the pricing surface offers all three Pro billing cadences', () => {
  const html = billingPage('/pricing');
  for (const key of ['monthly', 'quarterly', 'annual']) {
    assert.match(html, new RegExp(`data-plan="${key}"`));
    assert.match(html, new RegExp(`price-${key}`));
  }
  assert.match(html, /Pro Monthly/);
  assert.match(html, /Pro 3 Months/);
  assert.match(html, /Pro Annual/);
});

test('the plan limits shown come from PLANS, not invented prose', () => {
  const html = billingPage('/pricing');
  for (const plan of [PLANS.free, PLANS.pro]) {
    assert.ok(html.includes(String(plan.predictionsPerDay)), `${plan.id} projections limit missing`);
    assert.ok(html.includes(String(plan.askPerDay)), `${plan.id} ask limit missing`);
    assert.ok(html.includes(plan.name), `${plan.id} name missing`);
  }
});

test('the page sends CSRF on Stripe checkout and the retained PayPal confirmation path', () => {
  const pricing = billingPage('/pricing');
  assert.match(pricing, /\/api\/billing\/stripe\/checkout/);
  assert.match(pricing, /x-csrf-token/);
  assert.match(pricing, /\/api\/account\/me/);
  const legacy = billingPage('/checkout');
  assert.match(legacy, /\/api\/payments\/confirm-subscription/);
  assert.match(legacy, /x-csrf-token/);
  assert.match(legacy, /\/api\/account\/me/);
});

test('requests are same-origin with credentials, as the backend demands', () => {
  for (const path of BILLING_PATHS) {
    const html = billingPage(path);
    if (!html.includes('fetch(')) continue;
    assert.match(html, /same-origin/, `${path} must send the session cookie`);
  }
});

// The privacy policy claims no page loads an external resource. Hosted Checkout
// is navigated to only after a customer clicks; no Stripe script is embedded.
test('the billing pages load nothing from another origin', () => {
  for (const path of BILLING_PATHS) {
    const html = billingPage(path);
    const external = html.match(/(?:src|href)="https?:\/\/[^"]+"/g) || [];
    const offsite = external.filter(tag => !tag.includes('example.test') && !tag.includes('www.obligeprops.com'));
    assert.deepEqual(offsite, [], `${path} must not load offsite resources`);
  }
});

test('billing pages state that the product takes no wagers', () => {
  const html = billingPage('/pricing');
  assert.match(html, /does not accept wagers|not accept wagers/i);
  assert.match(html, /href="\/responsible-gaming"/);
  assert.match(html, /href="\/terms"/);
});

test('unrelated paths fall through', () => {
  for (const path of ['/', '/apex', '/api/payments/config', '/pricing/extra']) {
    assert.equal(serveBillingPages(req(path), fakeRes()), false, `${path} must not be captured`);
  }
  assert.equal(serveBillingPages(req('/pricing', 'POST'), fakeRes()), false);
});

test('pricing is advertised to crawlers and checkout is not', () => {
  const robots = robotsTxt('https://example.test');
  assert.match(robots, /Allow: \/pricing/);
  assert.match(robots, /Disallow: \/checkout/);
  const xml = sitemapXml('https://example.test');
  assert.ok(xml.includes('<loc>https://example.test/pricing</loc>'));
  assert.ok(!xml.includes('/checkout'), 'a transactional page does not belong in the sitemap');
});

// Billing APIs are mounted by the edge patch, which is what production runs.
// The pages are mounted in the frontdoor itself. Mounting the API in both places
// previously produced duplicate imports and a production boot failure.
test('billing APIs are mounted exactly once, by the edge patch', () => {
  const edge = readFileSync(new URL('../lib/edge/frontdoor-patch.mjs', import.meta.url), 'utf8');
  assert.match(edge, /handleBillingRoutes\(req, res, billingUrl/, 'the PayPal compatibility API must remain mounted');
  assert.match(edge, /createStripeBillingHandler\(/, 'Stripe must be mounted by the edge patch');
  const frontdoor = readFileSync(new URL('../frontdoor-prod.mjs', import.meta.url), 'utf8');
  assert.ok(!frontdoor.includes('handleBillingRoutes'), 'the frontdoor must not mount PayPal twice');
  assert.ok(!frontdoor.includes('createStripeBillingHandler'), 'the frontdoor must not mount Stripe twice');
});

test('the frontdoor mounts the billing pages', () => {
  const source = readFileSync(new URL('../frontdoor-prod.mjs', import.meta.url), 'utf8');
  assert.match(source, /serveBillingPages\(req, res/, 'the billing pages must be mounted');
});

// The generated runtime is what actually boots; a duplicate import there is a
// syntax error that takes the whole site down on deploy.
test('the generated runtime declares each billing import once', async () => {
  const { patchEdgeFrontdoor } = await import('../lib/edge/frontdoor-patch.mjs');
  const runtime = patchEdgeFrontdoor(readFileSync(new URL('../frontdoor-prod.mjs', import.meta.url), 'utf8'));
  const imports = runtime.match(/^import \{[^}]*\} from '[^']+';$/gm) || [];
  const names = imports.flatMap(line => line.slice(line.indexOf('{') + 1, line.indexOf('}')).split(',').map(n => n.trim().split(/\s+as\s+/).pop()).filter(Boolean));
  const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
  assert.deepEqual([...new Set(duplicates)], [], 'the runtime must not declare an identifier twice');
});

test('the landing page links pricing', () => {
  const landing = readFileSync(new URL('../lib/auth/landing.mjs', import.meta.url), 'utf8');
  assert.match(landing, /href="\/pricing"/);
});