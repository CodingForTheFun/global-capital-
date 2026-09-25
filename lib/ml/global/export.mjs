// One bounded pull of PropLine's resolved-props export for one sport and window.
//
// The export is CSV and can be large, so it is streamed and reduced on the
// fly; nothing but the per-game reducer state is held in memory. It has its
// own daily call cap (Streaming Lite: 100/day), reported in
// X-PropLine-Export-Daily-Remaining, which the scheduler reads to stop early.
// The API key goes in a header, never the URL, and is never logged.
import { PROPLINE_BASE, proplineConfigured, proplineTrafficEnabled, proplineNoteQuota } from '../../data-sources/propline/client.mjs';
import { createCsvStream } from './csv.mjs';
import { createObservationReducer, REQUIRED_COLUMNS } from './observations.mjs';

const header = (headers, name) => {
  const v = headers?.get?.(name);
  return v === null || v === undefined || v === '' ? null : String(v);
};

export async function fetchResolvedWindow({ sportKey, since, until, maxGroups, maxBytes = 512 * 1024 * 1024, timeoutMs = 240_000 } = {}, {
  fetcher = globalThis.fetch,
  apiKey = () => String(process.env.PROPLINE_API_KEY || '').trim(),
} = {}) {
  if (!proplineTrafficEnabled()) return { ok: false, code: 'PROPLINE_DISABLED_BY_PROVIDER_MODE' };
  if (!proplineConfigured()) return { ok: false, code: 'PROPLINE_NOT_CONFIGURED' };
  const url = new URL(PROPLINE_BASE + '/v1/exports/resolved-props');
  url.searchParams.set('sport', sportKey);
  if (since) url.searchParams.set('since', new Date(since).toISOString());
  if (until) url.searchParams.set('until', new Date(until).toISOString());

  let response;
  try {
    response = await fetcher(url, { headers: { accept: 'text/csv', 'x-api-key': apiKey() }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    return { ok: false, code: error?.name === 'TimeoutError' ? 'EXPORT_TIMEOUT' : 'EXPORT_UNREACHABLE' };
  }
  proplineNoteQuota(response.headers);
  const meta = {
    dailyRemaining: header(response.headers, 'x-propline-export-daily-remaining'),
    windowStart: header(response.headers, 'x-propline-export-window-start'),
    archiveStarts: header(response.headers, 'x-propline-archive-starts'),
    archiveNotice: header(response.headers, 'x-propline-archive-notice'),
  };
  if (!response.ok) {
    try { await response.body?.cancel?.(); } catch { /* ignore */ }
    const code = response.status === 429 ? 'EXPORT_DAILY_CAP' : response.status === 401 || response.status === 403 ? 'EXPORT_NOT_ENTITLED' : `EXPORT_HTTP_${response.status}`;
    return { ok: false, code, status: response.status, meta };
  }

  const reducer = createObservationReducer({ sportKey, maxGroups });
  let schemaOk = true, missing = [];
  const csv = createCsvStream(record => reducer.add(record), {
    onHeader: columns => {
      missing = REQUIRED_COLUMNS.filter(c => !columns.includes(c));
      schemaOk = missing.length === 0;
      return schemaOk;
    },
  });
  const decoder = new TextDecoder();
  let bytes = 0, truncated = false;
  try {
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > maxBytes) { truncated = true; break; }
      if (!csv.push(decoder.decode(chunk, { stream: true }))) break;
    }
    if (!truncated) csv.push(decoder.decode()), csv.end();
  } catch {
    return { ok: false, code: 'EXPORT_STREAM_FAILED', meta };
  } finally {
    try { await response.body?.cancel?.(); } catch { /* already closed */ }
  }
  if (!schemaOk) return { ok: false, code: 'EXPORT_SCHEMA_UNRECOGNIZED', missing, meta };
  const stats = reducer.stats();
  // A window cut short is never stored as if it were complete.
  if (stats.overflow || truncated) return { ok: false, code: 'EXPORT_WINDOW_TOO_LARGE', stats: { ...stats, bytes }, meta };
  return { ok: true, observations: reducer.finish(), stats: { ...stats, bytes }, meta };
}
