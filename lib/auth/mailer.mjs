// Transactional email.
//
// Provider-agnostic and dependency-free: every supported provider has an HTTP
// API, and Node has fetch built in. No SMTP client, no npm package.
//
// Configure exactly one by setting its API key:
//   RESEND_API_KEY      https://resend.com
//   POSTMARK_API_TOKEN  https://postmarkapp.com
//   SENDGRID_API_KEY    https://sendgrid.com
//   MAILGUN_API_KEY  +  MAILGUN_DOMAIN
// Plus MAIL_FROM (e.g. "Scout Pro <noreply@yourdomain.com>").
//
// With none configured, send() reports notConfigured and — outside production —
// logs the code to the server console so local development works. It NEVER
// returns the code to the browser, and never logs it in production: a code in a
// response body would defeat the entire point of emailing it.

const TIMEOUT_MS = 10_000;

export const MAIL_PROVIDER = Object.freeze({
  RESEND: 'resend',
  POSTMARK: 'postmark',
  SENDGRID: 'sendgrid',
  MAILGUN: 'mailgun',
  NONE: 'none',
});

export function mailFrom() {
  return process.env.MAIL_FROM || 'Scout Pro <onboarding@resend.dev>';
}

/** Which provider is configured. First key present wins, deterministically. */
export function detectProvider() {
  if (process.env.RESEND_API_KEY) return MAIL_PROVIDER.RESEND;
  if (process.env.POSTMARK_API_TOKEN) return MAIL_PROVIDER.POSTMARK;
  if (process.env.SENDGRID_API_KEY) return MAIL_PROVIDER.SENDGRID;
  if (process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN) return MAIL_PROVIDER.MAILGUN;
  return MAIL_PROVIDER.NONE;
}

export function isConfigured() {
  return detectProvider() !== MAIL_PROVIDER.NONE;
}

/** Never let an API key reach a log line, even if interpolated by mistake. */
export function redact(text) {
  let out = String(text ?? '');
  for (const name of ['RESEND_API_KEY', 'POSTMARK_API_TOKEN', 'SENDGRID_API_KEY', 'MAILGUN_API_KEY']) {
    const value = process.env[name];
    if (value && value.length >= 8) out = out.split(value).join('[redacted]');
  }
  return out;
}

