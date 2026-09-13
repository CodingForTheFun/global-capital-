import { chromium } from 'playwright';

const DEFAULT_UA = process.env.AUTOSCOUT_PUBLIC_BROWSER_USER_AGENT ||
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
const MAX_BYTES = 20 * 1024 * 1024;
let browserPromise = null;

async function browser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    }).catch((error) => {
      browserPromise = null;
      throw error;
    });
  }
  return browserPromise;
}

function parseBody(text) {
  const body = String(text ?? '');
  if (Buffer.byteLength(body) > MAX_BYTES) {
    throw Object.assign(new Error('PUBLIC_BROWSER_TOO_LARGE'), { code: 'PUBLIC_BROWSER_TOO_LARGE' });
  }
  try { return JSON.parse(body); }
  catch { throw Object.assign(new Error('PUBLIC_BROWSER_INVALID_JSON'), { code: 'PUBLIC_BROWSER_INVALID_JSON' }); }
}

function contextOptions(userAgent, headers = {}) {
  return {
    userAgent,
    viewport: { width: 390, height: 844 },
    locale: 'en-US',
    extraHTTPHeaders: {
      'accept-language': 'en-US,en;q=0.9',
      ...headers,
    },
  };
}

export async function browserJsonDiscover(landingUrl, {
  urlIncludes = [],
  userAgent = DEFAULT_UA,
  timeoutMs = 25_000,
  headers = {},
} = {}) {
  const patterns = (Array.isArray(urlIncludes) ? urlIncludes : [urlIncludes]).map(String).filter(Boolean);
  if (!patterns.length) throw Object.assign(new Error('PUBLIC_BROWSER_MATCH_REQUIRED'), { code: 'PUBLIC_BROWSER_MATCH_REQUIRED' });
  const b = await browser();
  const context = await b.newContext(contextOptions(userAgent, headers));
  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);
  page.setDefaultNavigationTimeout(timeoutMs);
  let settled = false;
  let timer = null;
  try {
    const captured = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(Object.assign(new Error('PUBLIC_BROWSER_DISCOVERY_TIMEOUT'), { code: 'PUBLIC_BROWSER_DISCOVERY_TIMEOUT' }));
      }, timeoutMs);
      page.on('response', async (response) => {
        if (settled) return;
        const url = response.url();
        if (!patterns.some((pattern) => url.includes(pattern))) return;
        const status = response.status();
        if (status === 429) {
          settled = true;
          clearTimeout(timer);
          reject(Object.assign(new Error('PUBLIC_BROWSER_RATE_LIMITED'), { code: 'PUBLIC_BROWSER_RATE_LIMITED', status }));
          return;
        }
        if (status < 200 || status >= 300) return;
        try {
          const bytes = await response.body();
          if (bytes.byteLength > MAX_BYTES) return;
          const data = parseBody(bytes.toString('utf8'));
          settled = true;
          clearTimeout(timer);
          resolve({ data, url, status });
        } catch { /* keep listening for the next matching JSON response */ }
      });
    });
    try { await page.goto(landingUrl, { waitUntil: 'domcontentloaded', timeout: Math.min(timeoutMs, 15_000) }); }
    catch { /* network listener can still capture app requests after a partial load */ }
    return await captured;
  } finally {
    if (timer) clearTimeout(timer);
    await context.close().catch(() => {});
  }
}

export async function browserJsonFetch(url, {
  origin = null,
  referer = null,
  userAgent = DEFAULT_UA,
  timeoutMs = 20_000,
  headers = {},
} = {}) {
  const extraHTTPHeaders = {
    accept: 'application/json,text/plain,*/*',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    ...headers,
  };
  const b = await browser();
  const context = await b.newContext(contextOptions(userAgent, extraHTTPHeaders));
  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);
  page.setDefaultNavigationTimeout(timeoutMs);
  try {
    if (origin || referer) {
      const landing = referer || `${String(origin).replace(/\/$/, '')}/`;
      try { await page.goto(landing, { waitUntil: 'domcontentloaded', timeout: Math.min(timeoutMs, 12_000) }); }
      catch { /* Direct API navigation can still succeed. */ }
      try {
        const result = await page.evaluate(async ({ target, requestHeaders, requestTimeoutMs }) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
          try {
            const response = await fetch(target, {
              method: 'GET', credentials: 'include', cache: 'no-store', headers: requestHeaders, signal: controller.signal,
            });
            return { ok: response.ok, status: response.status, text: await response.text(), retryAfter: response.headers.get('retry-after') };
          } catch (error) {
            return { ok: false, status: 0, text: '', error: String(error?.message || error) };
          } finally {
            clearTimeout(timer);
          }
        }, { target: url, requestHeaders: extraHTTPHeaders, requestTimeoutMs: Math.min(timeoutMs, 12_000) });
        if (result?.ok) return parseBody(result.text);
        if (result?.status === 429) throw Object.assign(new Error('PUBLIC_BROWSER_RATE_LIMITED'), { code: 'PUBLIC_BROWSER_RATE_LIMITED', status: 429, retryAfter: result.retryAfter });
      } catch (error) {
        if (error?.status === 429) throw error;
      }
    }

    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    const status = response?.status() || 0;
    if (status === 429) throw Object.assign(new Error('PUBLIC_BROWSER_RATE_LIMITED'), { code: 'PUBLIC_BROWSER_RATE_LIMITED', status });
    if (status < 200 || status >= 300) throw Object.assign(new Error('PUBLIC_BROWSER_HTTP'), { code: 'PUBLIC_BROWSER_HTTP', status });
    const bytes = await response.body();
    if (bytes.byteLength > MAX_BYTES) throw Object.assign(new Error('PUBLIC_BROWSER_TOO_LARGE'), { code: 'PUBLIC_BROWSER_TOO_LARGE' });
    return parseBody(bytes.toString('utf8'));
  } finally {
    await context.close().catch(() => {});
  }
}

export async function closePublicBrowser() {
  const current = browserPromise;
  browserPromise = null;
  if (current) {
    try { await (await current).close(); } catch {}
  }
}
