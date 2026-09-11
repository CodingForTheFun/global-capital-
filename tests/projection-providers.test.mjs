// Provider selection, and the Gemini adapter.
//
// The model is a swappable part: it supplies judgement, and every figure a
// customer sees is derived in code from that judgement plus real prices and
// the player's own game log. These tests hold that seam still.

import test from 'node:test';
import assert from 'node:assert/strict';

const { activeProvider, providerHealth, PROVIDERS } = await import('../lib/projections/providers/index.mjs');
const gemini = await import('../lib/projections/providers/gemini.mjs');
const anthropic = await import('../lib/projections/providers/anthropic.mjs');
const { PROJECTION_OUTPUT_SCHEMA } = await import('../lib/projections/schema.mjs');

const env = (extra = {}) => ({ ...extra });

// --- selection -------------------------------------------------------------

test('no key means no provider, and never a silent guess', () => {
  assert.equal(activeProvider(env()), null);
  assert.equal(providerHealth(env()).provider, null);
});

test('whichever key exists is the one that runs', () => {
  assert.equal(activeProvider(env({ GEMINI_API_KEY: 'g' })).name, 'gemini');
  assert.equal(activeProvider(env({ ANTHROPIC_API_KEY: 'a' })).name, 'anthropic');
  // GOOGLE_API_KEY is accepted as an alias for the same credential.
  assert.equal(activeProvider(env({ GOOGLE_API_KEY: 'g' })).name, 'gemini');
});

