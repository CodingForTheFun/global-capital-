import crypto from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';

// Zero-dependency mail delivery. Provider is chosen from the environment so the
// same build runs against SMTP, a transactional HTTP API, or a console sink in
// local development.

const SOCKET_TIMEOUT_MS = 20_000;

export function mailerConfig() {
  const explicit = String(process.env.MAIL_PROVIDER || '').trim().toLowerCase();
  const from = String(process.env.MAIL_FROM || '').trim();
  const fromName = String(process.env.MAIL_FROM_NAME || 'AutoProp Scout Pro').trim();
  const replyTo = String(process.env.MAIL_REPLY_TO || '').trim();
  const appUrl = String(process.env.APP_URL || '').trim().replace(/\/+$/, '');

  let provider = explicit;
  if (!provider) {
    if (process.env.RESEND_API_KEY) provider = 'resend';
    else if (process.env.POSTMARK_SERVER_TOKEN) provider = 'postmark';
    else if (process.env.SENDGRID_API_KEY) provider = 'sendgrid';
    else if (process.env.SMTP_HOST) provider = 'smtp';
    else provider = 'console';
  }

  const configured = provider === 'console'
    ? false
    : Boolean(from) && Boolean(
      (provider === 'resend' && process.env.RESEND_API_KEY)
      || (provider === 'postmark' && process.env.POSTMARK_SERVER_TOKEN)
      || (provider === 'sendgrid' && process.env.SENDGRID_API_KEY)
      || (provider === 'smtp' && process.env.SMTP_HOST),
    );

  return {
    provider,
    configured,
    from: from || 'autoprop@localhost',
    fromName,
    replyTo,
    appUrl,
    // With no real provider we surface codes in the API response so a solo
    // operator can still finish sign-up locally. Never enabled in production.
    exposeCodes: provider === 'console' && String(process.env.NODE_ENV || '') !== 'production',
  };
}

function encodeHeaderValue(value) {
  const clean = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

function formatAddress(email, name) {
  const address = String(email || '').replace(/[\r\n<>]/g, '').trim();
  if (!name) return address;
  return `${encodeHeaderValue(name)} <${address}>`;
}

function toQuotedPrintable(input) {
  const bytes = Buffer.from(String(input ?? ''), 'utf8');
  let line = '';
  const lines = [];
  const push = (chunk) => {
    if (line.length + chunk.length > 73) { lines.push(`${line}=`); line = ''; }
    line += chunk;
  };
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    if (byte === 0x0d && bytes[i + 1] === 0x0a) { lines.push(line); line = ''; i += 1; continue; }
    if (byte === 0x0a) { lines.push(line); line = ''; continue; }
    if (byte === 0x3d || byte < 0x20 || byte > 0x7e) push(`=${byte.toString(16).toUpperCase().padStart(2, '0')}`);
    else push(String.fromCharCode(byte));
  }
  if (line.length) lines.push(line);
  return lines.join('\r\n');
}

