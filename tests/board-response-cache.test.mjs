import crypto from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { createBoardResponseCache, sendBoardResponse, serializePublicBoard } from '../lib/autoscout/board-response-cache.mjs';
import { publicJsonChunks } from '../lib/autoscout/public-board-response.mjs';

const board = { ok: true, props: Array.from({ length: 500 }, (_, i) => ({ id: 'p' + i, playerName: 'Player ' + i, line: i + 0.5, price: -110 })), meta: { provider: 'test' } };

function fakeRes() {
  const out = { status: null, headers: null, body: null };
  return { out, writeHead(status, headers) { out.status = status; out.headers = headers; }, end(body) { out.body = body || null; } };
}

test('serialised board is byte-identical to the streamed sanitiser output', async () => {
  const raw = await serializePublicBoard(board);
  assert.equal(raw.toString('utf8'), [...publicJsonChunks(board)].join(''));
  assert.deepEqual(JSON.parse(raw.toString('utf8')).props.length, 500);
});

test('one build is shared by concurrent requests and reused inside the window', async () => {
  let t = 0, builds = 0;
  const cache = createBoardResponseCache({ ttlMs: 15_000, now: () => t });
  const build = async () => { builds++; await new Promise(r => setTimeout(r, 20)); return board; };
  const [a, b] = await Promise.all([cache.get('MLB|main', build), cache.get('MLB|main', build)]);
  assert.equal(builds, 1);
  assert.deepEqual([a.cache, b.cache].sort(), ['miss', 'shared']);
  t = 10_000;
  assert.equal((await cache.get('MLB|main', build)).cache, 'hit');
  t = 16_000;
  assert.equal((await cache.get('MLB|main', build)).cache, 'stale', 'past the window the last board is served at once');
  await new Promise(r => setTimeout(r, 40));
  assert.equal(builds, 2, 'while one background rebuild runs');
  assert.equal((await cache.get('MLB|main', build)).cache, 'hit');
  t = 200_000;
  assert.equal((await cache.get('MLB|main', build)).cache, 'miss', 'a board older than the stale limit is never served');
  assert.equal(builds, 3);
  await cache.get('NBA|main', build);
  assert.equal(builds, 4, 'sports never share a board');
});

test('a failed build is not cached', async () => {
  const cache = createBoardResponseCache();
  await assert.rejects(cache.get('NFL|main', async () => { throw new Error('provider down'); }));
  assert.equal((await cache.get('NFL|main', async () => board)).cache, 'miss');
});

test('responses are gzipped when accepted, plain otherwise, and 304 on a matching ETag', async () => {
  const entry = await createBoardResponseCache().get('MLB|main', async () => board);
  // The board serialised independently: both paths must send exactly these bytes.
  const expected = await serializePublicBoard(board);
  assert.equal(entry.raw, undefined, 'only the compressed board is kept in memory');
  assert.equal(entry.rawLength, expected.length);
  assert.equal(entry.etag, '"' + crypto.createHash('sha1').update(expected).digest('base64url') + '"', 'the ETag is the raw bytes\' hash');
  const gz = fakeRes();
  await sendBoardResponse({ headers: { 'accept-encoding': 'gzip, deflate, br' } }, gz, entry);
  assert.equal(gz.out.status, 200);
  assert.equal(gz.out.headers['content-encoding'], 'gzip');
  assert.equal(gz.out.headers['x-autoscout-public-json'], '1', 'the frontdoor still sees the sanitiser attestation');
  assert.ok(gz.out.body.length < expected.length / 3);
  assert.ok(zlib.gunzipSync(gz.out.body).equals(expected));

  const plain = fakeRes();
  await sendBoardResponse({ headers: {} }, plain, entry);
  assert.equal(plain.out.headers['content-encoding'], undefined);
  assert.ok(Buffer.from(plain.out.body).equals(expected), 'a client without gzip gets byte-identical JSON');
  assert.equal(plain.out.headers['content-length'], expected.length);

  const notModified = fakeRes();
  await sendBoardResponse({ headers: { 'if-none-match': 'W/' + entry.etag } }, notModified, entry);
  assert.equal(notModified.out.status, 304);
  assert.equal(notModified.out.body, null);
});

test('a board past the stale window is freed when another is stored', async () => {
  let clock = 0;
  const cache = createBoardResponseCache({ ttlMs: 10, staleMs: 100, now: () => clock });
  await cache.get('MLB|main', async () => board);
  clock = 150;
  await cache.get('NFL|main', async () => board);
  // MLB is past its stale window: it is rebuilt on the next request, not served.
  let builds = 0;
  const again = await cache.get('MLB|main', async () => { builds++; return board; });
  assert.equal(again.cache, 'miss');
  assert.equal(builds, 1);
});