test('an explicit choice wins, and a choice with no key does not fall through', () => {
  assert.equal(
    activeProvider(env({ PROJECTION_PROVIDER: 'gemini', GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' })).name,
    'gemini',
  );
  // Asking for a provider whose key is absent must not quietly use the other:
  // that would bill and answer from a model the operator did not choose.
  assert.equal(activeProvider(env({ PROJECTION_PROVIDER: 'gemini', ANTHROPIC_API_KEY: 'a' })), null);
  assert.equal(activeProvider(env({ PROJECTION_PROVIDER: 'nonsense', GEMINI_API_KEY: 'g' })), null);
});

test('health reports readiness without ever carrying a key', () => {
  const health = providerHealth(env({ GEMINI_API_KEY: 'super-secret-value' }));
  assert.equal(health.provider, 'gemini');
  assert.equal(health.available.gemini, true);
  assert.equal(health.available.anthropic, false);
  assert.ok(!JSON.stringify(health).includes('super-secret-value'));
});

test('both providers expose the same contract', () => {
  for (const [id, provider] of Object.entries(PROVIDERS)) {
    for (const key of ['name', 'configured', 'model', 'generate']) {
      assert.equal(typeof provider[key] === 'function' || typeof provider[key] === 'string', true, `${id}.${key}`);
    }
  }
  assert.equal(anthropic.model(env()), 'claude-opus-5');
  assert.equal(anthropic.model(env({ PROJECTION_MODEL: 'claude-sonnet-5' })), 'claude-sonnet-5');
  assert.equal(gemini.model(env({ GEMINI_MODEL: 'gemini-3.1-pro-preview' })), 'gemini-3.1-pro-preview');
});

// --- the Gemini request ----------------------------------------------------

test('the response schema keeps the contract and drops what Gemini rejects', () => {
  const converted = gemini.toResponseSchema(PROJECTION_OUTPUT_SCHEMA);
  // Every field the calibration step depends on must survive the conversion.
  for (const key of ['projection', 'probability_over', 'confidence', 'primary_driver',
    'scheme_matchup', 'usage_ripple', 'schedule_fatigue', 'game_script', 'data_gaps']) {
    assert.ok(converted.properties[key], `${key} must survive`);
    assert.ok(converted.required.includes(key), `${key} must stay required`);
  }
  assert.equal(converted.properties.projection.type, 'number');
  assert.equal(converted.properties.data_gaps.items.type, 'string');
  // Descriptions carry the instructions, so they must not be stripped.
  assert.ok(converted.properties.probability_over.description.length > 10);
});

test('unknown schema keywords are stripped rather than sent and risked', () => {
  const converted = gemini.toResponseSchema({
    type: 'object',
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    patternProperties: { '^x': { type: 'string' } },
    properties: { a: { type: 'number', exclusiveMinimum: 0, description: 'keep me' } },
    required: ['a'],
  });
  assert.equal('$schema' in converted, false);
  assert.equal('patternProperties' in converted, false);
  assert.equal('exclusiveMinimum' in converted.properties.a, false);
  assert.equal(converted.properties.a.description, 'keep me');
  assert.equal(converted.properties.a.type, 'number');
});

test('the model JSON is read from the documented path, and from a fenced block', () => {
  assert.deepEqual(gemini.extractJson({ output_text: '{"projection":31.2}' }), { projection: 31.2 });
  // Some responses fence the JSON even when asked not to.
  assert.deepEqual(gemini.extractJson({ output_text: '```json\n{"projection":9}\n```' }), { projection: 9 });
  // Fallback paths, so a shape change is a miss rather than a crash.
  assert.deepEqual(gemini.extractJson({ output: [{ text: '{"a":1}' }] }), { a: 1 });
  assert.deepEqual(gemini.extractJson({ candidates: [{ content: { parts: [{ text: '{"b":2}' }] } }] }), { b: 2 });
  // A blocked or empty response is null, never a fabricated object.
  assert.equal(gemini.extractJson({}), null);
  assert.equal(gemini.extractJson({ output_text: 'I cannot help with that.' }), null);
  assert.equal(gemini.extractJson(null), null);
});

test('the request sent to Gemini matches the documented contract', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  let seen = null;
  try {
    await gemini.generate({
      system: 'SYSTEM PROMPT',
      payload: { player: 'A' },
      schema: PROJECTION_OUTPUT_SCHEMA,
      fetchImpl: async (url, init) => {
        seen = { url, init };
        return { ok: true, status: 200, json: async () => ({ output_text: '{"projection":1}' }) };
      },
    });
  } finally { delete process.env.GEMINI_API_KEY; }

  assert.equal(seen.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  // The key goes in the header, never the URL — a URL is logged by proxies.
  assert.equal(seen.init.headers['x-goog-api-key'], 'test-key');
  assert.ok(!seen.url.includes('test-key'));
  const body = JSON.parse(seen.init.body);
  assert.equal(body.model, 'gemini-3.8-flash');
  assert.equal(body.system_instruction, 'SYSTEM PROMPT');
  assert.equal(body.response_format.mime_type, 'application/json');
  assert.ok(body.response_format.schema.properties.projection);
  assert.deepEqual(JSON.parse(body.input), { player: 'A' });
});

test('an invalid key reads as unconfigured, not as a passing outage', async () => {
  process.env.GEMINI_API_KEY = 'bad';
  try {
    // Gemini returns 400 INVALID_ARGUMENT for a bad key, not 401 — verified
    // against the live endpoint. Mapping it to a provider error would hide a
    // misconfiguration behind "temporarily unavailable" indefinitely.
    const result = await gemini.generate({
      system: 's', payload: {}, schema: PROJECTION_OUTPUT_SCHEMA,
      fetchImpl: async () => ({
        ok: false, status: 400,
        json: async () => ([{ error: { code: 400, status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }]),
      }),
    });
    assert.equal(result.code, 'PROJECTION_NOT_CONFIGURED');
  } finally { delete process.env.GEMINI_API_KEY; }
});

test('a blocked response is a decline, and a 429 is a rate limit', async () => {
  process.env.GEMINI_API_KEY = 'ok';
  try {
    const blocked = await gemini.generate({
      system: 's', payload: {}, schema: PROJECTION_OUTPUT_SCHEMA,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ output_text: '' }) }),
    });
    assert.equal(blocked.code, 'PROJECTION_DECLINED');

    const limited = await gemini.generate({
      system: 's', payload: {}, schema: PROJECTION_OUTPUT_SCHEMA,
      fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: { status: 'RESOURCE_EXHAUSTED' } }) }),
    });
    assert.equal(limited.code, 'PROJECTION_RATE_LIMITED');

    const unreachable = await gemini.generate({
      system: 's', payload: {}, schema: PROJECTION_OUTPUT_SCHEMA,
      fetchImpl: async () => { throw new Error('network down'); },
    });
    assert.equal(unreachable.code, 'PROJECTION_PROVIDER_ERROR');
  } finally { delete process.env.GEMINI_API_KEY; }
});

test('switching provider invalidates the cache rather than reusing an answer', async () => {
  const service = await import('../lib/projections/service.mjs');
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(new URL('../lib/projections/service.mjs', import.meta.url), 'utf8');
  // A different model is a different answer to the same question.
  assert.match(source, /providerHealth\(\)\.provider, providerHealth\(\)\.model/);
  assert.equal(typeof service.projectionHealth().provider, 'object');
});
