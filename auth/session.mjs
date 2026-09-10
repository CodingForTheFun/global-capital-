import crypto from 'node:crypto';
import { deriveSecret } from '../scanner/secure-store.mjs';

// The browser never sees Supabase tokens. They travel in one opaque, encrypted,
// HttpOnly cookie that only this server can open.

let keyPromise = null;
function sessionKey() {
  if (!keyPromise) {
    keyPromise = process.env.AUTH_SESSION_SECRET
      ? Promise.resolve(crypto.createHash('sha256').update(String(process.env.AUTH_SESSION_SECRET)).digest())
      : deriveSecret('auth-session');
  }
  return keyPromise;
}

export async function sealSession(payload) {
  const key = await sessionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export async function openSession(sealed) {
  const parts = String(sealed || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const key = await sessionKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[0], 'base64url'));
    decipher.setAuthTag(Buffer.from(parts[1], 'base64url'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(parts[2], 'base64url')), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    return null;
  }
}

export function deviceFingerprint({ ip, userAgent }) {
  return crypto.createHash('sha256').update(`${ip || ''}|${userAgent || ''}`).digest('base64url').slice(0, 24);
}
