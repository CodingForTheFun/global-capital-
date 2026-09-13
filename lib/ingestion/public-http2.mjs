import http2 from 'node:http2';

const MAX_BYTES = 16 * 1024 * 1024;

function retryMs(value, now = Date.now) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Math.max(0, Number(raw) * 1000);
  const delta = Date.parse(raw) - now();
  return Number.isFinite(delta) && delta > 0 ? delta : null;
}

export function fetchHttp2Json(url, headers = {}, { timeoutMs = 12_000, maxBytes = MAX_BYTES, now = Date.now } = {}) {
  const target = new URL(url);
  if (target.protocol !== 'https:') throw Object.assign(new Error('PUBLIC_HTTP2_HTTPS_REQUIRED'), { code: 'PUBLIC_HTTP2_HTTPS_REQUIRED' });

  return new Promise((resolve, reject) => {
    let done = false;
    let request = null;
    let status = 0;
    let responseHeaders = null;
    const chunks = [];
    let total = 0;

    const session = http2.connect(target.origin);
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { request?.close(); } catch {}
      try { session.close(); } catch {}
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(Object.assign(new Error('PUBLIC_HTTP2_TIMEOUT'), { code: 'PUBLIC_HTTP2_TIMEOUT' })), timeoutMs);
    timer.unref?.();

    session.once('error', (error) => finish(Object.assign(error, { code: error?.code || 'PUBLIC_HTTP2_CONNECT_FAILED' })));
    session.once('connect', () => {
      try {
        const requestHeaders = {
          ':method': 'GET',
          ':scheme': 'https',
          ':authority': target.host,
          ':path': `${target.pathname}${target.search}`,
        };
        for (const [key, value] of Object.entries(headers || {})) {
          const name = String(key).toLowerCase();
          if (!name.startsWith(':') && value != null && !['connection','host','upgrade','transfer-encoding'].includes(name)) requestHeaders[name] = String(value);
        }
        request = session.request(requestHeaders, { endStream: true });
        request.once('response', (incoming) => {
          responseHeaders = incoming;
          status = Number(incoming[':status'] || 0);
        });
        request.on('data', (chunk) => {
          total += chunk.length;
          if (total > maxBytes) return finish(Object.assign(new Error('PUBLIC_FEED_TOO_LARGE'), { code: 'PUBLIC_FEED_TOO_LARGE' }));
          chunks.push(Buffer.from(chunk));
        });
        request.once('end', () => {
          if (status < 200 || status >= 300) {
            return finish(Object.assign(new Error('PUBLIC_FEED_HTTP'), {
              code: 'PUBLIC_FEED_HTTP',
              status,
              retryMs: retryMs(responseHeaders?.['retry-after'], now),
              transport: 'http2',
            }));
          }
          try {
            finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            finish(Object.assign(new Error('PUBLIC_FEED_INVALID_JSON'), { code: 'PUBLIC_FEED_INVALID_JSON', status, transport: 'http2' }));
          }
        });
        request.once('error', (error) => finish(Object.assign(error, { code: error?.code || 'PUBLIC_HTTP2_REQUEST_FAILED' })));
        request.end();
      } catch (error) {
        finish(error);
      }
    });
  });
}
