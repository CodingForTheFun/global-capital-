// Customer-facing payload hygiene.
//
// Vendor names, plan limits and credit balances are operating detail. They
// belong in the owner diagnostics page, never on a prop card or in a public
// API response. This scrubs them at the boundary, so a new provider message
// added upstream cannot leak to customers by default.
//
// Owner diagnostics deliberately do NOT pass through here.

const VENDOR_PATTERNS = Object.freeze([
  /\bthe\s+odds\s+api\b/gi,
  /\bsports\s*data\s*\.?\s*io\b/gi,
  /\bsportsdataio\b/gi,
  /\bclear\s*sports\b/gi,
  /\bsports\s*game\s*odds\b/gi,
  /\bpickfinder\b/gi,
  /\bthe-odds-api\b/gi,
  /\bsportsdata-io\b/gi,
]);

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
    return typeof value === 'string' && mentionsVendor(value)
      ? (statsContext ? GENERIC_STATS_LABEL : scrubText(value) || GENERIC_ODDS_LABEL)
      : value;
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
