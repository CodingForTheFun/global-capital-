// Compatibility build command: Auto Scout identity plus targeted presentation fixes.
// Never rewrite payment descriptors, account identifiers, storage keys, or research calculations.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { applySoccerPublicFeedPatches } from './patch-soccer-public-feeds.mjs';

// Public soccer expansion is applied at image-build time so it composes cleanly
// with parallel Auto Scout work on the underlying adapters. The patch is guarded
// by exact anchors and fails closed if an adapter shape changes.
applySoccerPublicFeedPatches();

// iOS/WebKit can render the donut strokes while the SVG <text> inherits an
// unreadable fill when the external research stylesheet is late or unavailable.
// Put the percentage's critical paint properties directly on the SVG text so the
// real computed hit rate is always visible in the center of every donut.
{
  const file = 'apex-v2/scout-ui-v5.js';
  if (existsSync(file)) {
    const source = readFileSync(file, 'utf8');
    const from = 'class=\\"asRingMid\\" text-anchor=\\"middle\\" dominant-baseline=\\"central\\"';
    const to = 'class=\\"asRingMid\\" fill=\\"#f8fafc\\" font-size=\\"15\\" font-weight=\\"800\\" style=\\"fill:#f8fafc!important;opacity:1!important;visibility:visible!important\\" text-anchor=\\"middle\\" dominant-baseline=\\"central\\"';
    if (!source.includes(from)) throw new Error('Auto Scout ring percentage anchor not found.');
    const output = source.replace(from, to);
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
console.log('[autoscout] research identity ready; ring percentages forced visible; existing accounts and data retained');
