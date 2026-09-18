import { assertIngestionActive, ingestionSignal } from './operation-deadline.mjs';
import http2 from 'node:http2';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib';

const maxConfigured = Number(process.env.AUTOSCOUT_PUBLIC_HTTP2_MAX_BYTES || 64 * 1024 * 1024);
const MAX_BYTES = Number.isFinite(maxConfigured)
  ? Math.max(8 * 1024 * 1024, Math.min(96 * 1024 * 1024, Math.floor(maxConfigured)))
  : 64 * 1024 * 1024;
const text = value => String(value ?? '').trim();

function decodeBody(buffer, encoding) {
  const value = text(encoding).toLowerCase();
  if (!value || value === 'identity') return buffer;
  if (value === 'gzip') return gunzipSync(buffer);
  if (value === 'deflate') return inflateSync(buffer);
  if (value === 'br') return brotliDecompressSync(buffer);
  throw Object.assign(new Error('PUBLIC_HTTP2_ENCODING_UNSUPPORTED'), { code: 'PUBLIC_HTTP2_ENCODING_UNSUPPORTED' });
}

// Each call owns its session. Never wait for graceful close after a deadline:
// close-only streams and failed connections do not necessarily emit `end`.
export async function __requestOnce(url, { timeoutMs, headers = {}, signal: suppliedSignal, connect = http2.connect }) {
  const signal = ingestionSignal(suppliedSignal);
  signal?.throwIfAborted();
  const target = new URL(url);
  if (target.protocol !== 'https:') throw Object.assign(new Error('PUBLIC_HTTP2_HTTPS_REQUIRED'), { code: 'PUBLIC_HTTP2_HTTPS_REQUIRED' });
  const client = connect(`${target.protocol}//${target.host}`);
  let timer, req, onAbort;
  try {
    return await new Promise((resolve, reject) => {
      let responseHeaders = null, total = 0, finished = false;
      const chunks = [];
      const fail = (error) => {
        if (finished) return;
        finished = true;
        reject(error);
      };
      const closed = () => fail(Object.assign(new Error('PUBLIC_HTTP2_PREMATURE_CLOSE'), { code: 'PUBLIC_HTTP2_PREMATURE_CLOSE' }));
      // Keep error handlers through destruction so a late transport error is
      // consumed, not an unhandled process event. The session is not pooled.
      client.on('error', fail);
      client.once('close', closed);
      req = client.request({
        ':method': 'GET', ':scheme': 'https', ':authority': target.host,
        ':path': `${target.pathname}${target.search}`,
        accept: 'application/json,text/plain,*/*',
        'user-agent': process.env.AUTOSCOUT_PUBLIC_HTTP2_USER_AGENT || 'AutoScout-PublicFeed/1.0',
        ...headers,
      });
      onAbort = () => fail(signal.reason);
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => fail(Object.assign(new Error('PUBLIC_HTTP2_TIMEOUT'), { code: 'PUBLIC_HTTP2_TIMEOUT' })), timeoutMs);
      req.on('response', response => { responseHeaders = response; });
      req.on('data', chunk => {
        if (finished) return;
        total += chunk.length;
        if (total > MAX_BYTES) {
          fail(Object.assign(new Error('PUBLIC_HTTP2_TOO_LARGE'), { code: 'PUBLIC_HTTP2_TOO_LARGE', stage: 'wire', bytes: total, maxBytes: MAX_BYTES }));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      req.on('end', () => {
        if (finished) return;
        finished = true;
        resolve({ headers: responseHeaders || {}, body: Buffer.concat(chunks), target });
      });
      req.on('error', fail);
      req.once('close', closed);
      if (signal?.aborted) onAbort();
      else req.end();
    });
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    // Destroy (rather than close) also releases a still-connecting session.
    req?.destroy();
    client.destroy();
  }
}

export async function http2JsonFetch(url, { timeoutMs = 15_000, headers = {}, maxRedirects = 3, signal } = {}) {
  let current = new URL(url);
  const redirects = Math.max(0, Math.min(5, Number(maxRedirects) || 0));
  for (let hop = 0; hop <= redirects; hop += 1) {
    assertIngestionActive();
    const result = await __requestOnce(current, { timeoutMs, headers, signal });
    assertIngestionActive();
    const status = Number(result.headers[':status'] || 0);
    if (status >= 300 && status < 400) {
      const location = text(result.headers.location);
      if (!location || hop >= redirects) {
        throw Object.assign(new Error('PUBLIC_HTTP2_HTTP'), {
          code: 'PUBLIC_HTTP2_HTTP', status, server: text(result.headers.server) || null,
          contentType: text(result.headers['content-type']) || null, retryAfter: text(result.headers['retry-after']) || null,
        });
      }
      const next = new URL(location, current);
      if (next.protocol !== 'https:') throw Object.assign(new Error('PUBLIC_HTTP2_REDIRECT_REJECTED'), { code: 'PUBLIC_HTTP2_REDIRECT_REJECTED', status });
      current = next;
      continue;
    }
    if (status < 200 || status >= 300) {
      throw Object.assign(new Error('PUBLIC_HTTP2_HTTP'), {
        code: 'PUBLIC_HTTP2_HTTP', status, server: text(result.headers.server) || null,
        contentType: text(result.headers['content-type']) || null, retryAfter: text(result.headers['retry-after']) || null,
      });
    }
    const decoded = decodeBody(result.body, result.headers['content-encoding']);
    if (decoded.length > MAX_BYTES) throw Object.assign(new Error('PUBLIC_HTTP2_TOO_LARGE'), { code: 'PUBLIC_HTTP2_TOO_LARGE', stage: 'decoded', bytes: decoded.length, maxBytes: MAX_BYTES });
    try { return JSON.parse(decoded.toString('utf8')); }
    catch { throw Object.assign(new Error('PUBLIC_HTTP2_INVALID_JSON'), { code: 'PUBLIC_HTTP2_INVALID_JSON', status }); }
  }
  throw Object.assign(new Error('PUBLIC_HTTP2_REDIRECT_LOOP'), { code: 'PUBLIC_HTTP2_REDIRECT_LOOP' });
}
