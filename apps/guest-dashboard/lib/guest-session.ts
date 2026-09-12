import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readdir, stat, unlink, readFile } from 'node:fs/promises';
import path from 'node:path';

export const COOKIE = 'obligepay_edge_guest';
export const TTL = 12 * 60 * 60;
const secret = process.env.GUEST_SESSION_SECRET || process.env.DASHBOARD_SESSION_SECRET || process.env.AUTOPROP_MASTER_KEY || randomBytes(32).toString('hex');
const root = path.join(process.env.DATA_DIR || '/tmp/obligepay', 'edge-guest-asks');
const signature = (value: string) => createHmac('sha256', secret).update(value).digest('base64url');
export function newSession() {
  const value = `${randomUUID()}.${Date.now()}`;
  return `${value}.${signature(value)}`;
}
export function sessionId(token?: string) {
  if (!token || token.length > 180) return null;
  const [id, time, sig, extra] = token.split('.');
  if (extra || !/^[a-f0-9-]{36}$/.test(id || '') || !/^\d{13}$/.test(time || '') || !sig) return null;
  const age = Date.now() - Number(time);
  if (age < 0 || age > TTL * 1000) return null;
  const wanted = Buffer.from(signature(`${id}.${time}`));
  const given = Buffer.from(sig);
  return wanted.length === given.length && timingSafeEqual(wanted, given) ? id : null;
}
export async function hasUsed(id: string) {
  try { await stat(path.join(root, `${id}.json`)); return true; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; }
}
export async function claim(id: string, ip: string): Promise<{ ok: boolean; reason?: string; release?: () => Promise<void>; complete?: () => Promise<void> }> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const file = path.join(root, `${id}.json`);
  const ipHash = signature(ip).slice(0, 24);
  let handle;
  try { handle = await open(file, 'wx', 0o600); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') return { ok: false, reason: 'AUTH_REQUIRED' }; throw e; }
  await handle.writeFile(JSON.stringify({ at: Date.now(), ipHash, state: 'pending' }));
  await handle.close();
  const release = async () => { await unlink(file).catch(() => {}); };
  try {
    // Mounted-volume receipts also bound spend across process restarts. Expired
    // sessions are removed opportunistically. No raw IP or prompt is persisted.
    const files = (await readdir(root)).filter(name => /^[a-f0-9-]{36}\.json$/.test(name));
    let total = 0, fromIp = 0;
    for (const name of files) {
      try {
        const row = JSON.parse(await readFile(path.join(root, name), 'utf8'));
        if (Date.now() - row.at > TTL * 1000) { await unlink(path.join(root, name)).catch(() => {}); continue; }
        total++; if (row.ipHash === ipHash) fromIp++;
      } catch { /* A concurrent write is counted by its owning request. */ }
    }
    if (total > 60 || fromIp > 3) { await release(); return { ok: false, reason: 'RATE_LIMITED' }; }
    return { ok: true, release, complete: async () => {
      const out = await open(file, 'w', 0o600);
      await out.writeFile(JSON.stringify({ at: Date.now(), ipHash, state: 'complete' })); await out.close();
    } };
  } catch (e) { await release(); throw e; }
}
