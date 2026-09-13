// Compatibility build command: Oblige Props identity plus targeted presentation fixes.
// Never rewrite payment descriptors, account identifiers, storage keys, or research calculations.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { applySoccerPublicFeedPatches } from './patch-soccer-public-feeds.mjs';

// Public soccer expansion is applied at image-build time so it composes cleanly
// with parallel work on the underlying adapters. A real application checkout
// always includes package.json; tiny isolated test fixtures intentionally do not.
// This keeps production fail-closed if required adapter files disappear while
// allowing checkout-only branding tests to exercise this script in isolation.
if (existsSync('package.json')) applySoccerPublicFeedPatches();

// iOS/WebKit can render the donut strokes while the SVG <text> inherits an
// unreadable fill when the external research stylesheet is late or unavailable.
// Put the percentage's critical paint properties directly on the SVG text so the
// real computed hit rate is always visible in the center of every donut.
{
  const file = 'apex-v2/scout-ui-v5.js';
  if (existsSync(file)) {
    const source = readFileSync(file, 'utf8');
    const from = 'class="asRingMid" text-anchor="middle" dominant-baseline="central"';
    const to = 'class="asRingMid" fill="#f8fafc" font-size="15" font-weight="800" style="fill:#f8fafc!important;opacity:1!important;visibility:visible!important" text-anchor="middle" dominant-baseline="central"';
    if (!source.includes(from) && !source.includes(to)) throw new Error('Oblige Props ring percentage anchor not found.');
    const output = source.includes(to) ? source : source.replace(from, to);
    if (output !== source) writeFileSync(file, output);
  }
}

for (const file of ['public/index.html', 'public/checkout.html']) {
  if (!existsSync(file)) continue;
  const source = readFileSync(file, 'utf8');
  const output = source.replaceAll('ObligePay Edge', 'Oblige Props')
    .replaceAll('AutoProp Scout Pro', 'Oblige Props')
    .replaceAll('AutoProp Scout', 'Oblige Props')
    .replaceAll('Auto Scout', 'Oblige Props')
    .replaceAll('<b>AutoProp</b><em>Scout Pro</em>', '<b>Oblige</b><em>Props</em>')
    .replaceAll('<b>Auto</b><em>Scout</em>', '<b>Oblige</b><em>Props</em>')
    .replaceAll('<b>ObligePay</b><em>Edge</em>', '<b>Oblige</b><em>Props</em>')
    .replace(/<link[^>]+href="\/assets\/edge-theme\.css"[^>]*>/g, '');
  if (output !== source) writeFileSync(file, output);
}
console.log('[oblige-props] research identity ready; ring percentages forced visible; existing accounts and data retained');
