import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function patchPublicSportsbookHosts(root = process.cwd()) {
  const file = path.join(root, 'lib/ingestion/betmgm-public.mjs');
  if (!existsSync(file)) return false;
  let source = readFileSync(file, 'utf8');
  const original = source;
  const oldBlock = "const STATE = String(process.env.AUTOSCOUT_BETMGM_STATE || 'nj').trim().toLowerCase() || 'nj';\nconst BASE_ORIGIN = `https://www.${STATE}.betmgm.com`;\nconst FIXTURE_BASE = `${BASE_ORIGIN}/cds-api/bettingoffer/fixtures`;\nconst GRID_BASE = `${BASE_ORIGIN}/cds-api/offer-grouping/grid-view/all`;\nconst CONFIG_URL = `${BASE_ORIGIN}/en/api/clientconfig`;";
  const newBlock = "const STATE = String(process.env.AUTOSCOUT_BETMGM_STATE || 'nj').trim().toLowerCase() || 'nj';\nconst WEB_ORIGIN = `https://www.${STATE}.betmgm.com`;\nconst API_ORIGIN = `https://sports.${STATE}.betmgm.com`;\nconst FIXTURE_BASE = `${API_ORIGIN}/cds-api/bettingoffer/fixtures`;\nconst GRID_BASE = `${API_ORIGIN}/cds-api/offer-grouping/grid-view/all`;\nconst CONFIG_URL = `${WEB_ORIGIN}/en/api/clientconfig`;";

  if (!source.includes(newBlock)) {
    if (!source.includes(oldBlock)) throw new Error('[sportsbook-hosts] BetMGM origin block anchor not found.');
    source = source.replace(oldBlock, newBlock);
  }
  // After the endpoint constants are split, every remaining BASE_ORIGIN reference
  // is browser-page context (Origin/Referer/client-config) and belongs on www.
  source = source.replaceAll('BASE_ORIGIN', 'WEB_ORIGIN');
  source = source.replace('endpoint: `www.${STATE}.betmgm.com`', 'endpoint: `sports.${STATE}.betmgm.com`');

  if (!source.includes('const API_ORIGIN = `https://sports.${STATE}.betmgm.com`;')) throw new Error('[sportsbook-hosts] BetMGM API origin patch missing.');
  if (!source.includes('const CONFIG_URL = `${WEB_ORIGIN}/en/api/clientconfig`;')) throw new Error('[sportsbook-hosts] BetMGM web config patch missing.');
  if (source.includes('BASE_ORIGIN')) throw new Error('[sportsbook-hosts] BetMGM legacy origin reference remains.');
  if (source !== original) writeFileSync(file, source, 'utf8');
  return source !== original;
}
