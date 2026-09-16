import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchEdgeFrontdoor } from '../lib/edge/frontdoor-patch.mjs';

const source = readFileSync(new URL('../frontdoor-prod.mjs', import.meta.url), 'utf8');
const patched = patchEdgeFrontdoor(source);

test('signed-out landing exposes the Oblige Props search identity in raw HTML', () => {
  assert.ok(patched.includes('Oblige Props — Player Prop Research & Sportsbook Line Comparison'));
  assert.ok(patched.includes('Research NFL, NBA, WNBA, NCAAF and MLB player props with verified game logs, hit rates and sportsbook line comparison in Oblige Props.'));
  assert.doesNotMatch(patched, /const optimizePublicLanding[\s\S]*?<title>Auto Scout/i);
});

test('signed-out landing links crawlers into the public research cluster', () => {
  for (const path of [
    '/player-prop-research',
    '/nfl-player-props',
    '/nba-player-props',
    '/sportsbook-line-comparison',
  ]) {
    assert.ok(patched.includes(`href=\\"${path}\\"`) || patched.includes(`href="${path}"`), `${path} must be linked from the landing page transform`);
  }
});

test('SEO landing transform does not move or weaken the account gate', () => {
  const publicSurface = patched.indexOf('if (servePublicSurface(req, res, { origin: SITE_ORIGIN })) return;');
  const gate = patched.indexOf('if (await maybeServeGate(req, res)) return;');
  assert.ok(publicSurface >= 0 && gate > publicSurface, 'public crawler surfaces stay before the existing account gate');
  assert.ok(patched.includes("const landingPage = options => optimizePublicLanding(rememberSigninLanding(researchLanding(originalLandingPage(options))));"));
});