function buildRequest(provider, { to, subject, text, html }) {
  const from = mailFrom();
  switch (provider) {
    case MAIL_PROVIDER.RESEND:
      return {
        url: 'https://api.resend.com/emails',
        options: {
          method: 'POST',
          headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from, to: [to], subject, text, html }),
        },
      };
    case MAIL_PROVIDER.POSTMARK:
      return {
        url: 'https://api.postmarkapp.com/email',
        options: {
          method: 'POST',
          headers: { 'X-Postmark-Server-Token': process.env.POSTMARK_API_TOKEN, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ From: from, To: to, Subject: subject, TextBody: text, HtmlBody: html, MessageStream: 'outbound' }),
        },
      };
    case MAIL_PROVIDER.SENDGRID:
      return {
        url: 'https://api.sendgrid.com/v3/mail/send',
        options: {
          method: 'POST',
          headers: { authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: to }] }],
            from: parseFrom(from),
            subject,
            content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }],
          }),
        },
      };
    case MAIL_PROVIDER.MAILGUN: {
      const form = new URLSearchParams({ from, to, subject, text, html });
      return {
        url: `https://api.mailgun.net/v3/${process.env.MAILGUN_DOMAIN}/messages`,
        options: {
          method: 'POST',
          headers: {
            authorization: `Basic ${Buffer.from(`api:${process.env.MAILGUN_API_KEY}`).toString('base64')}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: form.toString(),
        },
      };
    }
    default:
      return null;
  }
}

function parseFrom(from) {
  const match = String(from).match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return match ? { email: match[2], name: match[1] || undefined } : { email: String(from).trim() };
}

/**
 * Send one transactional email.
 *
 * Never throws — a mail outage must not take down sign-in. Returns a result the
 * caller can log; the caller decides what (deliberately vague) copy the user sees.
 */
export async function send({ to, subject, text, html }, { fetchImpl = fetch, log = console } = {}) {
  const provider = detectProvider();

  if (provider === MAIL_PROVIDER.NONE) {
    if (process.env.NODE_ENV !== 'production') {
      // Development convenience only. Guarded so a production misconfiguration
      // can never print a live code into the logs.
      log?.warn?.(`[Scout Pro mail] no provider configured — would have sent to ${to}: ${subject}\n${text}`);
    } else {
      log?.error?.('[Scout Pro mail] no email provider configured; transactional mail is not being delivered');
    }
    return { ok: false, provider, notConfigured: true, status: 0 };
  }

  const request = buildRequest(provider, { to, subject, text, html });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(request.url, { ...request.options, signal: controller.signal });
    if (!response.ok) {
      // Status only. A provider error body can echo the payload back.
      log?.error?.(redact(`[Scout Pro mail] ${provider} responded ${response.status}`));
      return { ok: false, provider, status: response.status, notConfigured: false };
    }
    return { ok: true, provider, status: response.status, notConfigured: false };
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    log?.error?.(redact(`[Scout Pro mail] ${provider} ${timedOut ? 'timed out' : 'request failed'}`));
    return { ok: false, provider, status: 0, notConfigured: false, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

// --- templates -------------------------------------------------------------
// Plain text plus a minimal HTML part. Codes are never placed in a link, so a
// forwarded email or a scanning proxy cannot consume the code by fetching a URL.

const shell = (heading, body) => `<!doctype html><html><body style="margin:0;padding:24px;background:#0b1220;font-family:system-ui,-apple-system,Segoe UI,sans-serif">
<div style="max-width:480px;margin:0 auto;background:#111c30;border:1px solid #22304a;border-radius:14px;padding:28px;color:#e8eefc">
<div style="font-weight:700;letter-spacing:.14em;font-size:12px;color:#7d93b8;text-transform:uppercase">Scout Pro</div>
<h1 style="margin:14px 0 12px;font-size:20px;color:#fff">${heading}</h1>
${body}
<p style="margin-top:22px;font-size:12px;color:#6f83a6;border-top:1px solid #22304a;padding-top:14px">
If you did not request this, you can ignore this email. Nobody can access your account without the code above.</p>
</div></body></html>`;

const codeBlock = (code) => `<div style="margin:18px 0;padding:16px;background:#0b1220;border:1px solid #2a3a58;border-radius:10px;text-align:center">
<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:30px;letter-spacing:.3em;color:#fff">${code}</span></div>`;

export function verificationEmail(code) {
  return {
    subject: `${code} is your Scout Pro verification code`,
    text: `Your Scout Pro verification code is ${code}\n\nIt expires in 10 minutes.\n\nIf you did not create an account, you can ignore this email.`,
    html: shell('Verify your email', `<p style="margin:0;color:#b9c8e4;font-size:14px">Enter this code to finish setting up your account. It expires in 10 minutes.</p>${codeBlock(code)}`),
  };
}

export function resetEmail(code) {
  return {
    subject: `${code} is your Scout Pro password reset code`,
    text: `Your Scout Pro password reset code is ${code}\n\nIt expires in 10 minutes.\n\nIf you did not request a password reset, ignore this email and your password will stay unchanged.`,
    html: shell('Reset your password', `<p style="margin:0;color:#b9c8e4;font-size:14px">Enter this code to choose a new password. It expires in 10 minutes.</p>${codeBlock(code)}`),
  };
}

export function passwordChangedEmail() {
  return {
    subject: 'Your Scout Pro password was changed',
    text: 'Your Scout Pro password was just changed, and all other sessions were signed out.\n\nIf this was not you, reset your password immediately.',
    html: shell('Password changed', '<p style="margin:0;color:#b9c8e4;font-size:14px">Your password was just changed and every other session was signed out.<br><br><b style="color:#fff">If this was not you, reset your password immediately.</b></p>'),
  };
}
