import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// The deployed product uses legacy access profiles, not Supabase Auth users.
// Namespace these saves separately; never insert their IDs into auth.users FKs.
const queues = new Map();
const root = () => path.resolve(process.env.DATA_DIR || './data', 'saved-props');
function fileFor(session) {
  if (!session?.authenticated || !session.subject || !['owner','member'].includes(session.role)) throw new Error('AUTH_REQUIRED');
  const id = crypto.createHash('sha256').update(`${session.role}:${session.subject}`).digest('hex');
  return path.join(root(), id + '.json');
}
async function read(file) {
  try { const value = JSON.parse(await fs.readFile(file, 'utf8')); if (!Array.isArray(value)) throw new Error('INVALID_SAVED_STATE'); return value; }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
const text = value => String(value ?? '').trim().slice(0, 300);
const num = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
export function normalizeSavedProp(input) {
  if (!input || !input.key || !input.playerName || !input.market || !['NFL','NBA','MLB','NHL','WNBA','NCAAF','NCAAB'].includes(input.sport)) throw new Error('INVALID_PROP');
  const out = {};
  for (const key of ['key','sport','eventId','playerId','playerName','team','position','marketId','market','homeTeam','awayTeam','gameStartTime','propId']) out[key] = text(input[key]);
  out.rows = (Array.isArray(input.rows) ? input.rows : []).slice(0, 100).filter(row => ['OVER','UNDER'].includes(row.side) && num(row.line) !== null && row.isAlternate !== true).map(row => {
    const result = { side: row.side, line: num(row.line), price: num(row.price), isAlternate: false };
    for (const key of ['id','sportsbook','sportsbookKey','providerUpdatedAt']) result[key] = text(row[key]);
    return result;
  });
  if (!out.rows.length) throw new Error('INVALID_PROP');
  out.savedAt = new Date().toISOString();
  return out;
}
export async function readSavedProps(session) { return read(fileFor(session)); }
export async function updateSavedProps(session, input, remove = false) {
  const file = fileFor(session);
  const previous = queues.get(file) || Promise.resolve();
  const pending = previous.catch(() => {}).then(async () => {
    const saved = await read(file), key = text(input.key);
    const next = saved.filter(row => row.key !== key);
    if (!remove) next.push(normalizeSavedProp(input));
    if (next.length > 500) throw new Error('SAVE_LIMIT');
    await fs.mkdir(root(), { recursive: true, mode: 0o700 });
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    try { await fs.writeFile(temp, JSON.stringify(next), { mode: 0o600 }); await fs.rename(temp, file); }
    finally { await fs.rm(temp, { force: true }).catch(() => {}); }
    return next;
  });
  queues.set(file, pending);
  try { return await pending; } finally { if (queues.get(file) === pending) queues.delete(file); }
}
