import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { patchEdgeFrontdoor } from './lib/edge/frontdoor-patch.mjs';
import { startPublicIngestWorker } from './lib/ingestion/public-worker.mjs';

// Public-feed mode never calls metered providers from its ingestion worker.
// Preserve the owner's disabled legacy provider while the UI can continue to
// read its existing contracts during migration.
process.env.AUTOSCOUT_DISABLE_SPORTSDATAIO = 'true';
startPublicIngestWorker();

const sourcePath = './frontdoor-prod.mjs';
const runtimePath = './.frontdoor-clearsports-runtime.mjs';
const oldImport = './lib/autoscout/research-service.mjs';
const newImport = './lib/autoscout/research-service-v2.mjs';
const source = readFileSync(sourcePath, 'utf8');
if (!source.includes(oldImport)) throw new Error('ClearSports bootstrap could not locate the research-service import.');
writeFileSync(runtimePath, patchEdgeFrontdoor(source.replace(oldImport, newImport)), 'utf8');
await import(pathToFileURL(runtimePath).href);