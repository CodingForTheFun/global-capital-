/** One request; no retries, endpoint changes, credentials, or paid fallback. */
export async function fetchPublicFeedJson(url, {
  fetcher = globalThis.fetch, headers = {}, now = Date.now,
  maxBytes = 16 * 1024 * 1024, timeoutMs = 12_000,
} = {}) {
  const endpoint = new URL(url).host;
  const controller = new AbortController();
  const timeout = Object.assign(new Error('PUBLIC_FEED_TIMEOUT'), { code: 'PUBLIC_FEED_TIMEOUT' });
  const timer = setTimeout(() => controller.abort(timeout), timeoutMs);
  timer.unref?.();
  let response, reader;
  try {
    response = await fetcher(url, { headers, signal: controller.signal, redirect: 'follow' });
    if (!response.ok) {
      const retry = response.headers.get('retry-after');
      const ms = retry && /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry || '') - now();
      throw Object.assign(new Error('PUBLIC_FEED_HTTP'), {
        code: 'PUBLIC_FEED_HTTP', status: response.status, endpoint,
        retryMs: Number.isFinite(ms) && ms > 0 ? ms : null,
      });
    }
    reader = response.body?.getReader();
    if (!reader) return await response.json();
    let total = 0;
    const chunks = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw Object.assign(new Error('PUBLIC_FEED_TOO_LARGE'), {
        code: 'PUBLIC_FEED_TOO_LARGE', reason: 'PUBLIC_FEED_TOO_LARGE', endpoint,
      });
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason === timeout) throw timeout;
    // Do not add endpoint metadata to transport failures: the legacy worker
    // uses its presence to decide whether OTHER sources may launch fallbacks.
    throw error;
  } finally {
    clearTimeout(timer);
    // Non-2xx bodies used to be abandoned. Cancel even when no reader was taken,
    // and abort our request so cleanup cannot hold the ingestion slot open.
    try {
      const cleanup = reader ? reader.cancel() : response?.body?.cancel();
      Promise.resolve(cleanup).catch(() => {});
    } catch {}
    controller.abort();
  }
}

export function publicFeedErrorCode(error) {
  if (error?.code === 'INGESTION_DEADLINE') return 'INGESTION_DEADLINE';
  if (error?.code === 'PUBLIC_FEED_TIMEOUT' || error?.name === 'TimeoutError') return 'PUBLIC_FEED_TIMEOUT';
  if (error?.status) return 'PUBLIC_FEED_HTTP';
  return /^[A-Z][A-Z0-9_]{1,79}$/.test(String(error?.code || '')) ? error.code : 'PUBLIC_FEED_FAILED';
}

/** A primary transport timeout is not an access challenge from the spare URL.
 * Wait for the SAME existing scheduled retry instead of spawning more transports.
 * Genuine HTTP access failures keep their existing zero-credit recovery path. */
export function deferUnderdogTimeoutFallback(source, snapshot) {
  if (source !== 'underdog' || !snapshot || ['available', 'no_props'].includes(snapshot.status)) return false;
  return snapshot.primaryCode === 'PUBLIC_FEED_TIMEOUT'
    || snapshot.primaryCode === 'INGESTION_DEADLINE'
    || (!snapshot.primaryCode && /aborted due to timeout|PUBLIC_FEED_TIMEOUT/i.test(String(snapshot.reason || '')));
}
