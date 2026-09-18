// Compatibility build command: Oblige Props identity plus targeted presentation fixes.
// Never rewrite payment descriptors, account identifiers, storage keys, or research calculations.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { applySoccerPublicFeedPatches } from './patch-soccer-public-feeds.mjs';
import { patchPublicSportsbookHosts } from './patch-public-sportsbook-hosts.mjs';
import './patch-real-snipe-table.mjs';
import './patch-obligeprops-presentation.mjs';

// Public feed compatibility is applied at image-build time so it composes cleanly
// with parallel ingestion work. A real application checkout always includes
// package.json; tiny isolated branding fixtures intentionally do not. Production
// therefore remains fail-closed if required adapter anchors disappear.
if (existsSync('package.json')) {
  patchPublicSportsbookHosts();
  applySoccerPublicFeedPatches();
}

// Safari/iOS can paint the donut circles while dropping SVG <text>. Render the
// real computed percentage as an HTML overlay so it remains visible in the
// installed iPhone web app without changing the underlying calculation.
{
  const file = 'apex-v2/scout-ui-v5.js';
  if (existsSync(file)) {
    const source = readFileSync(file, 'utf8');
    const ringStart = '<div class="asRing" title="Historical hit rates, not a win prediction"><svg class="asRingSvg"';
    const ringStartReplacement = '<div class="asRing" title="Historical hit rates, not a win prediction"><span class="asRingGraphic" style="position:relative;display:inline-grid;place-items:center;flex:none"><svg class="asRingSvg"';
    const svgText = '<text x="32" y="32" class="asRingMid" text-anchor="middle" dominant-baseline="central">\'+Math.round(over)+\'%</text>';
    const ringEnd = '</svg><div class="asRingText">';
    const ringEndReplacement = '</svg><span class="asRingCenter" aria-hidden="true" style="position:absolute;inset:0;display:grid;place-items:center;color:#f8fafc;font:800 15px/1 Inter,system-ui,sans-serif;z-index:2;pointer-events:none;text-shadow:0 1px 2px rgba(0,0,0,.35)">\'+Math.round(over)+\'%</span></span><div class="asRingText">';

    if (!source.includes(ringStart)) throw new Error('Oblige Props ring start anchor not found.');
    if (!source.includes(svgText)) throw new Error('Oblige Props SVG percentage anchor not found.');
    if (!source.includes(ringEnd)) throw new Error('Oblige Props ring end anchor not found.');

    const output = source
      .replace(ringStart, ringStartReplacement)
      .replace(svgText, '')
      .replace(ringEnd, ringEndReplacement);
    if (output !== source) writeFileSync(file, output);
  }
}

// Signed-out visitors should see the current product identity without changing
// any registration, verification, session, or account-gate behavior.
{
  const file = 'lib/auth/landing.mjs';
  if (existsSync(file)) {
    const source = readFileSync(file, 'utf8');
    const replacements = [
      [
        '<title>Auto Scout — Prop Intelligence &amp; Line Discrepancies</title>',
        '<title>Oblige Props — Prop Intelligence &amp; Line Discrepancies</title>',
      ],
      [
        '<div class="logo">A</div><span class="brand">AUTOSCOUT</span>',
        '<div class="logo">O</div><span class="brand">OBLIGE PROPS</span>',
      ],
      ['Auto Scout is a research tool.', 'Oblige Props is a research tool.'],
    ];

    let output = source;
    for (const [legacy, current] of replacements) {
      if (!output.includes(legacy)) throw new Error(`Oblige Props landing identity anchor not found: ${legacy}`);
      output = output.replace(legacy, current);
    }
    if (output !== source) writeFileSync(file, output);
  }
}

// The core page can briefly render before the signed-in UI bundle hydrates.
// Remove legacy product text there too so customers never see Auto Scout during
// load, in the document title, or in the owner diagnostics presentation.
{
  const file = 'apex-v2/server-core.mjs';
  if (existsSync(file)) {
    const source = readFileSync(file, 'utf8');
    const replacements = [
      ['<title>Auto Scout</title>', '<title>Oblige Props</title>'],
      ['Loading Auto Scout…', 'Loading Oblige Props…'],
      ['<title>Auto Scout Provider Diagnostics</title>', '<title>Oblige Props Provider Diagnostics</title>'],
      ['AUTO<span>SCOUT</span> DATA', 'OBLIGE <span>PROPS</span> DATA'],
      ['Sign in to Auto Scout as owner', 'Sign in to Oblige Props as owner'],
    ];
    let output = source;
    for (const [legacy, current] of replacements) {
      if (!output.includes(legacy)) throw new Error(`Oblige Props core identity anchor not found: ${legacy}`);
      output = output.replace(legacy, current);
    }
    if (output !== source) writeFileSync(file, output);
  }
}

// The Intelligence Studio is mounted inside the signed-in customer board. Keep
// its customer-facing labels aligned with the public Oblige Props identity while
// leaving internal AUTOSCOUT module, storage and environment contracts untouched.
{
  const file = 'lib/ui/intelligence-studio.mjs';
  if (existsSync(file)) {
    const source = readFileSync(file, 'utf8');
    const replacements = [
      ["boardRoot.setAttribute('aria-label','Auto Scout intelligence studio');", "boardRoot.setAttribute('aria-label','Oblige Props intelligence studio');"],
      ['<p class="asi-eyebrow">Auto Scout / Intelligence studio</p>', '<p class="asi-eyebrow">Oblige Props / Intelligence studio</p>'],
      ['without leaving Auto Scout.</p>', 'without leaving Oblige Props.</p>'],
    ];
    let output = source;
    for (const [legacy, current] of replacements) {
      if (!output.includes(legacy)) throw new Error(`Oblige Props intelligence identity anchor not found: ${legacy}`);
      output = output.replace(legacy, current);
    }
    if (output !== source) writeFileSync(file, output);
  }
}

// The signed-in header still carried an obsolete lowercase "obligepay" wordmark
// in the visual runtime patch. Normalize only that presentation layer; payment
// descriptors, storage keys, account data and billing behavior are untouched.
{
  const file = 'lib/autoscout/oblige-props-visual-runtime-patch.mjs';
  if (existsSync(file)) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('asPay') || !source.includes('>pay</span>')) {
      throw new Error('Oblige Props signed-in wordmark anchor not found.');
    }
    const output = source
      .replaceAll('asPay', 'asProps')
      .replaceAll('>pay</span>', '>props</span>');
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
console.log('[oblige-props] research identity ready; signed-in and signed-out identity current; core loading/title identity current; intelligence identity current; donut percentage rendered as HTML overlay; existing accounts and data retained');