function buildMimeMessage({ from, fromName, replyTo, to, subject, text, html }) {
  const boundary = `=_autoprop_${crypto.randomBytes(16).toString('hex')}`;
  const domain = String(from).split('@')[1] || os.hostname() || 'localhost';
  const headers = [
    `From: ${formatAddress(from, fromName)}`,
    `To: ${formatAddress(to)}`,
    `Subject: ${encodeHeaderValue(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  if (replyTo) headers.splice(1, 0, `Reply-To: ${formatAddress(replyTo)}`);

  const body = [
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    toQuotedPrintable(text),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    toQuotedPrintable(html),
    `--${boundary}--`,
    '',
  ];
  return `${headers.join('\r\n')}\r\n${body.join('\r\n')}`;
}

// --- Minimal SMTP client --------------------------------------------------

class SmtpSession {
  constructor(socket) {
    this.socket = socket;
    this.buffer = '';
    this.lines = [];
    this.waiters = [];
    this.replies = [];
    this.closed = null;
    this.attach(socket);
  }

  attach(socket) {
    socket.setTimeout(SOCKET_TIMEOUT_MS);
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', (error) => this.fail(error));
    socket.on('timeout', () => this.fail(new Error('The mail server stopped responding.')));
    socket.on('close', () => this.fail(new Error('The mail server closed the connection.')));
  }

  onData(chunk) {
    this.buffer += chunk.toString('utf8');
    let index;
    while ((index = this.buffer.indexOf('\r\n')) >= 0) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 2);
      this.lines.push(line);
      if (/^\d{3} /.test(line)) {
        const reply = { code: Number(line.slice(0, 3)), lines: this.lines.slice() };
        this.lines = [];
        const waiter = this.waiters.shift();
        if (waiter) waiter.resolve(reply); else this.replies.push(reply);
      }
    }
  }

  fail(error) {
    if (this.closed) return;
    this.closed = error;
    while (this.waiters.length) this.waiters.shift().reject(error);
  }

  read() {
    if (this.replies.length) return Promise.resolve(this.replies.shift());
    if (this.closed) return Promise.reject(this.closed);
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  write(line) {
    return new Promise((resolve, reject) => {
      this.socket.write(`${line}\r\n`, (error) => (error ? reject(error) : resolve()));
    });
  }

  async command(line, expected) {
    await this.write(line);
    const reply = await this.read();
    if (expected && !expected.includes(reply.code)) {
      throw new Error(`SMTP command rejected (${reply.code}): ${reply.lines.join(' ').slice(0, 300)}`);
    }
    return reply;
  }

  replaceSocket(socket) {
    this.socket.removeAllListeners('data');
    this.socket.removeAllListeners('error');
    this.socket.removeAllListeners('timeout');
    this.socket.removeAllListeners('close');
    this.socket = socket;
    this.buffer = '';
    this.lines = [];
    this.closed = null;
    this.attach(socket);
  }
}

function connect(options) {
  return new Promise((resolve, reject) => {
    const socket = options.secure
      ? tls.connect({ host: options.host, port: options.port, servername: options.host })
      : net.connect({ host: options.host, port: options.port });
    const onReady = () => { cleanup(); resolve(socket); };
    const onError = (error) => { cleanup(); reject(error); };
    const cleanup = () => {
      socket.removeListener(options.secure ? 'secureConnect' : 'connect', onReady);
      socket.removeListener('error', onError);
    };
    socket.once(options.secure ? 'secureConnect' : 'connect', onReady);
    socket.once('error', onError);
  });
}

function upgrade(socket, host) {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({ socket, servername: host });
    const onReady = () => { secure.removeListener('error', onError); resolve(secure); };
    const onError = (error) => { secure.removeListener('secureConnect', onReady); reject(error); };
    secure.once('secureConnect', onReady);
    secure.once('error', onError);
  });
}

async function sendViaSmtp(message, config) {
  const host = String(process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASSWORD || '';
  const secure = String(process.env.SMTP_SECURE || (port === 465 ? 'true' : 'false')).toLowerCase() === 'true';
  const allowStartTls = String(process.env.SMTP_STARTTLS || 'true').toLowerCase() !== 'false';
  const clientName = String(process.env.SMTP_CLIENT_NAME || os.hostname() || 'autoprop').trim();

  const socket = await connect({ host, port, secure });
  const session = new SmtpSession(socket);
  try {
    const greeting = await session.read();
    if (greeting.code !== 220) throw new Error(`Mail server refused the connection (${greeting.code}).`);

    let ehlo = await session.command(`EHLO ${clientName}`, [250]);
    let capabilities = ehlo.lines.join(' ').toUpperCase();

    if (!secure && allowStartTls && capabilities.includes('STARTTLS')) {
      await session.command('STARTTLS', [220]);
      session.replaceSocket(await upgrade(session.socket, host));
      ehlo = await session.command(`EHLO ${clientName}`, [250]);
      capabilities = ehlo.lines.join(' ').toUpperCase();
    }

    if (user && pass) {
      if (capabilities.includes('AUTH') && capabilities.includes('PLAIN')) {
        const token = Buffer.from(`\0${user}\0${pass}`, 'utf8').toString('base64');
        await session.command(`AUTH PLAIN ${token}`, [235]);
      } else {
        await session.command('AUTH LOGIN', [334]);
        await session.command(Buffer.from(user, 'utf8').toString('base64'), [334]);
        await session.command(Buffer.from(pass, 'utf8').toString('base64'), [235]);
      }
    }

    await session.command(`MAIL FROM:<${config.from}>`, [250]);
    await session.command(`RCPT TO:<${message.to}>`, [250, 251]);
    await session.command('DATA', [354]);
    // Dot-stuff so a body line of "." cannot terminate the message early.
    const payload = message.raw.split('\r\n').map((line) => (line.startsWith('.') ? `.${line}` : line)).join('\r\n');
    await session.write(payload);
    await session.command('.', [250]);
    await session.command('QUIT', [221]).catch(() => {});
    return { provider: 'smtp', accepted: true };
  } finally {
    session.socket.destroy();
  }
}

async function postJson(url, headers, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SOCKET_TIMEOUT_MS),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Mail provider rejected the message (${response.status}): ${raw.slice(0, 300)}`);
  try { return JSON.parse(raw); } catch { return { raw }; }
}

