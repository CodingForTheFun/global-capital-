import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const dataDir = path.resolve(process.env.DATA_DIR || './data');
const keyPath = path.join(dataDir, '.autoprop-master-key');
const credentialsPath = path.join(dataDir, 'pickfinder.credentials.enc');
const sessionPath = path.join(dataDir, 'pickfinder.session.enc');

async function fileExists(file) { try { await fs.access(file); return true; } catch { return false; } }

function keyFromEnvironment() {
  const raw = process.env.AUTOPROP_MASTER_KEY?.trim();
  if (!raw) return null;
  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  try { const decoded = Buffer.from(raw, 'base64'); if (decoded.length === 32) return decoded; } catch {}
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

async function atomicWrite(file, data, mode = 0o600) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temp, data, { mode });
    await fs.rename(temp, file);
    await fs.chmod(file, mode).catch(() => {});
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {});
  }
}

async function getMasterKey() {
  const envKey = keyFromEnvironment();
  if (envKey) return envKey;
  await fs.mkdir(dataDir, { recursive: true });
  if (await fileExists(keyPath)) {
    const raw = (await fs.readFile(keyPath, 'utf8')).trim();
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new Error('Local AutoProp master key is invalid.');
    return key;
  }
  const key = crypto.randomBytes(32);
  await atomicWrite(keyPath, key.toString('base64'));
  return key;
}

async function encryptJson(value) {
  const key = await getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({ v: 1, alg: 'A256GCM', iv: iv.toString('base64'), tag: tag.toString('base64'), data: ciphertext.toString('base64') });
}

async function decryptJson(serialized) {
  let payload;
  try { payload = JSON.parse(String(serialized || '').trim()); }
  catch { throw Object.assign(new Error('Saved PickFinder connection data is unreadable. Please reconnect PickFinder.'), { code: 'PICKFINDER_STORE_UNREADABLE' }); }
  if (payload?.v !== 1 || payload?.alg !== 'A256GCM' || !payload.iv || !payload.tag || !payload.data) {
    throw Object.assign(new Error('Saved PickFinder connection data has an unsupported format. Please reconnect PickFinder.'), { code: 'PICKFINDER_STORE_UNREADABLE' });
  }
  try {
    const key = await getMasterKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch (error) {
    if (error?.code === 'PICKFINDER_STORE_UNREADABLE') throw error;
    throw Object.assign(new Error('Saved PickFinder connection could not be decrypted. Please reconnect PickFinder.'), { code: 'PICKFINDER_STORE_UNREADABLE' });
  }
}

async function writeEncrypted(file, value) {
  await atomicWrite(file, await encryptJson(value));
}
async function readEncrypted(file) {
  if (!(await fileExists(file))) return null;
  return decryptJson(await fs.readFile(file, 'utf8'));
}

export function maskEmail(email = '') {
  const [name = '', domain = ''] = String(email).split('@');
  if (!domain) return '';
  const shown = name.length <= 2 ? name.slice(0, 1) : name.slice(0, 2);
  return `${shown}${'*'.repeat(Math.max(2, Math.min(7, name.length - shown.length)))}@${domain}`;
}

export async function savePickFinderCredentials({ email, password }) {
  const cleanEmail = String(email || '').trim();
  const cleanPassword = String(password || '');
  if (!cleanEmail || !cleanEmail.includes('@')) throw new Error('Enter a valid PickFinder email.');
  if (!cleanPassword) throw new Error('Enter your PickFinder password.');
  await writeEncrypted(credentialsPath, { email: cleanEmail, password: cleanPassword, savedAt: new Date().toISOString() });
  return { maskedEmail: maskEmail(cleanEmail) };
}

export async function loadPickFinderCredentials() {
  let stored = null;
  try { stored = await readEncrypted(credentialsPath); }
  catch (error) { if (error?.code === 'PICKFINDER_STORE_UNREADABLE') throw error; }
  if (stored?.email && stored?.password) return stored;
  const email = process.env.PICKFINDER_EMAIL?.trim();
  const password = process.env.PICKFINDER_PASSWORD;
  return email && password ? { email, password, source: 'environment' } : null;
}

export async function savePickFinderSession(storageState) {
  if (!storageState || typeof storageState !== 'object') throw new Error('Cannot save an empty PickFinder session.');
  await writeEncrypted(sessionPath, { storageState, savedAt: new Date().toISOString() });
}

export async function loadPickFinderSession() {
  try {
    const stored = await readEncrypted(sessionPath);
    return stored?.storageState || null;
  } catch (error) {
    if (error?.code === 'PICKFINDER_STORE_UNREADABLE') {
      await clearPickFinderSession().catch(() => {});
      return null;
    }
    throw error;
  }
}

export async function clearPickFinderSession() { await fs.rm(sessionPath, { force: true }); }
export async function clearPickFinderCredentials() { await fs.rm(credentialsPath, { force: true }); }
export async function clearPickFinderConnection() { await Promise.all([clearPickFinderSession(), clearPickFinderCredentials()]); }

export async function getPickFinderConnectionState() {
  let credentials = null;
  let connectionError = null;
  try { credentials = await loadPickFinderCredentials(); }
  catch (error) { connectionError = error?.message || 'Saved connection is unreadable.'; }
  const session = await loadPickFinderSession().catch(() => null);
  return {
    configured: Boolean(credentials),
    sessionSaved: Boolean(session),
    maskedEmail: credentials?.email ? maskEmail(credentials.email) : null,
    credentialSource: credentials?.source === 'environment' ? 'environment' : credentials ? 'encrypted-store' : null,
    connectionError,
  };
}

// --- Generic encrypted-at-rest JSON storage -------------------------------
// Reuses the AutoProp master key so account data, sessions and one-time codes
// are protected with the same AES-256-GCM envelope as PickFinder credentials.

export async function writeSecureJson(file, value) {
  await atomicWrite(file, await encryptJson(value));
}

export async function readSecureJson(file, fallback = null) {
  if (!(await fileExists(file))) return fallback;
  try {
    return await decryptJson(await fs.readFile(file, 'utf8'));
  } catch (error) {
    throw Object.assign(
      new Error(`Encrypted store "${path.basename(file)}" could not be decrypted. The master key changed or the file is corrupt.`),
      { code: 'SECURE_STORE_UNREADABLE', cause: error },
    );
  }
}

export async function secureKeyFingerprint() {
  const key = await getMasterKey();
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export async function deriveSecret(label) {
  const key = await getMasterKey();
  return crypto.createHmac('sha256', key).update(`autoprop:${label}`).digest();
}
