// The HTTP surface for PropLine deliveries.
//
// Kept separate from verification so the route stays about HTTP and the crypto
// stays testable on its own.
import { noteDelivery, noteRejection, verifyDelivery, webhookConfigured, webhookHealth } from './webhooks.mjs';

export const WEBHOOK_PATH = '/api/propline/webhook';
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_BATCH_EVENTS = 500;

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

function deliveryItems(payload, fallbackType) {
  if (!payload?.batch) return [{ type: fallbackType, payload, deliveryId: null }];
  if (!Array.isArray(payload.events) || payload.events.length < 1 || payload.events.length > MAX_BATCH_EVENTS) return null;
  const envelopeType = String(payload.event_type || fallbackType || '').trim();
  const items = payload.events.map((entry) => ({
    type: String(entry?.event_type || envelopeType).trim(),
    payload: entry?.data ?? null,
    deliveryId: entry?.delivery_id ?? null,
  }));
  // Do not silently acknowledge a malformed child. If PropLine ever sends one,
  // rejecting the signed envelope is safer than advancing beyond data we did not
  // hand to the realtime consumer.
  if (items.some((entry) => !entry.payload || typeof entry.payload !== 'object')) return null;
  return items;
}

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

  const headerType = String(header('x-propline-event') || payload?.event || payload?.event_type || '').trim();
  const sequence = header('x-propline-sequence');
  const items = deliveryItems(payload, headerType);
  if (!items || !items.length) { noteRejection('INVALID_BATCH'); reply(res, 400, { ok: false, error: 'invalid_batch' }); return true; }

  // The sequence header is the subscription resume watermark. Record it once
  // per signed POST; individual batched elements are independently dedupable by
  // their PropLine delivery_id and are all forwarded to the event consumer.
  const { gap, lastSequence } = noteDelivery(headerType || items[0].type, sequence);

  // Answer first, work after: a retry storm is worse than a late update.
  reply(res, 200, { ok: true, received: headerType || items[0].type || null, sequence: lastSequence, gap: gap || null, batch: Boolean(payload.batch), count: items.length });

  if (typeof onEvent === 'function') {
    let earlierHandlerFailed = false;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const isLast = index === items.length - 1;
      // The durable realtime consumer uses sequence as its replay cursor. Do not
      // let the first child of a batch advance that cursor past siblings that
      // have not run yet. Only the last child may commit the envelope watermark,
      // and only when every earlier child completed successfully. If a child
      // fails, replay can safely resend the envelope; delivery_id dedupe keeps
      // already-processed siblings idempotent.
      const forwardedSequence = isLast && !earlierHandlerFailed ? Number(sequence) || null : null;
      try {
        await onEvent({ type: item.type, payload: item.payload, sequence: forwardedSequence, gap, deliveryId: item.deliveryId });
      } catch (error) {
        earlierHandlerFailed = true;
        console.log(`[PropLine webhook] handler failed type=${item.type} code=${String(error?.code || 'HANDLER_FAILED').slice(0, 60)}`);
      }
    }
  }
  return true;
}

export { webhookHealth };
