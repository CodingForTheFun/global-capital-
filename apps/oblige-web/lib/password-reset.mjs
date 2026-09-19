// Browser-only recovery transport. Codes/passwords stay in POST bodies and
// memory, never URLs, browser storage, telemetry, or automatic retries.
export const RESET_SENT_MESSAGE = 'If that email address has an account, a reset code is on its way. Check your inbox and spam folder.';
export const RESET_COOLDOWN_SECONDS = 60;
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

export class PasswordResetError extends Error {
  constructor(message, code = 'REQUEST_FAILED', status = 0) {
    super(message);
    this.name = 'PasswordResetError';
    this.code = code;
    this.status = status;
  }
}

export function validateResetInput({ email, code, password, confirmPassword }, completing = false) {
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Enter a valid email address.';
  if (!completing) return null;
  if (!/^\d{6}$/.test(String(code ?? '').trim())) return 'Enter the six-digit code from your reset email.';
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) return 'Use at least 10 characters for your new password.';
  if (password.length > PASSWORD_MAX_LENGTH) return 'Use no more than 200 characters for your new password.';
  if (password !== confirmPassword) return 'Your new passwords do not match.';
  return null;
}

const ERROR_MESSAGES = Object.freeze({
  AUTH_CODE_INVALID: 'That code is not valid. Check the code and email address, or request a new code.',
  AUTH_CODE_EXPIRED: 'That code has expired. Request a new code below.',
  AUTH_CODE_EXHAUSTED: 'Too many incorrect attempts. Request a new code below.',
  AUTH_PASSWORD_WEAK: 'Choose a less predictable password of 10–200 characters without your email address.',
  RATE_LIMITED: 'Too many attempts. Please wait before trying again.',
  AUTH_CODE_COOLDOWN: 'Please wait before requesting another code.',
});

async function postReset(action, payload, { fetchImpl = globalThis.fetch, signal, timeoutMs = 15_000 } = {}) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) throw new PasswordResetError('Request cancelled.', 'ABORTED');
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, timeoutMs);
  try {
    const response = await fetchImpl(`/api/account/password/${action}`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.ok !== true) {
      const code = response.status === 429 ? 'RATE_LIMITED' : body?.code || 'REQUEST_FAILED';
      throw new PasswordResetError(ERROR_MESSAGES[code] || 'Password recovery could not be completed. Please try again shortly.', code, response.status);
    }
    // An HTML fallback, empty 200, or unrelated success must never claim a reset.
    if (action === 'forgot' && body.code !== 'AUTH_RESET_SENT') {
      throw new PasswordResetError('The reset request could not be confirmed. Please try again.', 'INVALID_RESPONSE');
    }
    return body;
  } catch (error) {
    if (signal?.aborted) throw new PasswordResetError('Request cancelled.', 'ABORTED');
    if (error instanceof PasswordResetError) throw error;
    throw new PasswordResetError(
      controller.signal.aborted
        ? 'The request took too long. It may have completed; check your email or try signing in before retrying.'
        : 'The account service could not be reached. Check your connection and try again.',
      controller.signal.aborted ? 'TIMEOUT' : 'NETWORK',
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

export async function requestPasswordReset(email, options) {
  const invalid = validateResetInput({ email });
  if (invalid) throw new PasswordResetError(invalid, 'VALIDATION');
  await postReset('forgot', { email: email.trim() }, options);
  // Deliberately identical regardless of whether the address exists.
  return { message: RESET_SENT_MESSAGE };
}

export async function completePasswordReset(input, options) {
  const invalid = validateResetInput(input, true);
  if (invalid) throw new PasswordResetError(invalid, 'VALIDATION');
  const result = await postReset('reset', {
    email: input.email.trim(),
    code: input.code.trim(),
    password: input.password,
  }, options);
  return result;
}
