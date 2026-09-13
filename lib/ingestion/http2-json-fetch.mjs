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

export async function http2JsonFetch(url, { timeoutMs = 15_000, headers = {} } = {}) {
  const target = new URL(url);
  if (target.protocol !== 'https:') throw Object.assign(new Error('PUBLIC_HTTP2_HTTPS_REQUIRED'), { code: 'PUBLIC_HTTP2_HTTPS_REQUIRED' });
  const origin = `${target.protocol}//${target.host}`;
  const client = http2.connect(origin);
  let timer;
  try {
    const result = await new Promise((resolve, reject) => {
      let responseHeaders = null;
      let total = 0;
      let finished = false;
      const chunks = [];
      const req = client.request({
        ':method': 'GET',
        ':scheme': 'https',
        ':authority': target.host,
        ':path': `${target.pathname}${target.search}`,
        accept: 'application/json,text/plain,*/*',
        'user-agent': process.env.AUTOSCOUT_PUBLIC_HTTP2_USER_AGENT || 'AutoScout-PublicFeed/1.0',
        ...headers,
      });
      timer = setTimeout(() => req.close(http2.constants.NGHTTP2_CANCEL), timeoutMs);
      req.on('response', headers => { responseHeaders = headers; });
      req.on('data', chunk => {
        if (finished) return;
        total += chunk.length;
        if (total > MAX_BYTES) {
          finished = true;
          req.close(http2.constants.NGHTTP2_CANCEL);
          reject(Object.assign(new Error('PUBLIC_HTTP2_TOO_LARGE'), { code: 'PUBLIC_HTTP2_TOO_LARGE', stage: 'wire', bytes: total, maxBytes: MAX_BYTES }));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      req.on('end', () => {
        if (finished) return;
        finished = true;
        resolve({ headers: responseHeaders || {}, body: Buffer.concat(chunks) });
      });
      req.on('error', error => { if (!finished) { finished = true; reject(error); } });
      req.end();
    });
    const status = Number(result.headers[':status'] || 0);
    if (status < 200 || status >= 300) {
      throw Object.assign(new Error('PUBLIC_HTTP2_HTTP'), {
        code: 'PUBLIC_HTTP2_HTTP',
        status,
        server: text(result.headers.server) || null,
        contentType: text(result.headers['content-type']) || null,
        retryAfter: text(result.headers['retry-after']) || null,
      });
    }
    const decoded = decodeBody(result.body, result.headers['content-encoding']);
    if (decoded.length > MAX_BYTES) throw Object.assign(new Error('PUBLIC_HTTP2_TOO_LARGE'), { code: 'PUBLIC_HTTP2_TOO_LARGE', stage: 'decoded', bytes: decoded.length, maxBytes: MAX_BYTES });
    try { return JSON.parse(decoded.toString('utf8')); }
    catch { throw Object.assign(new Error('PUBLIC_HTTP2_INVALID_JSON'), { code: 'PUBLIC_HTTP2_INVALID_JSON', status }); }
  } finally {
    if (timer) clearTimeout(timer);
    client.close();
  }
}
