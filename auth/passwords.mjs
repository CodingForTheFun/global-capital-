import crypto from 'node:crypto';

// scrypt parameters. N=16384 keeps hashing ~50-90ms on a small container while
// staying well inside Node's default 32MB maxmem (128 * N * r = 16MB).
const SCRYPT_N = 16384;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;

// Small, high-frequency list. This is a guardrail, not a breach corpus; the
// real protection is rate limiting plus per-account lockout.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd', 'qwerty123', 'qwertyuiop',
  '123456789', '1234567890', '12345678910', 'iloveyou1', 'letmein123', 'welcome123', 'admin123',
  'football1', 'baseball1', 'sunshine1', 'princess1', 'dragon123', 'monkey123', 'trustno1',
  'abc12345', 'abcd1234', 'test1234', 'changeme1', 'secret123', 'master123', 'shadow123',
  'superman1', 'batman123', 'pokemon123', 'starwars1', 'whatever1', 'freedom123', 'computer1',
  'prizepicks', 'pickfinder', 'autoprop123', 'sportsbet1', 'parlay123', 'gambling1',
]);

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p }, (error, derived) => {
      if (error) reject(error); else resolve(derived);
    });
  });
}

export async function hashPassword(password) {
  const clean = String(password ?? '');
  if (!clean) throw new Error('A password is required.');
  const salt = crypto.randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(clean, salt);
  return `scrypt$${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[4], 'base64url');
    expected = Buffer.from(parts[5], 'base64url');
  } catch { return false; }
  if (!salt.length || !expected.length) return false;
  const derived = await new Promise((resolve, reject) => {
    // maxmem is raised so an older/heavier stored parameter set still verifies.
    crypto.scrypt(String(password ?? ''), salt, expected.length, { N, r, p, maxmem: 256 * 1024 * 1024 }, (error, out) => {
      if (error) reject(error); else resolve(out);
    });
  }).catch(() => null);
  if (!derived || derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

// Re-hash on login when the stored record used weaker parameters than we use now.
export function needsRehash(stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
  return Number(parts[1]) < SCRYPT_N || Number(parts[2]) < SCRYPT_r;
}

function characterClasses(password) {
  let classes = 0;
  if (/[a-z]/.test(password)) classes += 1;
  if (/[A-Z]/.test(password)) classes += 1;
  if (/[0-9]/.test(password)) classes += 1;
  if (/[^A-Za-z0-9]/.test(password)) classes += 1;
  return classes;
}

function hasRun(password) {
  const lower = password.toLowerCase();
  const sequences = ['abcdefghijklmnopqrstuvwxyz', '01234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  for (const sequence of sequences) {
    for (let i = 0; i + 4 <= sequence.length; i += 1) {
      const slice = sequence.slice(i, i + 4);
      if (lower.includes(slice) || lower.includes([...slice].reverse().join(''))) return true;
    }
  }
  return /(.)\1{3,}/.test(password);
}

// 0-4, matching the strength meter the sign-up form renders.
export function passwordScore(password) {
  const value = String(password ?? '');
  if (!value) return 0;
  let score = 0;
  if (value.length >= MIN_PASSWORD_LENGTH) score += 1;
  if (value.length >= 14) score += 1;
  if (characterClasses(value) >= 3) score += 1;
  if (characterClasses(value) === 4 && value.length >= 12) score += 1;
  if (hasRun(value) || COMMON_PASSWORDS.has(value.toLowerCase())) score = Math.min(score, 1);
  return Math.max(0, Math.min(4, score));
}

export function checkPasswordPolicy(password, { email = '', displayName = '' } = {}) {
  const value = String(password ?? '');
  const issues = [];
  if (value.length < MIN_PASSWORD_LENGTH) issues.push(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (value.length > MAX_PASSWORD_LENGTH) issues.push(`Keep it under ${MAX_PASSWORD_LENGTH} characters.`);
  if (value !== value.trim()) issues.push('Remove the leading or trailing spaces.');
  if (COMMON_PASSWORDS.has(value.toLowerCase())) issues.push('That password is too common — pick something unique.');
  if (characterClasses(value) < 3 && value.length < 16) {
    issues.push('Mix upper case, lower case, numbers or symbols (or use 16+ characters).');
  }
  if (hasRun(value)) issues.push('Avoid keyboard runs like "abcd" or repeated characters.');

  const localPart = String(email || '').split('@')[0] || '';
  const needles = [localPart, String(displayName || '')].map((s) => s.toLowerCase().trim()).filter((s) => s.length >= 4);
  if (needles.some((needle) => value.toLowerCase().includes(needle))) {
    issues.push('Do not reuse your name or email inside the password.');
  }
  return { ok: issues.length === 0, issues, score: passwordScore(value) };
}
