import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { patchEdgeFrontdoor } from './lib/edge/frontdoor-patch.mjs';
import { startZeroCreditWorker } from './lib/ingestion/zero-credit-worker.mjs';

// Production data mode: public platform feeds + persisted public rows + ESPN
// background history. Paid/metered sports-data credentials are deliberately
// removed from the child-process environment so a browser request can never
// consume subscription credits by accident.
process.env.AUTOSCOUT_DISABLE_SPORTSDATAIO = 'true';
process.env.AUTOSCOUT_PUBLIC_FIRST = 'true';
process.env.AUTOSCOUT_INGEST_ENABLED = 'false';
process.env.AUTOSCOUT_ZERO_CREDIT_ENABLED = 'true';
process.env.AUTOSCOUT_PUBLIC_FEED_USER_AGENT ||= 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
for (const key of ['THE_ODDS_API_KEY','SPORTSDATAIO_API_KEY','SPORTSGAMEODDS_API_KEY','CLEARSPORTS_API_KEY']) delete process.env[key];

const sourcePath = './frontdoor-prod.mjs';
const runtimePath = './.frontdoor-clearsports-runtime.mjs';
const oldResearch = './lib/autoscout/research-service.mjs';
const zeroResearch = './lib/autoscout/research-service-v3-zero.mjs';
const oldTeammates = "import { teammatesFor, injuryFeedConfigured } from './lib/data-sources/sportsdataio/injury-feed.mjs';";
const localTeammates = "import { teammatesFor, injuryFeedConfigured } from './lib/ingestion/local-sandbox.mjs';";
let source = readFileSync(sourcePath, 'utf8');
if (!source.includes(oldResearch) || !source.includes(oldTeammates)) throw new Error('Zero-credit bootstrap anchors changed; review frontdoor before deploying.');
source = source.replace(oldResearch, zeroResearch).replace(oldTeammates, localTeammates);
writeFileSync(runtimePath, patchEdgeFrontdoor(source), 'utf8');
await import(pathToFileURL(runtimePath).href);
startZeroCreditWorker();
