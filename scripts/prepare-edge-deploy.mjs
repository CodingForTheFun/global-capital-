// Compatibility build command: Auto Scout identity plus targeted presentation fixes.
// Never rewrite payment descriptors, account identifiers, storage keys, or research calculations.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { applySoccerPublicFeedPatches } from './patch-soccer-public-feeds.mjs';

// Public soccer expansion is applied at image-build time so it composes cleanly
// with parallel Auto Scout work on the underlying adapters. The patch is guarded
// by exact anchors and fails closed if an adapter shape changes.
applySoccerPublicFeedPatches();

// Safari/iOS has continued to paint the donut circles while dropping the SVG
// <text> node. Do not rely on SVG text for the percentage. Wrap the SVG in a
// positioned HTML element and render the real computed percentage as an HTML
// overlay. This keeps the number visible even if SVG text styling/rendering fails.
{
  const file = 'apex-v2/scout-ui-v5.js';
  if (existsSync(file)) {
    const source = readFileSync(file, 'utf8');
    const ringStart = '<div class="asRing" title="Historical hit rates, not a win prediction"><svg class="asRingSvg"';
    const ringStartReplacement = '<div class="asRing" title="Historical hit rates, not a win prediction"><span class="asRingGraphic" style="position:relative;display:inline-grid;place-items:center;flex:none"><svg class="asRingSvg"';
    const svgText = '<text x="32" y="32" class="asRingMid" text-anchor="middle" dominant-baseline="central">\'+Math.round(over)+\'%</text>';
    const ringEnd = '</svg><div class="asRingText">';
    const ringEndReplacement = '</svg><span class="asRingCenter" aria-hidden="true" style="position:absolute;inset:0;display:grid;place-items:center;color:#f8fafc;font:800 15px/1 Inter,system-ui,sans-serif;z-index:2;pointer-events:none;text-shadow:0 1px 2px rgba(0,0,0,.35)">\'+Math.round(over)+\'%</span></span><div class="asRingText">';

    if (!source.includes(ringStart)) throw new Error('Auto Scout ring start anchor not found.');
    if (!source.includes(svgText)) throw new Error('Auto Scout SVG percentage anchor not found.');
    if (!source.includes(ringEnd)) throw new Error('Auto Scout ring end anchor not found.');

    const output = source
      .replace(ringStart, ringStartReplacement)
      .replace(svgText, '')
      .replace(ringEnd, ringEndReplacement);
    if (output !== source) writeFileSync(file, output);
  }
}

for (const file of ['public/index.html', 'public/checkout.html']) {
  if (!existsSync(file)) continue;
  const source = readFileSync(file, 'utf8');
  const output = source.replaceAll('ObligePay Edge', 'Auto Scout')
    .replaceAll('AutoProp Scout Pro', 'Auto Scout')
    .replaceAll('AutoProp Scout', 'Auto Scout')
    .replaceAll('<b>AutoProp</b><em>Scout Pro</em>', '<b>Auto</b><em>Scout</em>')
    .replaceAll('<b>ObligePay</b><em>Edge</em>', '<b>Auto</b><em>Scout</em>')
    .replace(/<link[^>]+href="\/assets\/edge-theme\.css"[^>]*>/g, '');
  if (output !== source) writeFileSync(file, output);
}
console.log('[autoscout] research identity ready; donut percentage rendered as HTML overlay; existing accounts and data retained');
