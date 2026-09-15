// The HTTP surface for PropLine deliveries.
//
// Kept separate from verification so the route stays about HTTP and the crypto
// stays testable on its own.
import { noteDelivery, noteRejection, verifyDelivery, webhookConfigured, webhookHealth } from './webhooks.mjs';

export const WEBHOOK_PATH = '/api/propline/webhook';
const MAX_BODY_BYTES = 2 * 1024 * 1024;

async function readRaw(req, limit = MAX_BODY_BYTES) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Webhook body too large.'), { code: 'BODY_TOO_LARGE' });
    chunks.push(chunk);
  }
  // The signature covers the exact bytes sent, so the raw string is what gets
  // verified - parsing first and re-serializing would change it.
  return Buffer.concat(chunks).toString('utf8');
}

const reply = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store' });
  res.end(payload);
};

/**
 * Handle one delivery. Returns true when it owned the request.
 *
 * On a verified delivery this always answers 200 quickly. PropLine retries
 * anything else, so slow or failing responses turn one problem into a queue of
 * them; the work a delivery triggers must not happen inside the response.
 */
export async function handleProplineWebhook(req, res, { onEvent = null } = {}) {
  if (req.method !== 'POST') { reply(res, 405, { ok: false, error: 'method_not_allowed' }); return true; }
  if (!webhookConfigured()) { noteRejection('WEBHOOK_NOT_CONFIGURED'); reply(res, 503, { ok: false, error: 'not_configured' }); return true; }

  let rawBody;
  try { rawBody = await readRaw(req); }
  catch { noteRejection('BODY_TOO_LARGE'); reply(res, 413, { ok: false, error: 'payload_too_large' }); return true; }

  const header = (name) => req.headers?.[name] ?? null;
  const check = verifyDelivery({
    signature: header('x-propline-signature'),
    timestamp: header('x-propline-timestamp'),
    rawBody,
  });
  if (!check.ok) {
    noteRejection(check.reason);
    // 401 and no detail: a public endpoint should not explain to an unverified
    // caller which part of its forgery was wrong.
    reply(res, 401, { ok: false, error: 'unauthorized' });
    return true;
  }

  let payload = null;
  try { payload = JSON.parse(rawBody); } catch { payload = null; }
  if (!payload) { noteRejection('INVALID_JSON'); reply(res, 400, { ok: false, error: 'invalid_json' }); return true; }

  const eventType = String(header('x-propline-event') || payload?.event || '').trim();
  const sequence = header('x-propline-sequence');
  const { gap, lastSequence } = noteDelivery(eventType, sequence);

  // Answer first, work after: a retry storm is worse than a late update.
  reply(res, 200, { ok: true, received: eventType || null, sequence: lastSequence, gap: gap || null });

  if (typeof onEvent === 'function') {
    try { await onEvent({ type: eventType, payload, sequence: Number(sequence) || null, gap }); }
    catch (error) { console.log(`[PropLine webhook] handler failed type=${eventType} code=${String(error?.code || 'HANDLER_FAILED').slice(0, 60)}`); }
  }
  return true;
}

export { webhookHealth };
