// PropLine webhook receiver.
//
// This is the half of the Streaming tier that matters: instead of polling for
// line moves and storing the history ourselves, PropLine pushes each change as
// it happens and keeps the archive on its side. That removes both the request
// budget and the continuous write load that has been the problem here.
//
// A webhook endpoint is public by definition, so everything below treats the
// request as hostile until the signature says otherwise.
import crypto from 'node:crypto';

const text = (value) => String(value ?? '').trim();
const SECRET = () => text(process.env.PROPLINE_WEBHOOK_SECRET);
export function webhookConfigured() { return Boolean(SECRET()); }

export const EVENT_TYPES = Object.freeze(['line_movement', 'resolution', 'market_suspended', 'steam']);

// PropLine signs timestamp + body. A signature alone would let anyone replay a
// captured delivery forever, so the timestamp is checked too.
const MAX_SKEW_SECONDS = 300;

let state = {
  received: 0,
  accepted: 0,
  rejected: 0,
  lastEventAt: null,
  lastEventType: null,
  lastSequence: null,
  lastRejection: null,
  // Kept in the health shape for compatibility. PropLine documents sequence
  // numbers as monotonic but not dense, so numeric skips are not missed events.
  // Actual unrecoverable loss is reported by replay.truncated instead.
  gaps: [],
  byType: Object.fromEntries(EVENT_TYPES.map((type) => [type, 0])),
};

export function webhookHealth() {
  return { configured: webhookConfigured(), ...state, gaps: state.gaps.slice(-10) };
}
export function __resetWebhookState() {
  state = { received: 0, accepted: 0, rejected: 0, lastEventAt: null, lastEventType: null, lastSequence: null, lastRejection: null, gaps: [], byType: Object.fromEntries(EVENT_TYPES.map((t) => [t, 0])) };
}

export function signPayload(timestamp, rawBody, secret) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

/**
 * Verify one delivery.
 *
 * Returns a reason rather than throwing, because every outcome here is a normal
 * thing for a public endpoint to see and none of them should read as an
 * exception in the logs.
 */
export function verifyDelivery({ signature, timestamp, rawBody, secret = SECRET(), now = Date.now }) {
  if (!secret) return { ok: false, reason: 'WEBHOOK_NOT_CONFIGURED' };
  const given = text(signature).replace(/^sha256=/i, '');
  if (!given) return { ok: false, reason: 'MISSING_SIGNATURE' };

  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return { ok: false, reason: 'MISSING_TIMESTAMP' };
  const skew = Math.abs(Math.floor(now() / 1000) - sent);
  if (skew > MAX_SKEW_SECONDS) return { ok: false, reason: 'TIMESTAMP_OUT_OF_RANGE', skew };

  const expected = signPayload(sent, rawBody, secret);
  // Length must match before timingSafeEqual, which throws on mismatched sizes -
  // and comparing lengths first leaks nothing a wrong signature does not.
  if (given.length !== expected.length) return { ok: false, reason: 'BAD_SIGNATURE' };
  if (!crypto.timingSafeEqual(Buffer.from(given, 'utf8'), Buffer.from(expected, 'utf8'))) return { ok: false, reason: 'BAD_SIGNATURE' };
  return { ok: true };
}

/**
 * Record an accepted delivery and advance the subscription watermark.
 *
 * PropLine sequence numbers only guarantee monotonic ordering; they are not
 * guaranteed to be dense. A jump such as 11 -> 20 therefore cannot prove that
 * eight events were missed. Replay's `truncated` flag is the loss signal.
 */
export function noteDelivery(eventType, sequence) {
  const type = text(eventType);
  const seq = Number(sequence);
  const previous = state.lastSequence;
  state.received += 1;
  state.accepted += 1;
  state.lastEventAt = new Date().toISOString();
  state.lastEventType = type || null;
  if (type && type in state.byType) state.byType[type] += 1;
  if (Number.isFinite(seq) && (!Number.isFinite(previous) || seq > previous)) state.lastSequence = seq;
  return { gap: null, lastSequence: state.lastSequence };
}

export function noteRejection(reason) {
  state.received += 1;
  state.rejected += 1;
  state.lastRejection = { reason: text(reason) || 'UNKNOWN', at: new Date().toISOString() };
}

/** The highest processed sequence to resume from with /v1/webhooks/{id}/replay. */
export function replayCursor() {
  return state.lastSequence;
}