async function sendViaResend(message, config) {
  const result = await postJson('https://api.resend.com/emails', { authorization: `Bearer ${process.env.RESEND_API_KEY}` }, {
    from: formatAddress(config.from, config.fromName),
    to: [message.to],
    subject: message.subject,
    text: message.text,
    html: message.html,
    ...(config.replyTo ? { reply_to: config.replyTo } : {}),
  });
  return { provider: 'resend', accepted: true, id: result?.id || null };
}

async function sendViaPostmark(message, config) {
  const result = await postJson('https://api.postmarkapp.com/email', {
    accept: 'application/json',
    'x-postmark-server-token': process.env.POSTMARK_SERVER_TOKEN,
  }, {
    From: formatAddress(config.from, config.fromName),
    To: message.to,
    Subject: message.subject,
    TextBody: message.text,
    HtmlBody: message.html,
    MessageStream: process.env.POSTMARK_MESSAGE_STREAM || 'outbound',
    ...(config.replyTo ? { ReplyTo: config.replyTo } : {}),
  });
  return { provider: 'postmark', accepted: true, id: result?.MessageID || null };
}

async function sendViaSendgrid(message, config) {
  await postJson('https://api.sendgrid.com/v3/mail/send', { authorization: `Bearer ${process.env.SENDGRID_API_KEY}` }, {
    personalizations: [{ to: [{ email: message.to }] }],
    from: { email: config.from, name: config.fromName },
    subject: message.subject,
    content: [{ type: 'text/plain', value: message.text }, { type: 'text/html', value: message.html }],
    ...(config.replyTo ? { reply_to: { email: config.replyTo } } : {}),
  });
  return { provider: 'sendgrid', accepted: true };
}

export async function sendMail({ to, subject, text, html }) {
  const config = mailerConfig();
  const recipient = String(to || '').trim();
  if (!recipient || !recipient.includes('@')) throw new Error('A valid recipient email is required.');

  const message = {
    to: recipient,
    subject,
    text,
    html,
    raw: buildMimeMessage({ ...config, to: recipient, subject, text, html }),
  };

  if (config.provider === 'console' || !config.configured) {
    console.log(`\n[mail:${config.provider}] to=${recipient} subject=${subject}\n${text}\n`);
    return { provider: 'console', accepted: true, delivered: false };
  }
  if (config.provider === 'resend') return sendViaResend(message, config);
  if (config.provider === 'postmark') return sendViaPostmark(message, config);
  if (config.provider === 'sendgrid') return sendViaSendgrid(message, config);
  if (config.provider === 'smtp') return sendViaSmtp(message, config);
  throw new Error(`Unknown MAIL_PROVIDER "${config.provider}".`);
}
