// Keep one bad promise from taking the site down.
//
// Node exits on an unhandled promise rejection. This service runs a single
// replica behind a volume, and Railway stops restarting after five failures, so
// a crash loop is not a blip — it is the site down until somebody notices.
//
// The rejections this code can actually produce come from background work:
// ingestion ticks, upstream sportsbook fetches, persistence retries. A book
// timing out is not a reason to drop every signed-in user's request, so an
// unhandled rejection is logged and survived.
//
// An uncaught exception is different. It unwound a stack somewhere unknown and
// may have left state half-written, so the honest response is to log it, stop
// taking new connections and let the platform start a clean process.
//
// Logs are bounded and scrubbed: upstream errors quote URLs, and those URLs
// carry API keys.

const MAX_MESSAGE = 400;

// Anything shaped like a credential, whether in a query string, a header dump
// or a JSON body. Keys are worth more than the log line they appear in.
const SECRET_PATTERNS = [
  /([?&](?:api[_-]?key|key|token|secret|password|auth|signature|sig)=)[^&\s]+/gi,
  /((?:api[_-]?key|authorization|token|secret|password)["'\s:=]+)[A-Za-z0-9._\-]{8,}/gi,
  /\b(sk-|xox[baprs]-|AIza)[A-Za-z0-9._\-]{8,}/gi,
  /\bBearer\s+[A-Za-z0-9._\-]{8,}/gi,
];

/** A log-safe one-liner for an arbitrary thrown value. */
export function describeFailure(error) {
  let message;
  if (error instanceof Error) {
    message = [error.name, error.message].filter(Boolean).join(': ');
    if (error.code) message += ` (${error.code})`;
  } else if (typeof error === 'string') {
    message = error;
  } else {
    try { message = JSON.stringify(error); } catch { message = Object.prototype.toString.call(error); }
  }
  message = String(message ?? 'unknown');
  for (const pattern of SECRET_PATTERNS) message = message.replace(pattern, (_m, prefix = '') => `${prefix}[redacted]`);
  message = message.replace(/\s+/g, ' ').trim();
  return message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE)}…` : message;
}

/**
 * Install the guards.
 *
 * @param label        which process this is, so logs say where it came from.
 * @param logger       injectable for tests.
 * @param onFatal      what to do about an uncaught exception. Defaults to a
 *                     graceful stop so the platform restarts a clean process.
 * @param process      injectable for tests.
 * @returns a function that removes the listeners again.
 */
export function installProcessGuards({
  label = 'service', logger = console, onFatal = null, proc = process,
} = {}) {
  const onRejection = (reason) => {
    // Survivable by design: background work failing is not a reason to drop
    // every in-flight request from every signed-in user.
    logger.error(`[${label}] unhandled rejection (continuing)`, describeFailure(reason));
  };
  const onException = (error) => {
    logger.error(`[${label}] uncaught exception (stopping)`, describeFailure(error));
    if (onFatal) { onFatal(error); return; }
    // No graceful-stop hook supplied: exit non-zero so the platform restarts.
    proc.exit(1);
  };
  proc.on('unhandledRejection', onRejection);
  proc.on('uncaughtException', onException);
  return () => {
    proc.off?.('unhandledRejection', onRejection);
    proc.off?.('uncaughtException', onException);
  };
}
