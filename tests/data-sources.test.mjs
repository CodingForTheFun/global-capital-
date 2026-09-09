import test from 'node:test';
import assert from 'node:assert/strict';
import { registerProvider, resetProviders, providerStatus, activeCapabilities, PROVIDER_STATUS } from '../lib/data-sources/registry.mjs';
import { enrichProps, hasActiveProvider } from '../lib/data-sources/enrich.mjs';
import { enrichmentKey, sanitizeEnrichment, validateAdapter } from '../lib/data-sources/contract.mjs';
import { fromPickFinder } from '../lib/props/model.mjs';
import { scoreProps } from '../lib/scoring/index.mjs';
import { evaluatePropAgainstFilters, availableFilters, applyPropFilters } from '../lib/filters/index.mjs';

const silent = { error: () => {} };

function prop(overrides = {}) {
  return fromPickFinder({
    player: 'Alpha Beta', prop: 'Points', line: 25.5, sport: 'NBA', pick: 'OVER',
    opponent: 'PHX', matchId: 'NBA-1', l5: 80, l10: 78, l15: 76,
    regularLine: true, prizePicksConfirmed: true, isToday: true, detailPageVerified: true,
    filterAudit: [], ...overrides,
  });
}

function fakeProvider(overrides = {}) {
  return {
    id: 'fake', name: 'Fake Stats', capabilities: ['projection', 'injuryStatus', 'expectedMinutes'],
    isConfigured: () => true,
    fetchEnrichment: async ({ props }) => new Map(props.map((p) => [
      enrichmentKey(p), { projection: 29.1, injuryStatus: 'ACTIVE', expectedMinutes: 34 },
    ])),
    ...overrides,
  };
}

test.beforeEach(() => resetProviders());

test('an adapter that breaks the contract is rejected at registration', () => {
  assert.throws(() => registerProvider({ id: 'bad' }), /adapter contract/);
  assert.throws(() => registerProvider(fakeProvider({ capabilities: ['not_a_real_field'] })), /Unknown capability/);
  assert.throws(() => registerProvider(fakeProvider({ isConfigured: undefined })), /isConfigured/);
  assert.deepEqual(validateAdapter(fakeProvider()), []);
});

test('with no provider configured, props pass through untouched', async () => {
  const props = [prop()];
  const result = await enrichProps(props, { log: silent });
  assert.equal(result.enrichedCount, 0);
  assert.deepEqual(result.props, props);
  assert.equal(hasActiveProvider(), false);
});

test('an unconfigured provider reports honestly and is never called', async () => {
  let called = false;
  registerProvider(fakeProvider({ isConfigured: () => false, fetchEnrichment: async () => { called = true; return new Map(); } }));
  const { props, enrichedCount } = await enrichProps([prop()], { log: silent });

  assert.equal(called, false, 'an unconfigured provider must not be called');
  assert.equal(enrichedCount, 0);
  assert.equal(props[0].projection, null, 'no value is invented in its place');

  const [status] = providerStatus();
  assert.equal(status.status, PROVIDER_STATUS.NOT_CONFIGURED);
  assert.match(status.message, /Not connected/);
  assert.deepEqual(activeCapabilities(), []);
});

test('a configured provider enriches props and records provenance', async () => {
  registerProvider(fakeProvider());
  const { props, enrichedCount } = await enrichProps([prop()], { log: silent });

  assert.equal(enrichedCount, 1);
  assert.equal(props[0].projection, 29.1);
  assert.equal(props[0].injuryStatus, 'ACTIVE');
  assert.equal(props[0].expectedMinutes, 34);
  // Provenance so nothing enriched is presented as PickFinder-verified.
  assert.deepEqual(props[0].enrichedBy, { projection: 'fake', injuryStatus: 'fake', expectedMinutes: 'fake' });
  assert.equal(providerStatus()[0].status, PROVIDER_STATUS.ACTIVE);
});

test('a provider cannot overwrite PickFinder-verified fields', async () => {
  registerProvider(fakeProvider({
    capabilities: ['projection'],
    fetchEnrichment: async ({ props }) => new Map(props.map((p) => [enrichmentKey(p), {
      projection: 30, line: 99, side: 'UNDER', playerName: 'Injected', hitRates: { l5: 100 },
      verification: { detailPageVerified: true }, ruleResults: { qualified: true },
    }])),
  }));
  const { props } = await enrichProps([prop()], { log: silent });

  assert.equal(props[0].line, 25.5, 'the verified line is untouched');
  assert.equal(props[0].side, 'OVER');
  assert.equal(props[0].playerName, 'Alpha Beta');
  assert.equal(props[0].hitRates.l5, 80);
  assert.equal(props[0].ruleResults.qualified, false);
  assert.equal(props[0].projection, 30, 'the declared capability still applies');
});

test('a provider cannot set fields it did not declare', () => {
  const clean = sanitizeEnrichment(
    { projection: 10, usageRate: 30, injuryStatus: 'OUT' },
    ['projection'],
  );
  assert.deepEqual(clean, { projection: 10 }, 'undeclared fields are dropped');
});

