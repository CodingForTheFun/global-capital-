import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {patchResearchUi} from '../lib/autoscout/research-ui-runtime-patch.mjs';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('unavailable research stays customer-safe and never surfaces provider diagnostics', () => {
  const client = patchResearchUi(read('apex-v2/scout-ui-v5.js'));
  new vm.Script(client);

  assert.doesNotMatch(client, /Research needs retry/);
  assert.doesNotMatch(client, /This exact statistic has no verified history/);
  assert.doesNotMatch(client, />Retry research</);
  assert.match(client, /asBadgesUnavailable/);
  assert.match(client, /aria-label="Trend data unavailable"/);
  assert.match(client, />Refresh stats</);

  const availabilityStart = client.indexOf('function researchAvailability(base)');
  const availabilityEnd = client.indexOf('function emptyLog(', availabilityStart);
  assert.ok(availabilityStart >= 0 && availabilityEnd > availabilityStart);
  const availability = client.slice(availabilityStart, availabilityEnd);
  assert.doesNotMatch(availability, /base\?\.message/);
  assert.doesNotMatch(availability, /provider|verified|could not be loaded/i);
});
