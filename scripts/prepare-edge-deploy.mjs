// Compatibility build command: Auto Scout identity only. Never rewrite the v5 app,
// payment descriptors, account identifiers, storage keys, or research calculations.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { applySoccerPublicFeedPatches } from './patch-soccer-public-feeds.mjs';

// Public soccer expansion is applied at image-build time so it composes cleanly
// with parallel Auto Scout work on the underlying adapters. The patch is guarded
// by exact anchors and fails closed if an adapter shape changes.
applySoccerPublicFeedPatches();

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
console.log('[autoscout] research identity ready; existing accounts and data retained');
