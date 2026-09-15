import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { currentAccount } from './routes.mjs';
import { csrfValid } from './session.mjs';
import { createRateLimiter } from '../session.mjs';

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const AVATAR_DIR = path.join(DATA_DIR, 'profile-avatars');
const MAX_AVATAR_BYTES = 512 * 1024;
const MAX_BODY_BYTES = 900 * 1024;
const limiter = createRateLimiter();

function json(res, status, body, extra = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store, max-age=0',
    'x-content-type-options': 'nosniff',
    ...extra,
  });
  res.end(payload);
}

function sameOrigin(req) {
  const origin = req?.headers?.origin;
  if (!origin) return true;
  try {
    const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '');
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function readJsonBody(req, limit = MAX_BODY_BYTES) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Avatar upload is too large.'), { code: 'AVATAR_TOO_LARGE' });
    chunks.push(Buffer.from(chunk));
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid avatar request.'), { code: 'AVATAR_INVALID' });
  }
}

export function sniffAvatarType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

export function decodeAvatarDataUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_BODY_BYTES) {
    throw Object.assign(new Error('Avatar upload is invalid.'), { code: 'AVATAR_INVALID' });
  }
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw Object.assign(new Error('Only JPEG, PNG, or WebP profile photos are allowed.'), { code: 'AVATAR_TYPE' });
  const base64 = match[2];
  if (base64.length % 4 !== 0) throw Object.assign(new Error('Avatar upload is invalid.'), { code: 'AVATAR_INVALID' });
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) {
    throw Object.assign(new Error('Profile photo must be 512 KB or smaller after resizing.'), { code: 'AVATAR_TOO_LARGE' });
  }
  const actualType = sniffAvatarType(bytes);
  const declaredType = match[1] === 'jpeg' ? 'image/jpeg' : `image/${match[1]}`;
  if (!actualType || actualType !== declaredType) {
    throw Object.assign(new Error('Profile photo contents do not match the selected image type.'), { code: 'AVATAR_TYPE' });
  }
  return { bytes, contentType: actualType };
}

function avatarPath(userId) {
  const safe = String(userId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) throw Object.assign(new Error('Invalid account identity.'), { code: 'AVATAR_INVALID' });
  return path.join(AVATAR_DIR, `${safe}.img`);
}

async function writeAvatar(userId, bytes) {
  await fs.mkdir(AVATAR_DIR, { recursive: true });
  const destination = avatarPath(userId);
  const temp = `${destination}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temp, bytes, { mode: 0o600 });
    await fs.rename(temp, destination);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {});
  }
}

/**
 * Private, same-account avatar endpoint.
 * GET  /api/account/avatar -> current user's image only
 * POST /api/account/avatar -> { image: data:image/... } or { remove: true }
 */
export async function handleProfileAvatarRoute(req, res, url, { sessions, secret }) {
  if (url.pathname !== '/api/account/avatar') return false;

  const { user, token } = await currentAccount(req, sessions);
  if (!user) {
    if (req.method === 'GET') {
      res.writeHead(404, { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end();
    } else {
      json(res, 401, { ok: false, code: 'AUTH_REQUIRED', message: 'Sign in to change your profile photo.' });
    }
    return true;
  }

  if (req.method === 'GET') {
    try {
      const bytes = await fs.readFile(avatarPath(user.id));
      const contentType = sniffAvatarType(bytes);
      if (!contentType || bytes.length > MAX_AVATAR_BYTES) throw new Error('invalid-avatar');
      res.writeHead(200, {
        'content-type': contentType,
        'content-length': bytes.length,
        'cache-control': 'private, no-store, max-age=0',
        'content-disposition': 'inline',
        'x-content-type-options': 'nosniff',
      });
      res.end(bytes);
    } catch {
      res.writeHead(404, { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end();
    }
    return true;
  }

  if (req.method !== 'POST') {
    json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' }, { allow: 'GET, POST' });
    return true;
  }

  if (!sameOrigin(req)) {
    json(res, 403, { ok: false, code: 'ORIGIN_INVALID', message: 'Cross-origin request rejected.' });
    return true;
  }
  if (!csrfValid(token, req.headers['x-csrf-token'], secret)) {
    json(res, 403, { ok: false, code: 'CSRF_INVALID', message: 'Your session expired. Reload and try again.' });
    return true;
  }
  if (!limiter.allow(`avatar:${user.id}`, 12, 60 * 60_000)) {
    json(res, 429, { ok: false, code: 'RATE_LIMITED', message: 'Too many profile photo changes. Try again later.' });
    return true;
  }

  try {
    const body = await readJsonBody(req);
    if (body.remove === true) {
      await fs.rm(avatarPath(user.id), { force: true });
      json(res, 200, { ok: true, avatar: null });
      return true;
    }
    const decoded = decodeAvatarDataUrl(body.image);
    await writeAvatar(user.id, decoded.bytes);
    json(res, 200, { ok: true, avatar: { contentType: decoded.contentType, bytes: decoded.bytes.length } });
  } catch (error) {
    const code = error?.code || 'AVATAR_INVALID';
    const status = code === 'AVATAR_TOO_LARGE' ? 413 : 400;
    json(res, status, { ok: false, code, message: String(error?.message || 'Profile photo could not be saved.').slice(0, 180) });
  }
  return true;
}
