// Shared, compressed props-board responses.
//
// A sport's board is tens of megabytes of JSON. Building it (store read,
// audit decoration, per-row public sanitising) took 1-14 s and was repeated
// for every visitor, then sent uncompressed. Here each sport's board is built
// once per short window, sanitised by the same publicJsonChunks pass, gzipped
// off the main thread, and the same bytes are served to every request in that
// window. Concurrent requests for a board being built wait for that one build.
//
// The window is short (15 s by default) because live PropLine pushes are
// overlaid on the board; a refresh is never more than one window behind.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { publicJsonChunks } from './public-board-response.mjs';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const yieldToEventLoop = () => new Promise(resolve => setImmediate(resolve));

/**
 * The sanitised JSON as one Buffer. Yields to the event loop every ~2 MB so a
 * large build never stalls other requests on this process.
 */
export async function serializePublicBoard(body) {
  const parts = [];
  let pending = '', sinceYield = 0;
  for (const chunk of publicJsonChunks(body)) {
    pending += chunk;
    if (pending.length >= 262_144) {
      parts.push(Buffer.from(pending));
      sinceYield += pending.length;
      pending = '';
      if (sinceYield >= 2_000_000) { sinceYield = 0; await yieldToEventLoop(); }
    }
  }
  if (pending) parts.push(Buffer.from(pending));
  return Buffer.concat(parts);
}

export function createBoardResponseCache({ ttlMs = 15_000, staleMs = 60_000, now = () => Date.now(), maxEntries = 24 } = {}) {
  const entries = new Map();
  const building = new Map();

  /**
   * build() returns the board body; the result is shared for ttlMs. Between
   * ttlMs and staleMs the previous board is served at once while one rebuild
   * runs in the background, so a visitor never waits on a refresh.
   */
  async function get(key, build) {
    const hit = entries.get(key);
    const age = hit ? now() - hit.builtAt : Infinity;
    if (hit && age < ttlMs) return { ...hit, cache: 'hit' };
    if (hit && age < staleMs) {
      if (!building.has(key)) start(key, build).catch(() => { /* the stale board keeps serving */ });
      return { ...hit, cache: 'stale' };
    }
    if (building.has(key)) return { ...(await building.get(key)), cache: 'shared' };
    return { ...(await start(key, build)), cache: 'miss' };
  }

  function start(key, build) {
    const task = (async () => {
      const started = now();
      const body = await build();
      const raw = await serializePublicBoard(body);
      const gz = await gzip(raw, { level: 5 });
      // Only the compressed bytes are kept: an MLB board is ~110 MB raw and
      // ~5 MB gzipped, and holding both for every sport pushed the data core
      // toward its heap limit. A client without gzip gets the same bytes back
      // by gunzip; the ETag is taken from the raw bytes before they are freed.
      const entry = {
        gz, rawLength: raw.length, builtAt: now(), buildMs: Math.max(0, now() - started),
        etag: '"' + crypto.createHash('sha1').update(raw).digest('base64url') + '"',
        meta: body?.meta || null,
      };
      entries.set(key, entry);
      // Past the stale window an entry can never be served again; free it.
      for (const [k, e] of entries) if (k !== key && now() - e.builtAt >= staleMs) entries.delete(k);
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
      return entry;
    })().finally(() => building.delete(key));
    building.set(key, task);
    return task;
  }

  return { get, clear: () => entries.clear() };
}

/** The uncompressed board, for the rare client that does not accept gzip. */
export async function rawBoard(entry) {
  return entry.raw || gunzip(entry.gz);
}

/** Send a cached board: 304 on a matching ETag, gzip when accepted. */
export async function sendBoardResponse(req, res, entry) {
  const base = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, max-age=0',
    'x-content-type-options': 'nosniff',
    // The frontdoor pipes only responses that attest the shared sanitiser ran.
    'x-autoscout-public-json': '1',
    etag: entry.etag,
    vary: 'Accept-Encoding',
    'x-board-cache': entry.cache || 'miss',
  };
  const match = String(req.headers['if-none-match'] || '').split(',').map(v => v.trim().replace(/^W\//, ''));
  if (match.includes(entry.etag)) { res.writeHead(304, base); res.end(); return 304; }
  const acceptsGzip = /\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''));
  const body = acceptsGzip ? entry.gz : await rawBoard(entry);
  res.writeHead(200, { ...base, ...(acceptsGzip ? { 'content-encoding': 'gzip' } : {}), 'content-length': body.length });
  res.end(body);
  return 200;
}
