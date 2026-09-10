import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = path.resolve('lib/autoscout/providers/thesportsdb-artwork.mjs');

test('player artwork provider returns cached real image bytes and metadata when a matching athlete exists', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'autoscout-artwork-'));
  const originalDataDir = process.env.DATA_DIR;
  const originalFetch = globalThis.fetch;
  process.env.DATA_DIR = dir;
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls += 1;
    const url = String(input);
    if (url.includes('searchplayers.php')) {
      return new Response(JSON.stringify({
        player: [{
          strPlayer: 'Juwan Johnson',
          strSport: 'American Football',
          strTeam: 'New Orleans Saints',
          strPosition: 'Tight End',
          strCutout: 'https://images.example/juwan.png',
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === 'https://images.example/juwan.png') {
      return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const mod = await import(`${pathToFileURL(modulePath).href}?test=${Date.now()}`);
    const first = await mod.playerArtworkResponse('NFL', 'Juwan Johnson');
    assert.equal(first.status, 200);
    assert.equal(first.contentType, 'image/png');
    assert.equal(first.source, 'TheSportsDB');
    assert.equal(first.team, 'New Orleans Saints');
    assert.equal(first.position, 'Tight End');
    assert.ok(Buffer.isBuffer(first.body));
    assert.ok(first.body.length > 0);

    const second = await mod.playerArtworkResponse('NFL', 'Juwan Johnson');
    assert.equal(second.source, 'TheSportsDB');
    assert.equal(calls, 2, 'second lookup should use local cache instead of hitting remote APIs again');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('player artwork provider degrades to a generated placeholder without inventing a photograph', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'autoscout-artwork-miss-'));
  const originalDataDir = process.env.DATA_DIR;
  const originalFetch = globalThis.fetch;
  process.env.DATA_DIR = dir;
  globalThis.fetch = async () => new Response(JSON.stringify({ player: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  try {
    const mod = await import(`${pathToFileURL(modulePath).href}?miss=${Date.now()}`);
    const result = await mod.playerArtworkResponse('MLB', 'Unknown Player');
    assert.equal(result.status, 200);
    assert.equal(result.contentType, 'image/svg+xml');
    assert.equal(result.source, 'placeholder');
    assert.match(result.body.toString('utf8'), /<svg/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    rmSync(dir, { recursive: true, force: true });
  }
});
