import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { patchEdgeFrontdoor } from './lib/edge/frontdoor-patch.mjs';

// Preserve the owner's disabled legacy provider and the single data-core scheduler.
process.env.AUTOSCOUT_DISABLE_SPORTSDATAIO = 'true';
const sourcePath = './frontdoor-prod.mjs';
const runtimePath = './.frontdoor-clearsports-runtime.mjs';
const oldImport = './lib/autoscout/research-service.mjs';
const newImport = './lib/autoscout/research-service-v2.mjs';
const source = readFileSync(sourcePath, 'utf8');
if (!source.includes(oldImport)) throw new Error('ClearSports bootstrap could not locate the research-service import.');
writeFileSync(runtimePath, patchEdgeFrontdoor(source.replace(oldImport, newImport)), 'utf8');
await import(pathToFileURL(runtimePath).href);
