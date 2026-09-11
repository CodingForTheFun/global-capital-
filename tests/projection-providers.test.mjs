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

test('the answer is found wherever the provider nests it', () => {
  const answer = { projection: 31.2, probability_over: 0.58 };
  assert.deepEqual(gemini.extractJson({ output_text: JSON.stringify(answer) }), answer);
  // Some responses fence the JSON even when asked not to.
  assert.deepEqual(gemini.extractJson({ output_text: '```json\n' + JSON.stringify(answer) + '\n```' }), answer);

  // The live response nested it under `steps`, a shape the docs did not show.
  // Rather than hard-code one more path, the reader walks the body — so a
  // future shape change is a miss to fix, not an outage.
  assert.deepEqual(gemini.extractJson({
    id: 'v1_x', status: 'completed', usage: {}, model: 'gemini-3.8-flash',
    steps: [{ type: 'model', content: [{ text: JSON.stringify(answer) }] }],
  }), answer);
  assert.deepEqual(gemini.extractJson({ steps: [{ parts: [{ text: JSON.stringify(answer) }] }] }), answer);
});

test('the reader accepts only the answer it asked for, never any JSON lying around', () => {
  // A walk that took the first parseable object would latch onto usage
  // metadata or an echoed request and hand it on as a projection.
  assert.equal(gemini.extractJson({ steps: [{ text: '{"unrelated":1}' }] }), null);
  assert.equal(gemini.extractJson({ usage: { total_tokens: 10 }, steps: [{ text: '{"total_tokens":10}' }] }), null);
  // A blocked or prose-only response is null, never a fabricated object.
  assert.equal(gemini.extractJson({}), null);
  assert.equal(gemini.extractJson({ output_text: 'I cannot help with that.' }), null);
  assert.equal(gemini.extractJson(null), null);
});

test('the walk is bounded, so a hostile or huge body cannot hang the request', () => {
  // Depth beyond the limit is abandoned rather than followed.
  let deep = { projection: 1, probability_over: 0.5 };
  let wrapped = { text: JSON.stringify(deep) };
  for (let i = 0; i < 40; i += 1) wrapped = { nest: wrapped };
  assert.equal(gemini.extractJson(wrapped), null);

  // And a cycle terminates instead of recursing forever.
  const cyclic = { steps: [] };
  cyclic.steps.push(cyclic);
  assert.equal(gemini.extractJson(cyclic), null);
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
        json: async () => ([{ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid.', details: [{ reason: 'API_KEY_INVALID' }] } }]),
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

test('a schema the provider cannot serve falls back to prompt-carried JSON', async () => {
  process.env.GEMINI_API_KEY = 'ok';
  const calls = [];
  try {
    const result = await gemini.generate({
      system: 's', payload: {}, schema: PROJECTION_OUTPUT_SCHEMA,
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body);
        calls.push(Boolean(body.response_format.schema));
        // A rejected schema is a 400 INVALID_ARGUMENT — that is the only
        // shape worth re-asking without the schema.
        if (body.response_format.schema) {
          return { ok: false, status: 400, json: async () => ({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Invalid JSON payload received.' } }) };
        }
        return { ok: true, status: 200, json: async () => ({ output_text: '{"projection":34.1,"probability_over":0.61}' }) };
      },
    });
    assert.deepEqual(calls, [true, false], 'schema first, then without');
    assert.equal(result.ok, true);
    assert.equal(result.parsed.projection, 34.1);
    // Still JSON-constrained on the fallback, just not schema-constrained.
    assert.equal(calls.length, 2);
  } finally { delete process.env.GEMINI_API_KEY; }
});

test('a bad key or a rate limit is never retried without the schema', async () => {
  process.env.GEMINI_API_KEY = 'ok';
  let attempts = 0;
  try {
    for (const [status, reason] of [[400, 'API_KEY_INVALID'], [429, 'RATE_LIMIT_EXCEEDED']]) {
      attempts = 0;
      await gemini.generate({
        system: 's', payload: {}, schema: PROJECTION_OUTPUT_SCHEMA,
        fetchImpl: async () => {
          attempts += 1;
          return { ok: false, status, json: async () => ({ error: { status: 'X', details: [{ reason }] } }) };
        },
      });
      assert.equal(attempts, 1, `status ${status} must not be retried`);
    }
  } finally { delete process.env.GEMINI_API_KEY; }
});

test('a busy provider reads as busy, and is not re-asked without the schema', async () => {
  // Google answers "this model is experiencing high demand" with a 500 — seen
  // live on gemini-3.8-flash. That is capacity, not a bad request: the user
  // should be told to try again, and the call must not be spent twice.
  assert.equal(gemini.busy(500, 'gemini-3.8-flash is currently experiencing high demand, spikes in demand are usually temporary. Please try again later.'), true);
  assert.equal(gemini.busy(503, null), true);
  assert.equal(gemini.busy(500, 'Internal error encountered.'), false);
  assert.equal(gemini.busy(400, 'high demand'), false);

  process.env.GEMINI_API_KEY = 'ok';
  let attempts = 0;
  try {
    const result = await gemini.generate({
      system: 's', payload: {}, schema: PROJECTION_OUTPUT_SCHEMA,
      fetchImpl: async () => {
        attempts += 1;
        return { ok: false, status: 500, json: async () => ({ error: { code: 500, message: 'Model is currently experiencing high demand, please try again later.' } }) };
      },
    });
    assert.equal(result.code, 'PROJECTION_RATE_LIMITED');
    assert.equal(attempts, 1, 'a busy provider must not be asked twice');
  } finally { delete process.env.GEMINI_API_KEY; }
});

test('a genuine 5xx is not re-asked without the schema either', async () => {
  process.env.GEMINI_API_KEY = 'ok';
  let attempts = 0;
  try {
    await gemini.generate({
      system: 's', payload: {}, schema: PROJECTION_OUTPUT_SCHEMA,
      fetchImpl: async () => {
        attempts += 1;
        return { ok: false, status: 500, json: async () => ({ error: { code: 500, message: 'Internal error encountered.' } }) };
      },
    });
    // The schema is not what a server-side failure is complaining about, and
    // a second call costs quota that is scarce exactly when this happens.
    assert.equal(attempts, 1);
  } finally { delete process.env.GEMINI_API_KEY; }
});
