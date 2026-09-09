import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const dataDir = path.resolve(process.env.DATA_DIR || './data');
const authDir = path.join(dataDir, 'auth');
const usersPath = path.join(authDir, 'users.json');
const userRoot = path.join(dataDir, 'users');

async function ensureDirs() {
  await Promise.all([
    fs.mkdir(authDir, { recursive: true }),
    fs.mkdir(userRoot, { recursive: true }),
  ]);
}

async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    await fs.rename(tmp, file);
    await fs.chmod(file, 0o600).catch(() => {});
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

async function readUsers() {
  await ensureDirs();
  try {
    const parsed = JSON.parse(await fs.readFile(usersPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeEmail(email = '') { return String(email).trim().toLowerCase(); }
function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    role: user.role === 'owner' ? 'owner' : 'member',
    createdAt: user.createdAt,
    lastSeenAt: user.lastSeenAt || null,
  };
}
async function derive(password, salt) { return Buffer.from(await scrypt(String(password), salt, 64)); }

export function userDataDir(userId) {
  const id = String(userId || '');
  if (!/^[a-f0-9]{32}$/i.test(id)) throw new Error('Invalid user context.');
  return path.join(userRoot, id);
}

export async function registerUser({ email, password, role = 'member' }) {
  const cleanEmail = normalizeEmail(email);
  const cleanPassword = String(password || '');
  const cleanRole = role === 'owner' ? 'owner' : 'member';
  if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) throw new Error('Enter a valid email address.');
  if (cleanPassword.length < 10) throw new Error('Use at least 10 characters for your AutoProp password.');
  const users = await readUsers();
  if (users.some((user) => user.email === cleanEmail)) throw new Error('An AutoProp account already exists for that email.');
  if (cleanRole === 'owner' && users.some((user) => user.role === 'owner')) throw new Error('The Owner account already exists. Sign in instead.');
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = (await derive(cleanPassword, salt)).toString('base64url');
  const now = new Date().toISOString();
  const user = {
    id: crypto.randomBytes(16).toString('hex'),
    email: cleanEmail,
    role: cleanRole,
    salt,
    passwordHash: hash,
    sessionVersion: 1,
    createdAt: now,
    lastSeenAt: now,
  };
  users.push(user);
  await atomicJson(usersPath, users);
  await fs.mkdir(userDataDir(user.id), { recursive: true, mode: 0o700 });
  return publicUser(user);
}

export async function authenticateUser({ email, password }) {
  const cleanEmail = normalizeEmail(email);
  const users = await readUsers();
  const user = users.find((entry) => entry.email === cleanEmail);
  if (!user) return null;
  const actual = await derive(String(password || ''), user.salt);
  const expected = Buffer.from(user.passwordHash, 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  user.lastSeenAt = new Date().toISOString();
  if (!user.role) user.role = 'member';
  await atomicJson(usersPath, users);
  return publicUser(user);
}

export async function getUserById(userId) {
  const users = await readUsers();
  return publicUser(users.find((entry) => entry.id === String(userId)) || null);
}

export async function getUserSessionVersion(userId) {
  const users = await readUsers();
  return Number(users.find((entry) => entry.id === String(userId))?.sessionVersion || 0);
}

export async function listUsers() { return (await readUsers()).map(publicUser); }

export async function revokeUserSessions(userId) {
  const users = await readUsers();
  const user = users.find((entry) => entry.id === String(userId));
  if (!user) return false;
  user.sessionVersion = Number(user.sessionVersion || 1) + 1;
  await atomicJson(usersPath, users);
  return true;
}
