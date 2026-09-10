import crypto from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const BASE = 'https://www.thesportsdb.com/api/v1/json/123';
const DATA_DIR = process.env.DATA_DIR || '/app/data';
const CACHE_DIR = path.join(DATA_DIR, 'player-artwork');
const INDEX_FILE = path.join(CACHE_DIR, 'index.json');
const MAX_LOOKUPS_PER_MINUTE = 24;
const NEGATIVE_TTL_MS = 7 * 24 * 3600_000;
const POSITIVE_TTL_MS = 90 * 24 * 3600_000;

let index = {};
let lookupTimes = [];
const inflight = new Map();

try {
  mkdirSync(CACHE_DIR, { recursive: true });
  if (existsSync(INDEX_FILE)) index = JSON.parse(readFileSync(INDEX_FILE, 'utf8')) || {};
} catch { index = {}; }

const text = (value) => String(value ?? '').trim();
const keyOf = (sport, name) => `${text(sport).toUpperCase()}|${text(name).toLowerCase().replace(/\s+/g, ' ')}`;
const safeName = (key) => crypto.createHash('sha256').update(key).digest('hex');

function saveIndex() {
  try { writeFileSync(INDEX_FILE, JSON.stringify(index)); } catch {}
}

function fresh(entry) {
  const age = Date.now() - Number(entry?.fetchedAt || 0);
  return age >= 0 && age < (entry?.imagePath ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS);
}

function sportMatches(requested, candidate) {
  const s = text(candidate).toLowerCase();
  const wanted = text(requested).toUpperCase();
  if (!s) return true;
  if (wanted === 'NFL' || wanted === 'NCAAF') return s.includes('american football') || s === 'football';
  if (wanted === 'NBA' || wanted === 'WNBA' || wanted === 'NCAAB') return s.includes('basketball');
  if (wanted === 'MLB') return s.includes('baseball');
  if (wanted === 'NHL') return s.includes('ice hockey') || s === 'hockey';
  return true;
}

function canLookup() {
  const cutoff = Date.now() - 60_000;
  lookupTimes = lookupTimes.filter((t) => t >= cutoff);
  if (lookupTimes.length >= MAX_LOOKUPS_PER_MINUTE) return false;
  lookupTimes.push(Date.now());
  return true;
}

async function resolveArtwork(sport, name) {
  const cacheKey = keyOf(sport, name);
  const current = index[cacheKey];
  if (current && fresh(current)) return current;
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);
  if (!canLookup()) return current || null;

  const promise = (async () => {
    try {
      const url = `${BASE}/searchplayers.php?p=${encodeURIComponent(name)}`;
      const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const body = await response.json().catch(() => ({}));
      const rows = Array.isArray(body?.player) ? body.player : Array.isArray(body?.players) ? body.players : [];
      const normalized = text(name).toLowerCase().replace(/[^a-z0-9]/g, '');
      const candidate = rows.find((row) => {
        const rowName = text(row?.strPlayer).toLowerCase().replace(/[^a-z0-9]/g, '');
        return rowName === normalized && sportMatches(sport, row?.strSport);
      }) || rows.find((row) => sportMatches(sport, row?.strSport)) || rows[0] || null;
      const imageUrl = text(candidate?.strCutout || candidate?.strThumb || candidate?.strFanart1);
      const meta = {
        fetchedAt: Date.now(),
        source: 'TheSportsDB',
        playerName: candidate?.strPlayer || name,
        team: candidate?.strTeam || null,
        position: candidate?.strPosition || null,
        imagePath: null,
        contentType: null,
      };
      if (imageUrl) {
        const imageResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(8000) });
        if (imageResponse.ok) {
          const type = text(imageResponse.headers.get('content-type')) || 'image/jpeg';
          const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
          const file = path.join(CACHE_DIR, `${safeName(cacheKey)}.${ext}`);
          const buffer = Buffer.from(await imageResponse.arrayBuffer());
          if (buffer.length > 0 && buffer.length < 5_000_000) {
            writeFileSync(file, buffer);
            meta.imagePath = file;
            meta.contentType = type;
          }
        }
      }
      index[cacheKey] = meta;
      saveIndex();
      return meta;
    } catch {
      const miss = { fetchedAt: Date.now(), source: 'TheSportsDB', playerName: name, team: null, position: null, imagePath: null, contentType: null };
      index[cacheKey] = miss;
      saveIndex();
      return miss;
    } finally {
      inflight.delete(cacheKey);
    }
  })();
  inflight.set(cacheKey, promise);
  return promise;
}

function svgPlaceholder(name) {
  const initials = text(name).split(/\s+/).filter(Boolean).slice(0,2).map((p) => p[0]?.toUpperCase() || '').join('') || 'AS';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#17243a"/><stop offset="1" stop-color="#0b1320"/></linearGradient></defs><rect width="128" height="128" rx="64" fill="url(#g)"/><circle cx="64" cy="48" r="24" fill="#283953"/><path d="M24 116c4-28 22-43 40-43s36 15 40 43" fill="#283953"/><text x="64" y="119" text-anchor="middle" font-family="Arial,sans-serif" font-size="15" font-weight="700" fill="#a9bbd2">${initials}</text></svg>`);
}

export async function playerArtworkResponse(sport, name) {
  const requestedName = text(name);
  if (!requestedName) return { status: 400, contentType: 'image/svg+xml', body: svgPlaceholder('AS'), source: 'placeholder' };
  const entry = await resolveArtwork(sport, requestedName);
  if (entry?.imagePath && existsSync(entry.imagePath)) {
    try { return { status: 200, contentType: entry.contentType || 'image/jpeg', body: readFileSync(entry.imagePath), source: entry.source, team: entry.team, position: entry.position }; } catch {}
  }
  return { status: 200, contentType: 'image/svg+xml', body: svgPlaceholder(requestedName), source: 'placeholder', team: entry?.team || null, position: entry?.position || null };
}

export async function playerArtworkMeta(sport, name) {
  const entry = await resolveArtwork(sport, name);
  return {
    available: Boolean(entry?.imagePath),
    source: entry?.source || null,
    playerName: entry?.playerName || name,
    team: entry?.team || null,
    position: entry?.position || null,
  };
}
