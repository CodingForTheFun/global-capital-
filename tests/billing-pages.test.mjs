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

test('pricing and checkout both render', () => {
  for (const path of BILLING_PATHS) {
    const html = billingPage(path, { origin: 'https://example.test' });
    assert.ok(html && html.startsWith('<!doctype html>'), `${path} must render`);
  }
});

// PayPal's configured return URL is ${base}/checkout, and that route answered
// 404 before this existed, stranding anyone who actually paid.
test('/checkout exists, because PayPal returns to it', () => {
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

// The plan price is verified against PayPal by /api/payments/config. A number
// written into this page could advertise something the processor would not
// charge, so there must not be one.
test('no price is hard-coded into the pricing page', () => {
  const source = readFileSync(new URL('../lib/web/billing-pages.mjs', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('function pricingBody'), source.indexOf('function checkoutBody'));
  assert.doesNotMatch(body, /\$\s?\d+(\.\d+)?\s*(\/|per|a month|mo\b)/i, 'a currency amount must not be written here');
  assert.match(billingPage('/pricing'), /\/api\/payments\/config/, 'the price must be fetched from the verified config');
});

test('the plan limits shown come from PLANS, not from prose', () => {
  const html = billingPage('/pricing');
  for (const plan of [PLANS.free, PLANS.pro]) {
    assert.ok(html.includes(String(plan.predictionsPerDay)), `${plan.id} projections limit missing`);
    assert.ok(html.includes(String(plan.askPerDay)), `${plan.id} ask limit missing`);
    assert.ok(html.includes(plan.name), `${plan.id} name missing`);
  }
});

test('the page sends the CSRF header both endpoints require', () => {
  for (const path of BILLING_PATHS) {
    const html = billingPage(path);
    if (!/api\/payments\/(create|confirm)-subscription/.test(html)) continue;
    assert.match(html, /x-csrf-token/, `${path} must send the CSRF header`);
    assert.match(html, /\/api\/account\/me/, `${path} must fetch the CSRF token`);
  }
});

test('requests are same-origin with credentials, as the backend demands', () => {
  for (const path of BILLING_PATHS) {
    const html = billingPage(path);
    if (!html.includes('fetch(')) continue;
    assert.match(html, /same-origin/, `${path} must send the session cookie`);
  }
});

// The privacy policy claims no page loads an external resource.
test('the billing pages load nothing from another origin', () => {
  for (const path of BILLING_PATHS) {
    const html = billingPage(path);
    const external = html.match(/(?:src|href)="https?:\/\/[^"]+"/g) || [];
    const offsite = external.filter(tag => !tag.includes('example.test') && !tag.includes('www.obligepay.com'));
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

// The billing API is mounted by the edge patch, which is what production runs.
// The pages are mounted in the frontdoor itself. Mounting the API in both
// places produced a duplicate import that refused to boot, so this pins which
// side owns which and keeps that collision from coming back.
test('the billing API is mounted exactly once, by the edge patch', () => {
  const edge = readFileSync(new URL('../lib/edge/frontdoor-patch.mjs', import.meta.url), 'utf8');
  assert.match(edge, /handleBillingRoutes\(req, res, billingUrl/, 'the edge patch must mount the billing API');
  const frontdoor = readFileSync(new URL('../frontdoor-prod.mjs', import.meta.url), 'utf8');
  assert.ok(!frontdoor.includes('handleBillingRoutes'),
    'the frontdoor must not mount it too — two imports of the same name will not parse');
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
