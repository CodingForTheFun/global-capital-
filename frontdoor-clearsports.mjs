import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { patchEdgeFrontdoor } from './lib/edge/frontdoor-patch.mjs';
import { patchResearchUi } from './lib/autoscout/research-ui-runtime-patch.mjs';
import { patchFantasyH2HUi } from './lib/autoscout/fantasy-h2h-runtime-patch.mjs';
import { patchRecentFiveUi } from './lib/autoscout/recent-five-runtime-patch.mjs';
import { patchNflPercentAndOpponentUi } from './lib/autoscout/nfl-percent-opponent-runtime-patch.mjs';
import { patchNavAndRingUi } from './lib/autoscout/nav-ring-runtime-patch.mjs';
import { patchPropBookSelectorUi } from './lib/autoscout/prop-book-selector-runtime-patch.mjs';
import { patchObligePropsVisualUi } from './lib/autoscout/oblige-props-visual-runtime-patch.mjs';

// Preserve the owner's disabled legacy provider and the single data-core scheduler.
process.env.AUTOSCOUT_DISABLE_SPORTSDATAIO = 'true';
const sourcePath = './frontdoor-prod.mjs';
const runtimePath = './.frontdoor-clearsports-runtime.mjs';
const uiSourcePath = './apex-v2/scout-ui-v5.js';
const uiRuntimePath = './.scout-ui-v5-runtime.js';
const oldImport = './lib/autoscout/research-service.mjs';
const newImport = './lib/autoscout/research-service-v2.mjs';
const uiRead = "readFileSync('./apex-v2/scout-ui-v5.js', 'utf8')";
const uiRuntimeRead = "readFileSync('./.scout-ui-v5-runtime.js', 'utf8')";
const researchSports = "const RESEARCH_SPORTS = new Set([...ARTWORK_SPORTS,'MLS','EPL','UCL']);";
// The DFS feeds tag every club competition "SOCCER" and never MLS, EPL or UCL,
// so the research API refused the only soccer props that actually arrive.
const researchSportsWithTennis = "const RESEARCH_SPORTS = new Set([...ARTWORK_SPORTS,'MLS','EPL','UCL','SOCCER','TENNIS']);";

function makeClientSafeVisualUi(source) {
  const patched = patchObligePropsVisualUi(source);
  // The visual patch is authored as HTML fragments because it is also useful in
  // screenshot review tooling. The production Auto Scout shell, however, is
  // injected inside an existing <script>. Convert those fragments into real
  // JavaScript before the frontdoor serves them. Raw <style>/<script> tags in
  // JavaScript make Safari stop at the first '<' and leave "Loading Auto Scout…".
  const withStyle = patched.replace(
    /<style id="oblige-props-pixel-target">([\s\S]*?)<\/style>/,
    (_match, css) => `\n;(function(){var s=document.getElementById('oblige-props-pixel-target');if(!s){s=document.createElement('style');s.id='oblige-props-pixel-target';s.textContent=${JSON.stringify(css)};(document.head||document.documentElement).appendChild(s);}})();\n`,
  );
  const client = withStyle.replace(
    /<script id="oblige-props-pixel-target-runtime">([\s\S]*?)<\/script>/,
    (_match, js) => `\n${js}\n`,
  );
  // Fail the container before Railway cuts traffic over if a future runtime
  // presentation patch ever generates invalid client JavaScript again.
  try { new Function(client); }
  catch (error) { throw new Error(`Auto Scout client bundle is invalid: ${error?.message || error}`); }
  return client;
}

const source = readFileSync(sourcePath, 'utf8');
if (!source.includes(oldImport)) throw new Error('ClearSports bootstrap could not locate the research-service import.');
if (!source.includes(uiRead)) throw new Error('ClearSports bootstrap could not locate the Auto Scout v5 UI source.');
if (!source.includes(researchSports)) throw new Error('ClearSports bootstrap could not locate the research sport allowlist.');
const patchedResearchUi = patchResearchUi(readFileSync(uiSourcePath, 'utf8'));
const patchedFantasyH2HUi = patchFantasyH2HUi(patchedResearchUi);
const patchedRecentFiveUi = patchRecentFiveUi(patchedFantasyH2HUi);
const patchedNflPercentAndOpponentUi = patchNflPercentAndOpponentUi(patchedRecentFiveUi);
const patchedNavAndRingUi = patchNavAndRingUi(patchedNflPercentAndOpponentUi);
const patchedPropBookSelectorUi = patchPropBookSelectorUi(patchedNavAndRingUi);
writeFileSync(uiRuntimePath, makeClientSafeVisualUi(patchedPropBookSelectorUi), 'utf8');
// Run the existing edge safety patch against its original source anchors first.
// The runtime-only UI file substitution happens afterwards so account/routing
// safeguards still fail closed if the production frontdoor shape changes.
let runtimeSource = source
  .replace(oldImport, newImport)
  .replace(researchSports, researchSportsWithTennis);
runtimeSource = patchEdgeFrontdoor(runtimeSource);
if (!runtimeSource.includes(uiRead)) throw new Error('ClearSports bootstrap could not locate the edge-patched Auto Scout UI source.');
runtimeSource = runtimeSource.replace(uiRead, uiRuntimeRead);
writeFileSync(runtimePath, runtimeSource, 'utf8');
await import(pathToFileURL(runtimePath).href);