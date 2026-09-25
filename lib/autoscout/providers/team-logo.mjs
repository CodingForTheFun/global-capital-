// Team logos, served from this origin (the CSP allows images only from 'self').
//
// A team label from any feed (BOS, Boston, Boston Celtics) is resolved against
// ESPN's public team directory for that league with the same conservative
// matcher the artwork route uses. Only an unambiguous single match is used,
// and only a logo hosted at a.espncdn.com/i/teamlogos/ is fetched. Anything
// else gets a neutral abbreviation badge, never another team's crest.
import {PUBLIC_LEAGUES,canonicalSport} from '../../data-sources/espn/stat-contract.mjs';
import {matchesTeamRecord} from '../../data-sources/espn/identity.mjs';

const DAY = 86_400_000;
const MAX_BYTES = 1_000_000;
const MAX_ENTRIES = 600;

const escapeXml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function teamBadge(label) {
  const words = String(label || '').trim().split(/\s+/).filter(Boolean);
  const short = (words.length === 1 ? words[0].slice(0, 3) : words.map(w => w[0]).join('').slice(0, 3)).toUpperCase() || '?';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="31" fill="#172040"/><text x="32" y="38" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="18" font-weight="700" fill="#a9b3d3">${escapeXml(short)}</text></svg>`);
}

export function verifiedLogoUrl(value) {
  try {
    const u = new URL(String(value || ''));
    return u.protocol === 'https:' && u.hostname === 'a.espncdn.com' && !u.username && !u.password
      && /^\/i\/teamlogos\/[a-z0-9-]+\/500(?:-dark)?\/[a-z0-9_-]+\.png$/i.test(u.pathname) ? u.href : null;
  } catch { return null; }
}

function teamsOf(directory) {
  return (directory?.sports || []).flatMap(s => (s.leagues || []).flatMap(l => (l.teams || []).map(t => t.team))).filter(Boolean);
}

export function createTeamLogo({ fetchImpl = (...args) => fetch(...args), now = () => Date.now() } = {}) {
  const directories = new Map(), images = new Map(), pending = new Map();

  async function directory(sport) {
    const hit = directories.get(sport);
    if (hit && hit.expires > now()) return hit.teams;
    const [family, league] = PUBLIC_LEAGUES[sport] || [];
    if (!family || !league) return [];
    const r = await fetchImpl(`https://site.api.espn.com/apis/site/v2/sports/${family}/${league}/teams?limit=1000`, { signal: AbortSignal.timeout(6000), headers: { accept: 'application/json' } });
    if (!r.ok) throw Error('Directory unavailable');
    const teams = teamsOf(await r.json());
    directories.set(sport, { teams, expires: now() + DAY });
    return teams;
  }

  async function png(url) {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (!r.ok || (r.headers.get('content-type') || '').split(';')[0] !== 'image/png') throw Error('No logo');
    const chunks = []; let size = 0;
    for await (const chunk of r.body) { size += chunk.length; if (size > MAX_BYTES) throw Error('Oversize logo'); chunks.push(chunk); }
    const bytes = Buffer.concat(chunks);
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('Invalid logo');
    return bytes;
  }

  /** Returns { status, body, contentType, cacheControl, verified, name, abbreviation }. */
  async function get(sportInput, teamInput) {
    const sport = canonicalSport(sportInput), team = String(teamInput || '').trim().slice(0, 90);
    const fallback = { status: 200, verified: false, contentType: 'image/svg+xml', body: teamBadge(team), cacheControl: 'public, max-age=300' };
    if (!team || !PUBLIC_LEAGUES[sport]?.[1]) return fallback;
    const key = sport + '|' + team.toLowerCase();
    const hit = images.get(key);
    if (hit && hit.expires > now()) return hit.value;
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      let value = fallback, ttl = 5 * 60_000;
      try {
        const matches = (await directory(sport)).filter(t => matchesTeamRecord(team, t, sport));
        const unique = new Map(matches.map(t => [String(t.id), t]));
        if (unique.size === 1) {
          const t = [...unique.values()][0];
          const url = verifiedLogoUrl((t.logos || []).find(l => verifiedLogoUrl(l?.href))?.href);
          if (url) {
            value = { status: 200, verified: true, contentType: 'image/png', body: await png(url), cacheControl: 'public, max-age=86400',
              name: t.displayName || null, abbreviation: t.abbreviation || null };
            ttl = 7 * DAY;
          }
        }
      } catch { ttl = 30_000; }
      images.set(key, { value, expires: now() + ttl });
      while (images.size > MAX_ENTRIES) images.delete(images.keys().next().value);
      return value;
    })().finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  }
  return get;
}

export const teamLogoResponse = createTeamLogo();
