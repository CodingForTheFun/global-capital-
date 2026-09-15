import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SEO_PATHS, seoPage, seoRobotsTxt, seoSitemapXml, serveSeoPage } from '../lib/web/seo-pages.mjs';
import { patchEdgeFrontdoor } from '../lib/edge/frontdoor-patch.mjs';

function fakeRes() {
  const headers = {};
  return {
    statusCode: null,
    headers,
    body: null,
    writeHead(status, extra = {}) { this.statusCode = status; Object.assign(headers, extra); },
    end(body) { this.body = body; },
  };
}

const req = (url, method = 'GET') => ({ url, method });
const origin = 'https://www.obligeprops.com';

test('public SEO pages are indexable, branded and canonical', () => {
  for (const path of SEO_PATHS) {
    const html = seoPage(path, { origin });
    assert.ok(html?.startsWith('<!doctype html>'), `${path} must render HTML`);
    assert.match(html, /OBLIGE PROPS/);
    assert.match(html, /name="robots" content="index,follow/);
    assert.ok(html.includes(`<link rel="canonical" href="${origin}${path}">`), `${path} needs its canonical URL`);
    assert.ok(html.includes('FAQPage'), `${path} needs structured FAQ context`);
    assert.doesNotMatch(html, />AUTOSCOUT</i, `${path} must use the public brand`);
  }
});

test('SEO pages cross-link so crawlers can discover the research section', () => {
  for (const path of SEO_PATHS) {
    const html = seoPage(path, { origin });
    const linkedPeers = SEO_PATHS.filter(peer => peer !== path).filter(peer => html.includes(`href="${peer}"`));
    assert.equal(linkedPeers.length, SEO_PATHS.length - 1, `${path} should link every peer page`);
    assert.ok(html.includes('href="/"'), `${path} must link the account landing page`);
  }
});

test('SEO robots and sitemap expose every public research page', () => {
  const robots = seoRobotsTxt(origin);
  const sitemap = seoSitemapXml(origin, new Date('2026-09-14T00:00:00Z'));
  for (const path of SEO_PATHS) {
    assert.ok(robots.includes(`Allow: ${path}`), `${path} missing from robots`);
    assert.ok(sitemap.includes(`<loc>${origin}${path}</loc>`), `${path} missing from sitemap`);
  }
  assert.match(robots, /Disallow: \/apex/);
  assert.match(robots, /Disallow: \/api\//);
});

test('serveSeoPage handles SEO pages, crawler files and HEAD only', () => {
  for (const path of [...SEO_PATHS, '/robots.txt', '/sitemap.xml']) {
    const res = fakeRes();
    assert.equal(serveSeoPage(req(path), res, { origin }), true, `${path} must be served`);
    assert.equal(res.statusCode, 200);
    assert.ok(Number(res.headers['content-length']) > 0);
  }
  const head = fakeRes();
  assert.equal(serveSeoPage(req('/nfl-player-props', 'HEAD'), head, { origin }), true);
  assert.equal(head.body, undefined);
  assert.equal(serveSeoPage(req('/apex'), fakeRes(), { origin }), false);
  assert.equal(serveSeoPage(req('/api/health'), fakeRes(), { origin }), false);
  assert.equal(serveSeoPage(req('/nfl-player-props', 'POST'), fakeRes(), { origin }), false);
});

test('runtime frontdoor puts SEO pages before the existing public surface and account gate', () => {
  const source = readFileSync(new URL('../frontdoor-prod.mjs', import.meta.url), 'utf8');
  const patched = patchEdgeFrontdoor(source);
  assert.ok(patched.includes("import { serveSeoPage } from './lib/web/seo-pages.mjs';"));
  const seo = patched.indexOf('if (serveSeoPage(req, res, { origin: SITE_ORIGIN })) return;');
  const publicSurface = patched.indexOf('if (servePublicSurface(req, res, { origin: SITE_ORIGIN })) return;');
  const gate = patched.indexOf('if (await maybeServeGate(req, res)) return;');
  assert.ok(seo >= 0 && seo < publicSurface && publicSurface < gate, 'SEO crawler routes must stay public without moving the account gate');
});
