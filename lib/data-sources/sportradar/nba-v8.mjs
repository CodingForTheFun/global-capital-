import { sportradarApiKey } from './client.mjs';

const HOST = 'https://api.sportradar.com';
const text = (value) => String(value ?? '').trim();

const state = {
  configured: false,
  running: false,
  lastOkAt: null,
  lastFailAt: null,
  lastError: null,
  lastStatus: null,
  accessLevel: null,
  teamCount: null,
};

function selectedMode() {
  return text(process.env.OBLIGE_PROP_PROVIDER_MODE || process.env.PROP_PROVIDER_MODE || 'auto').toLowerCase();
}

function enabled() {
  return ['sportradar','radar','sr'].includes(selectedMode()) && Boolean(sportradarApiKey());
}

function candidateAccessLevels() {
  const configured = text(process.env.SPORTRADAR_NBA_ACCESS_LEVEL || process.env.SPORTRADAR_ACCESS_LEVEL).toLowerCase();
  if (['trial','production'].includes(configured)) return [configured];
  if (state.accessLevel) return [state.accessLevel];
  return ['production','trial'];
}

function safeCode(status) {
  if (status === 401) return 'SPORTRADAR_NBA_UNAUTHORIZED';
  if (status === 403) return 'SPORTRADAR_NBA_FORBIDDEN';
  if (status === 429) return 'SPORTRADAR_NBA_RATE_LIMITED';
  return `SPORTRADAR_NBA_HTTP_${status}`;
}

async function one(accessLevel, path, { timeoutMs = 10_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(`${HOST}/nba/${accessLevel}/v8/en${path}`, {
      headers: { accept: 'application/json', 'x-api-key': sportradarApiKey() },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw Object.assign(new Error('Sportradar NBA v8 request failed.'), {
        code: safeCode(response.status),
        status: response.status,
        accessLevel,
      });
    }
    state.accessLevel = accessLevel;
    state.lastOkAt = new Date().toISOString();
    state.lastFailAt = null;
    state.lastError = null;
    state.lastStatus = response.status;
    return { payload, accessLevel, status: response.status };
  } catch (error) {
    if (error?.name === 'AbortError' && !error?.code) {
      throw Object.assign(new Error('Sportradar NBA v8 request timed out.'), { code: 'SPORTRADAR_NBA_TIMEOUT' });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function sportradarNbaV8Get(path, options = {}) {
  if (!sportradarApiKey()) {
    throw Object.assign(new Error('Sportradar API key is not configured.'), { code: 'SPORTRADAR_NBA_NOT_CONFIGURED' });
  }
  let lastError = null;
  for (const accessLevel of candidateAccessLevels()) {
    try {
      return await one(accessLevel, path, options);
    } catch (error) {
      lastError = error;
      state.lastFailAt = new Date().toISOString();
      state.lastStatus = Number(error?.status) || null;
      state.lastError = text(error?.code || error?.name || 'SPORTRADAR_NBA_FAILED');
      if (candidateAccessLevels().length === 1 || ![401,403].includes(Number(error?.status))) break;
    }
  }
  throw lastError || Object.assign(new Error('Sportradar NBA v8 request failed.'), { code: 'SPORTRADAR_NBA_FAILED' });
}

export async function probeSportradarNbaV8() {
  state.configured = Boolean(sportradarApiKey());
  const result = await sportradarNbaV8Get('/league/hierarchy.json');
  const conferences = Array.isArray(result?.payload?.conferences) ? result.payload.conferences : [];
  const teams = conferences.flatMap((conference) =>
    Array.isArray(conference?.divisions)
      ? conference.divisions.flatMap((division) => Array.isArray(division?.teams) ? division.teams : [])
      : []
  );
  state.teamCount = teams.length || null;
  return {
    authenticated: true,
    accessLevel: result.accessLevel,
    teamCount: state.teamCount,
    league: result?.payload?.league?.alias || result?.payload?.league?.name || 'NBA',
  };
}

export function startSportradarNbaV8Probe() {
  if (!enabled() || state.running) return null;
  state.running = true;
  const timer = setTimeout(() => {
    void probeSportradarNbaV8()
      .then((result) => {
        console.log(`[Sportradar NBA v8] authenticated=true access=${result.accessLevel} league=${result.league} teams=${result.teamCount ?? 'unknown'}`);
      })
      .catch((error) => {
        console.log(`[Sportradar NBA v8] authenticated=false code=${text(error?.code || 'SPORTRADAR_NBA_VERIFY_FAILED')} status=${Number(error?.status) || 0}`);
      })
      .finally(() => { state.running = false; });
  }, 2_500);
  timer.unref?.();
  return timer;
}

export function sportradarNbaV8Health() {
  return {
    configured: Boolean(sportradarApiKey()),
    enabled: enabled(),
    product: 'NBA API v8',
    accessLevel: state.accessLevel,
    lastOkAt: state.lastOkAt,
    lastFailAt: state.lastFailAt,
    lastError: state.lastError,
    lastStatus: state.lastStatus,
    teamCount: state.teamCount,
  };
}
