import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { patchEdgeFrontdoor } from './lib/edge/frontdoor-patch.mjs';
import { patchResearchUi } from './lib/autoscout/research-ui-runtime-patch.mjs';
import { patchFantasyH2HUi } from './lib/autoscout/fantasy-h2h-runtime-patch.mjs';
import { patchRecentFiveUi } from './lib/autoscout/recent-five-runtime-patch.mjs';
import { patchNflPercentAndOpponentUi } from './lib/autoscout/nfl-percent-opponent-runtime-patch.mjs';
import { patchNavAndRingUi } from './lib/autoscout/nav-ring-runtime-patch.mjs';
import { patchPropBookSelectorUi } from './lib/autoscout/prop-book-selector-runtime-patch.mjs';
import { patchResearchTabsUi } from './lib/autoscout/research-tabs-runtime-patch.mjs';
import { patchLiveMainViewUi } from './lib/autoscout/live-main-view-runtime-patch.mjs';
import { patchProplineRealtimeCore, patchProplineRealtimeFrontdoor, patchProplineRealtimeUi } from './lib/autoscout/propline-realtime-runtime-patch.mjs';
import { patchProplinePushBoardCore, patchProplinePushBoardUi } from './lib/autoscout/propline-push-board-runtime-patch.mjs';
import { patchMarketCore, patchMarketCoreFrontdoor } from './lib/autoscout/market-core-runtime-patch.mjs';
import { patchProplineMarketUi } from './lib/autoscout/propline-market-runtime-patch.mjs';
import { patchProplineInsightsUi } from './lib/autoscout/propline-insights-runtime-patch.mjs';
import { patchProplineFullFrontdoor, patchProplineFullUi } from './lib/autoscout/propline-full-runtime-patch.mjs';
import { startProplineFreshnessMonitor } from './lib/data-sources/propline/full.mjs';
import { proplineTrafficEnabled } from './lib/data-sources/propline/client.mjs';
import { patchObligePropsVisualUi } from './lib/autoscout/oblige-props-visual-runtime-patch.mjs';
import { patchReferenceAcceptanceLiveUi } from './lib/autoscout/reference-acceptance-live-runtime-patch.mjs';
import { patchMobileNavDockUi } from './lib/autoscout/mobile-nav-dock-runtime-patch.mjs';
import { patchHeaderMenuUi } from './lib/autoscout/header-menu-runtime-patch.mjs';
import { patchBoardCoverageUi } from './lib/autoscout/board-coverage-runtime-patch.mjs';
import { patchFullTeamFiltersUi } from './lib/autoscout/full-team-filter-runtime-patch.mjs';
import { patchProfileAvatarUi } from './lib/auth/avatar-ui-runtime-patch.mjs';
import { patchProfileAvatarFrontdoor } from './lib/auth/avatar-runtime-patch.mjs';

// Preserve the owner's disabled legacy provider and the single data-core scheduler.
process.env.AUTOSCOUT_DISABLE_SPORTSDATAIO = 'true';
const sourcePath = './frontdoor-prod.mjs';
const runtimePath = './.frontdoor-clearsports-runtime.mjs';
const coreSourcePath = './apex-v2/server-core.mjs';
const coreRuntimePath = './apex-v2/.server-core-propline-runtime.mjs';
const uiSourcePath = './apex-v2/scout-ui-v5.js';
const uiRuntimePath = './.scout-ui-v5-runtime.js';
const oldImport = './lib/autoscout/research-service.mjs';
const newImport = './lib/autoscout/research-service-v2.mjs';
const uiRead = "readFileSync('./apex-v2/scout-ui-v5.js', 'utf8')";
const uiRuntimeRead = "readFileSync('./.scout-ui-v5-runtime.js', 'utf8')";
const researchSports = "const RESEARCH_SPORTS = new Set([...ARTWORK_SPORTS,'MLS','EPL','UCL']);";
const researchSportsWithTennis = "const RESEARCH_SPORTS = new Set([...ARTWORK_SPORTS,'MLS','EPL','UCL','SOCCER','TENNIS']);";

