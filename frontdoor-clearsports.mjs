import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { patchEdgeFrontdoor } from './lib/edge/frontdoor-patch.mjs';
import { patchResearchUi } from './lib/autoscout/research-ui-runtime-patch.mjs';

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
const researchSportsWithTennis = "const RESEARCH_SPORTS = new Set([...ARTWORK_SPORTS,'MLS','EPL','UCL','TENNIS']);";
const source = readFileSync(sourcePath, 'utf8');
if (!source.includes(oldImport)) throw new Error('ClearSports bootstrap could not locate the research-service import.');
if (!source.includes(uiRead)) throw new Error('ClearSports bootstrap could not locate the Auto Scout v5 UI source.');
if (!source.includes(researchSports)) throw new Error('ClearSports bootstrap could not locate the research sport allowlist.');
writeFileSync(uiRuntimePath, patchResearchUi(readFileSync(uiSourcePath, 'utf8')), 'utf8');
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
