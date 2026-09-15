import { landingPage as baseLandingPage } from './landing.mjs';

const BRAND_REPLACEMENTS = Object.freeze([
  [
    '<title>Auto Scout — Prop Intelligence &amp; Line Discrepancies</title>',
    '<title>Oblige Props — Prop Intelligence &amp; Line Discrepancies</title>',
  ],
  [
    '<div class="logo">A</div><span class="brand">AUTOSCOUT</span>',
    '<div class="logo">O</div><span class="brand">OBLIGE PROPS</span>',
  ],
  [
    'Auto Scout is a research tool.',
    'Oblige Props is a research tool.',
  ],
]);

/**
 * Production-only presentation wrapper for the account landing page.
 * Authentication, signup, routing and account behavior remain owned by
 * landing.mjs; this wrapper only prevents stale Auto Scout branding from
 * reaching Oblige Props customers.
 */
export function landingPage(options) {
  let html = baseLandingPage(options);
  for (const [legacy, current] of BRAND_REPLACEMENTS) {
    html = html.replace(legacy, current);
  }
  return html;
}