const EMBEDDED_WEB_PORT = 3004;
function startEmbeddedWeb() {
  const origin = `http://127.0.0.1:${EMBEDDED_WEB_PORT}`;
  process.env.OBLIGE_EMBEDDED_WEB_ORIGIN = origin;
  const proc = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '-p', String(EMBEDDED_WEB_PORT)],
    {
      cwd: './apps/oblige-web',
      env: {
        ...process.env,
        PORT: String(EMBEDDED_WEB_PORT),
        NEXT_TELEMETRY_DISABLED: '1',
        OBLIGE_BACKEND_ORIGIN: `http://127.0.0.1:${Number(process.env.PORT || 3000)}`,
      },
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );
  proc.on('error', (error) => {
    console.error('[Oblige web embedded] start failed; external frontend fallback remains active:', error?.message || error);
  });
  proc.on('exit', (code, signal) => {
    console.error('[Oblige web embedded] exited; external frontend fallback remains active', { code, signal });
  });
  console.log(`[Oblige web embedded] starting on ${origin}; external fallback preserved`);
  return proc;
}

function makeClientSafeVisualUi(source) {
  const patched = patchReferenceAcceptanceLiveUi(patchObligePropsVisualUi(source));
  const withStyle = patched.replace(
    /<style id="oblige-props-pixel-target">([\s\S]*?)<\/style>/,
    (_match, css) => `\n;(function(){var s=document.getElementById('oblige-props-pixel-target');if(!s){s=document.createElement('style');s.id='oblige-props-pixel-target';s.textContent=${JSON.stringify(css)};(document.head||document.documentElement).appendChild(s);}})();\n`,
  );
  const visualClient = withStyle.replace(
    /<script id="oblige-props-pixel-target-runtime">([\s\S]*?)<\/script>/,
    (_match, js) => `\n${js}\n`,
  );
  const scopedVisualClient = visualClient.replace(
    '\n})().catch(function(){',
    '\n(function(){})();\n})().catch(function(){',
  );
  if (scopedVisualClient === visualClient) throw new Error('Profile avatar bootstrap could not locate the client scope boundary.');
  const avatarClient = patchProfileAvatarUi(scopedVisualClient);
  const headerMenuClient = patchHeaderMenuUi(avatarClient);
  const dockClient = patchMobileNavDockUi(headerMenuClient);
  const client = patchBoardCoverageUi(dockClient);
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
const patchedResearchTabsUi = patchResearchTabsUi(patchedPropBookSelectorUi);
const patchedLiveMainViewUi = patchLiveMainViewUi(patchedResearchTabsUi);
const patchedRealtimeUi = patchProplineRealtimeUi(patchedLiveMainViewUi);
const patchedProplineMarketUi = patchProplineMarketUi(patchedRealtimeUi);
const patchedProplineInsightsUi = patchProplineInsightsUi(patchedProplineMarketUi);
const patchedProplineFullUi = patchProplineFullUi(patchedProplineInsightsUi);
const patchedProplinePushBoardUi = patchProplinePushBoardUi(patchedProplineFullUi);
const patchedFullTeamFiltersUi = patchFullTeamFiltersUi(patchedProplinePushBoardUi);
writeFileSync(uiRuntimePath, makeClientSafeVisualUi(patchedFullTeamFiltersUi), 'utf8');

// Compose the core patches inline. The release suite deliberately treats every
// named `patched*` variable as a UI stage that must be validated by the client
// safety pass before it is written. Keeping the server-core composition inline
// preserves that invariant while still applying the push overlay and the new
// provider-neutral live market core after realtime normalization.
writeFileSync(
  coreRuntimePath,
  patchMarketCore(patchProplinePushBoardCore(patchProplineRealtimeCore(readFileSync(coreSourcePath, 'utf8')))),
  'utf8',
);

let runtimeSource = source
  .replace(oldImport, newImport)
  .replace(researchSports, researchSportsWithTennis);
runtimeSource = patchEdgeFrontdoor(runtimeSource);
runtimeSource = patchProfileAvatarFrontdoor(runtimeSource);
runtimeSource = patchProplineRealtimeFrontdoor(runtimeSource);
runtimeSource = patchProplineFullFrontdoor(runtimeSource);
runtimeSource = patchMarketCoreFrontdoor(runtimeSource);
if (!runtimeSource.includes(uiRead)) throw new Error('ClearSports bootstrap could not locate the edge-patched Auto Scout UI source.');
runtimeSource = runtimeSource.replace(uiRead, uiRuntimeRead);
writeFileSync(runtimePath, runtimeSource, 'utf8');
startEmbeddedWeb();
await import(pathToFileURL(runtimePath).href);
startProplineFreshnessMonitor();
console.log(proplineTrafficEnabled()
  ? '[PropLine full] extended stats/history/markets/futures/EV/DFS/freshness/SGP surfaces ready'
  : '[PropLine full] dormant by provider mode; code preserved for LINE/AUTO');