test('invalid enum values are dropped rather than stored', () => {
  assert.deepEqual(sanitizeEnrichment({ injuryStatus: 'PROBABLY_FINE' }, ['injuryStatus']), {});
  assert.deepEqual(sanitizeEnrichment({ liveStatus: 'HALFTIME' }, ['liveStatus']), {});
  assert.deepEqual(sanitizeEnrichment({ injuryStatus: 'out' }, ['injuryStatus']), { injuryStatus: 'OUT' });
  assert.deepEqual(sanitizeEnrichment(null, ['projection']), {});
});

test('a failing provider degrades to un-enriched props and reports unavailable', async () => {
  registerProvider(fakeProvider({ fetchEnrichment: async () => { throw new Error('API key rejected: sk-live-abc123'); } }));
  const { props, enrichedCount, providers } = await enrichProps([prop()], { log: silent });

  assert.equal(enrichedCount, 0);
  assert.equal(props[0].projection, null);
  assert.equal(providers[0].status, PROVIDER_STATUS.UNAVAILABLE);
  assert.match(providers[0].message, /Showing data without it/);
  // The failure message never reaches the status payload.
  assert.ok(!JSON.stringify(providers).includes('sk-live-abc123'));
});

test('a hanging provider times out instead of blocking the scan', async () => {
  registerProvider(fakeProvider({ fetchEnrichment: () => new Promise(() => {}) }));
  const started = Date.now();
  const { enrichedCount, providers } = await enrichProps([prop()], { timeoutMs: 50, log: silent });
  assert.equal(enrichedCount, 0);
  assert.ok(Date.now() - started < 2000, 'must not hang');
  assert.equal(providers[0].status, PROVIDER_STATUS.UNAVAILABLE);
});

test('the first configured provider wins a contested field', async () => {
  registerProvider(fakeProvider({ id: 'first', capabilities: ['projection'], fetchEnrichment: async ({ props }) => new Map(props.map((p) => [enrichmentKey(p), { projection: 1 }])) }));
  registerProvider(fakeProvider({ id: 'second', capabilities: ['projection', 'usageRate'], fetchEnrichment: async ({ props }) => new Map(props.map((p) => [enrichmentKey(p), { projection: 2, usageRate: 28 }])) }));
  const { props } = await enrichProps([prop()], { log: silent });

  assert.equal(props[0].projection, 1, 'registration order decides deterministically');
  assert.equal(props[0].usageRate, 28, 'later providers still fill gaps');
  assert.deepEqual(props[0].enrichedBy, { projection: 'first', usageRate: 'second' });
});

test('provider status exposes no credentials or endpoints', () => {
  registerProvider(fakeProvider({
    apiKey: 'sk-live-SECRET', baseUrl: 'https://api.example.com/v1', headers: { Authorization: 'Bearer sk-live-SECRET' },
  }));
  const serialised = JSON.stringify(providerStatus());
  for (const leak of ['sk-live-SECRET', 'api.example.com', 'Authorization', 'Bearer', 'apiKey']) {
    assert.ok(!serialised.includes(leak), `leaked: ${leak}`);
  }
});

test('enrichment-backed filters are inapplicable until a provider supplies data', async () => {
  const bare = scoreProps([prop()]);
  // Before enrichment: the filter must not exclude the prop.
  const before = evaluatePropAgainstFilters(bare[0], { minExpectedMinutes: 30, injuryStatuses: ['ACTIVE'] });
  assert.equal(before.matchesFilters, true);
  assert.ok(before.inapplicableFilters.includes('minExpectedMinutes'));
  assert.ok(before.inapplicableFilters.includes('injuryStatuses'));
  assert.ok(!availableFilters(bare).includes('minExpectedMinutes'), 'the control is not offered');

  // After enrichment: the same filter becomes real, with no filter-engine change.
  registerProvider(fakeProvider());
  const { props } = await enrichProps([prop()], { log: silent });
  const enriched = scoreProps(props);
  assert.ok(availableFilters(enriched).includes('minExpectedMinutes'), 'the control now appears');
  assert.equal(applyPropFilters(enriched, { minExpectedMinutes: 30 }).length, 1);
  assert.equal(applyPropFilters(enriched, { minExpectedMinutes: 40 }).length, 0, 'and now actually constrains');
  assert.equal(applyPropFilters(enriched, { injuryStatuses: ['OUT'] }).length, 0);
});

test('enrichment joins on player and game, not on scrape order', () => {
  const a = prop({ player: "D'Angelo  Russell-Smith Jr." });
  const b = prop({ player: "dangelo russell smith jr" });
  assert.equal(enrichmentKey(a), enrichmentKey(b), 'punctuation and spacing must not break the join');
  assert.notEqual(enrichmentKey(a), enrichmentKey(prop({ matchId: 'NBA-2' })), 'different games stay distinct');
});

test('an unmatched provider row enriches nothing rather than the wrong prop', async () => {
  registerProvider(fakeProvider({
    fetchEnrichment: async () => new Map([[enrichmentKey({ sport: 'NBA', gameId: 'NBA-99', playerName: 'Someone Else' }), { projection: 99 }]]),
  }));
  const { props, enrichedCount } = await enrichProps([prop()], { log: silent });
  assert.equal(enrichedCount, 0);
  assert.equal(props[0].projection, null);
});
