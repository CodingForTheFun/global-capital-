// Customer-facing payload hygiene.
//
// Vendor names, plan limits and credit balances are operating detail. They
// belong in the owner diagnostics page, never on a prop card or in a public
// API response. This scrubs them at the boundary, so a new provider message
// added upstream cannot leak to customers by default.
//
// Owner diagnostics deliberately do NOT pass through here.

// Each vendor gets its own neutral label rather than one shared word. A single
// label made two different providers identical in the payload — a capability
// list reading ["Live odds", "Live odds"] cannot tell a reader which one is
// primary, which is the entire point of publishing the order.
const VENDOR_RULES = Object.freeze([
  { pattern: /\bthe\s+odds\s+api\b/gi, label: 'Odds provider C' },
  { pattern: /\bsports\s*data\s*\.?\s*io\b/gi, label: 'Stats provider A' },
  { pattern: /\bsportsdataio\b/gi, label: 'Stats provider A' },
  { pattern: /\bclear\s*sports\b/gi, label: 'Stats provider B' },
  // Named the same as the paid vendors beside it. Leaving it out disclosed a
  // subscription the rest of this list exists to keep private.
  { pattern: /\bsport\s*radar\b/gi, label: 'Stats provider C' },
  { pattern: /\bsports\s*game\s*odds\b/gi, label: 'Odds provider A' },
  { pattern: /\bpickfinder\b/gi, label: 'Research provider' },
  { pattern: /\bthe-odds-api\b/gi, label: 'Odds provider C' },
  { pattern: /\bsportsdata-io\b/gi, label: 'Stats provider A' },
  { pattern: /\bprop\s*line\b/gi, label: 'Odds provider B' },
]);

const VENDOR_PATTERNS = Object.freeze(VENDOR_RULES.map((rule) => rule.pattern));

// Keys removed outright: quota, spend and internal plumbing.
const DROP_KEYS = new Set([
  'credits', 'creditsused', 'creditsusedtoday', 'monthlycredits', 'estimatedcreditsusedtoday',
  'quota', 'requestsused', 'requestsremaining', 'requeststoday', 'apiusage', 'usage',
  'maxevents', 'maxmarketsperevent', 'ratelimit', 'ratelimits',
  'endpoint', 'endpoints', 'apikey', 'apikeys', 'key', 'keys', 'token', 'tokens',
  'diagnostics', 'providerdiagnostics', 'providererrors', 'errors',
  'theoddsapiconfigured', 'sportsdataioconfigured', 'sportsgameoddsconfigured',
  'preferredprovider', 'providerid', 'historicalgamelogprovider', 'schema', 'stack',
  'backend', 'mode', 'lastwriteat', 'lastcounts', 'datasource', 'providercoverage', 'providerattempts',
]);

// Keys whose string value is a vendor label the customer should not see.
const GENERIC_LABEL_KEYS = new Set(['provider', 'source', 'sourcelabel', 'primary', 'providername']);

const GENERIC_ODDS_LABEL = 'Live odds';
const GENERIC_STATS_LABEL = 'Historical stats';

export function mentionsVendor(text) {
  return VENDOR_PATTERNS.some((pattern) => { pattern.lastIndex = 0; return pattern.test(String(text ?? '')); });
}

/** Strip vendor names from free text without leaving a dangling sentence. */
export function scrubText(text) {
  let out = String(text ?? '');
  for (const pattern of VENDOR_PATTERNS) { pattern.lastIndex = 0; out = out.replace(pattern, ''); }
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
}

/**
 * Does a scrubbed string still read as a sentence?
 *
 * The same test `customerMessage` already applies. A scrub that leaves a short
 * lowercase stub did not clean prose, it dismembered an identifier — which is
 * how `sportsdataio-research` was reaching customers as the fragment
 * `-research`.
 */
function readsAsProse(value) {
  return value.length >= 12 && !/^[a-z]/.test(value);
}

/**
 * A vendor identifier as its neutral label, with any role suffix kept.
 *
 * `propline` and `sportsgameodds` become different labels, so a fallback order
 * survives sanitisation, and `sportsdataio-research` keeps the part that says
 * what it is for instead of leaking a hyphen and a word.
 */
export function vendorLabel(value, fallback = GENERIC_ODDS_LABEL) {
  let out = String(value ?? '');
  for (const { pattern, label } of VENDOR_RULES) { pattern.lastIndex = 0; out = out.replace(pattern, label); }
  return out.replace(/(provider [A-Z])[-_]+/g, '$1 ').replace(/\s{2,}/g, ' ').trim() || fallback;
}

/**
 * Customer copy for a provider-shaped message.
 *
 * Coverage and entitlement wording ("does not document X endpoints", "not
 * included in the current subscription") describes our vendor contract, not
 * the customer's situation, so it is replaced rather than scrubbed.
 */
export function customerMessage(text) {
  const original = String(text ?? '').trim();
  if (!original) return original;

  if (/\b(endpoint|document|schema|undocumented)\b/i.test(original)) {
    return 'Historical data is not available for this league yet.';
  }
  if (/\b(subscription|entitl|plan|tier|quota|credit)\w*\b/i.test(original)) {
    return 'Historical data is not available for this player yet.';
  }
  if (mentionsVendor(original)) {
    const scrubbed = scrubText(original);
    // A scrub that gutted the sentence is worse than a clean generic one.
    if (scrubbed.length < 12 || /^[a-z]/.test(scrubbed)) {
      return 'Historical data is not available right now.';
    }
    return scrubbed;
  }
  return original;
}

const MESSAGE_KEYS = new Set(['message', 'reason', 'note', 'detail', 'description', 'warning', 'status_detail']);

/**
 * Recursively clean a payload for public consumption.
 * Shapes are preserved where callers may depend on them: a vendor label
 * becomes a generic label rather than disappearing.
 */
export function sanitizePublicPayload(value, { statsContext = false } = {}) {
  if (Array.isArray(value)) return value.map((row) => sanitizePublicPayload(row, { statsContext }));
  if (!value || typeof value !== 'object') {
    if (typeof value !== 'string' || !mentionsVendor(value)) return value;
    if (statsContext) return GENERIC_STATS_LABEL;
    // Prose is cleaned; an identifier is relabelled. Scrubbing an identifier
    // either empties it, collapsing distinct providers together, or leaves a
    // stub of whatever did not match.
    const scrubbed = scrubText(value);
    return readsAsProse(scrubbed) ? scrubbed : vendorLabel(value);
  }

  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (DROP_KEYS.has(lower)) continue;

    if (MESSAGE_KEYS.has(lower) && typeof raw === 'string') {
      out[key] = customerMessage(raw);
      continue;
    }
    if (GENERIC_LABEL_KEYS.has(lower) && typeof raw === 'string') {
      out[key] = mentionsVendor(raw)
        ? (statsContext || lower === 'primary' ? GENERIC_STATS_LABEL : GENERIC_ODDS_LABEL)
        : raw;
      continue;
    }
    out[key] = sanitizePublicPayload(raw, { statsContext });
  }
  return out;
}

export { GENERIC_ODDS_LABEL, GENERIC_STATS_LABEL };
