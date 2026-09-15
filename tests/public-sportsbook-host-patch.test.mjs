import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { patchPublicSportsbookHosts } from '../scripts/patch-public-sportsbook-hosts.mjs';

const SOURCE = `const STATE = String(process.env.AUTOSCOUT_BETMGM_STATE || 'nj').trim().toLowerCase() || 'nj';
const BASE_ORIGIN = \`https://www.\${STATE}.betmgm.com\`;
const FIXTURE_BASE = \`\${BASE_ORIGIN}/cds-api/bettingoffer/fixtures\`;
const GRID_BASE = \`\${BASE_ORIGIN}/cds-api/offer-grouping/grid-view/all\`;
const CONFIG_URL = \`\${BASE_ORIGIN}/en/api/clientconfig\`;
function headers(){ return { origin: BASE_ORIGIN, referer: \`\${BASE_ORIGIN}/en/sports\` }; }
function grid(accessId) { const url = new URL(GRID_BASE); for (const [key, value] of Object.entries({ 'x-bwin-accessid': accessId, lang: 'en-us', country: 'US', userCountry: 'US' })) url.searchParams.set(key, value); return url; }
function fixture(accessId) { const url = new URL(FIXTURE_BASE); for (const [key, value] of Object.entries({ 'x-bwin-accessid': accessId, lang: 'en-us', country: 'US', userCountry: 'US', offerMapping: 'Filtered' })) url.searchParams.set(key, value); return url; }
const browser = { origin: BASE_ORIGIN, referer: \`\${BASE_ORIGIN}/en/sports\` };
const result = { endpoint: \`www.\${STATE}.betmgm.com\` };
`;

test('BetMGM build patch keeps web context on www, moves CDS to sports host, and fixes grid discovery casing', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'oblige-betmgm-'));
  try {
    const dir = path.join(root, 'lib', 'ingestion');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'betmgm-public.mjs');
    writeFileSync(file, SOURCE, 'utf8');
    assert.equal(patchPublicSportsbookHosts(root), true);
    const output = readFileSync(file, 'utf8');
    assert.match(output, /const WEB_ORIGIN = `https:\/\/www\.\$\{STATE\}\.betmgm\.com`;/);
    assert.match(output, /const API_ORIGIN = `https:\/\/sports\.\$\{STATE\}\.betmgm\.com`;/);
    assert.match(output, /FIXTURE_BASE = `\$\{API_ORIGIN\}\/cds-api\/bettingoffer\/fixtures`/);
    assert.match(output, /GRID_BASE = `\$\{API_ORIGIN\}\/cds-api\/offer-grouping\/grid-view\/all`/);
    assert.match(output, /CONFIG_URL = `\$\{WEB_ORIGIN\}\/en\/api\/clientconfig`/);
    assert.match(output, /origin: WEB_ORIGIN/);
    assert.match(output, /endpoint: `sports\.\$\{STATE\}\.betmgm\.com`/);
    assert.match(output, /country: 'US', usercountry: 'US' \}\)\) url\.searchParams/);
    assert.match(output, /country: 'US', userCountry: 'US', offerMapping: 'Filtered'/);
    assert.doesNotMatch(output, /BASE_ORIGIN/);
    assert.equal(patchPublicSportsbookHosts(root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
