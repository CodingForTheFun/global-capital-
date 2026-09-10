import { from, supabaseConfig, SupabaseError } from './supabase.mjs';

// Every repository is fail-closed: with no Supabase configured, or no rows
// ingested yet, callers get an explicit "unavailable" answer rather than an
// invented number. Nothing here fabricates statistics.

export class DataUnavailable extends Error {
  constructor(reason, { source = null } = {}) {
    super(reason);
    this.name = 'DataUnavailable';
    this.available = false;
    this.reason = reason;
    this.source = source;
  }
}

const unavailable = (reason, source) => ({ available: false, reason, source: source || null, rows: [] });

function ready() {
  return supabaseConfig().configured;
}

// --- line history ---------------------------------------------------------

export const lineHistory = {
  // Append-only movement log. The scanner calls this on every observed line.
  async record(snapshots, { serviceRole = true } = {}) {
    if (!ready()) return { written: 0, skipped: true, reason: 'Supabase is not configured.' };
    const rows = (Array.isArray(snapshots) ? snapshots : [snapshots])
      .filter((row) => row && row.propId && row.bookmakerKey && row.side)
      .map((row) => ({
        prop_id: String(row.propId),
        bookmaker_key: String(row.bookmakerKey),
        side: String(row.side).toUpperCase() === 'UNDER' ? 'UNDER' : 'OVER',
        line: Number(row.line),
        price: row.price === undefined || row.price === null ? null : Number(row.price),
        provider_updated_at: row.providerUpdatedAt || null,
        ingested_at: row.ingestedAt || new Date().toISOString(),
      }))
      .filter((row) => Number.isFinite(row.line));

    if (!rows.length) return { written: 0, skipped: true, reason: 'No valid snapshots supplied.' };
    await from('line_snapshots', { serviceRole }).insert(rows, { returning: 'minimal' });
    return { written: rows.length, skipped: false };
  },

  // Ordered movement for one prop/book/side.
  async forProp({ propId, bookmakerKey, side, sinceHours = 72, limit = 500, accessToken }) {
    if (!ready()) return unavailable('Supabase is not configured.');
    const filters = { prop_id: `eq.${propId}` };
    if (bookmakerKey) filters.bookmaker_key = `eq.${bookmakerKey}`;
    if (side) filters.side = `eq.${String(side).toUpperCase()}`;
    if (sinceHours) {
      filters.created_at = `gte.${new Date(Date.now() - sinceHours * 3600 * 1000).toISOString()}`;
    }

    const { rows } = await from('line_snapshots', { accessToken })
      .select('bookmaker_key,side,line,price,provider_updated_at,created_at', {
        filters, order: 'created_at.asc', limit,
      });

    if (!rows.length) {
      return unavailable('No line history has been recorded for this prop yet.', 'line_snapshots');
    }
    return {
      available: true,
      source: 'line_snapshots',
      rows: rows.map((row) => ({
        bookmakerKey: row.bookmaker_key,
        side: row.side,
        line: Number(row.line),
        price: row.price === null ? null : Number(row.price),
        at: row.created_at,
        providerUpdatedAt: row.provider_updated_at,
      })),
    };
  },

  // Open -> current movement summary, computed from recorded history only.
  async movement({ propId, bookmakerKey, side, sinceHours = 72, accessToken }) {
    const history = await this.forProp({ propId, bookmakerKey, side, sinceHours, accessToken });
    if (!history.available) return history;

    const rows = history.rows;
    const first = rows[0];
    const last = rows[rows.length - 1];
    const lines = rows.map((row) => row.line);

    return {
      available: true,
      source: 'line_snapshots',
      samples: rows.length,
      openedAt: first.at,
      openLine: first.line,
      currentLine: last.line,
      currentPrice: last.price,
      lineDelta: Number((last.line - first.line).toFixed(4)),
      direction: last.line > first.line ? 'UP' : last.line < first.line ? 'DOWN' : 'FLAT',
      low: Math.min(...lines),
      high: Math.max(...lines),
      lastMoveAt: last.at,
    };
  },

  // Books currently disagreeing on the same prop, straight from stored lines.
  async spread({ propId, side = 'OVER', accessToken }) {
    if (!ready()) return unavailable('Supabase is not configured.');
    const { rows } = await from('prop_lines', { accessToken })
      .select('bookmaker_key,side,line,price,updated_at', {
        filters: { prop_id: `eq.${propId}`, side: `eq.${String(side).toUpperCase()}` },
        order: 'line.asc',
      });
    if (!rows.length) return unavailable('No book lines are stored for this prop.', 'prop_lines');

    const lines = rows.map((row) => Number(row.line));
    return {
      available: true,
      source: 'prop_lines',
      books: rows.length,
      low: Math.min(...lines),
      high: Math.max(...lines),
      spread: Number((Math.max(...lines) - Math.min(...lines)).toFixed(4)),
      rows: rows.map((row) => ({
        bookmakerKey: row.bookmaker_key,
        line: Number(row.line),
        price: row.price === null ? null : Number(row.price),
        updatedAt: row.updated_at,
      })),
    };
  },
};

// --- player statistics (L5 / L10 / L15 / H2H) -----------------------------

export const playerStats = {
  // Reads only what a real stats provider has written. Never derived, never
  // estimated: an empty table means "unavailable", not zero.
  async samples({ playerId, statKey, accessToken }) {
    if (!ready()) return unavailable('Supabase is not configured.');
    const filters = { player_id: `eq.${playerId}` };
    if (statKey) filters.stat_key = `eq.${statKey}`;

    const { rows } = await from('player_statistics', { accessToken })
      .select('stat_key,stat_value,sample_type,provider,provider_updated_at,event_id,metadata', {
        filters, order: 'provider_updated_at.desc', limit: 200,
      });

    if (!rows.length) {
      return unavailable(
        'No game-stat provider is connected, so hit rates are unavailable.',
        'player_statistics',
      );
    }

    const bySample = new Map();
    for (const row of rows) {
      const key = row.sample_type || 'unknown';
      if (!bySample.has(key)) bySample.set(key, []);
      bySample.get(key).push({
        statKey: row.stat_key,
        value: row.stat_value === null ? null : Number(row.stat_value),
        eventId: row.event_id,
        at: row.provider_updated_at,
        provider: row.provider,
      });
    }

    return {
      available: true,
      source: 'player_statistics',
      provider: rows[0].provider,
      samples: Object.fromEntries(bySample),
    };
  },

  // Hit rate over a stored sample window against a line. Returns unavailable
  // unless enough real observations exist to fill the window.
  async hitRate({ playerId, statKey, line, window = 10, side = 'OVER', accessToken }) {
    const result = await this.samples({ playerId, statKey, accessToken });
    if (!result.available) return result;

    const flat = Object.values(result.samples).flat()
      .filter((row) => row.statKey === statKey && Number.isFinite(row.value))
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, window);

    if (flat.length < window) {
      return unavailable(
        `Only ${flat.length} of ${window} required games are stored for this stat.`,
        'player_statistics',
      );
    }

    const threshold = Number(line);
    const hits = flat.filter((row) => (
      String(side).toUpperCase() === 'UNDER' ? row.value < threshold : row.value > threshold
    )).length;

    return {
      available: true,
      source: 'player_statistics',
      provider: result.provider,
      window,
      side: String(side).toUpperCase(),
      line: threshold,
      games: flat.length,
      hits,
      hitRate: Number(((hits / flat.length) * 100).toFixed(1)),
    };
  },
};

// --- injuries / live scores / headshots -----------------------------------

export const injuries = {
  async forPlayer({ playerId, accessToken }) {
    if (!ready()) return unavailable('Supabase is not configured.');
    const { rows } = await from('injuries', { accessToken })
      .select('status,detail,provider,provider_updated_at,event_id', {
        filters: { player_id: `eq.${playerId}` }, order: 'provider_updated_at.desc', limit: 5,
      });
    if (!rows.length) return unavailable('No injury provider is connected.', 'injuries');
    return {
      available: true,
      source: 'injuries',
      provider: rows[0].provider,
      current: {
        status: rows[0].status,
        detail: rows[0].detail,
        at: rows[0].provider_updated_at,
      },
      rows,
    };
  },
};

export const liveScores = {
  async forEvent({ eventId, accessToken }) {
    if (!ready()) return unavailable('Supabase is not configured.');
    const { rows } = await from('games', { accessToken })
      .select('period,clock,status,home_score,away_score,provider,provider_updated_at', {
        filters: { event_id: `eq.${eventId}` }, limit: 1,
      });
    if (!rows.length) return unavailable('No live scores provider is connected.', 'games');
    const row = rows[0];
    return {
      available: true,
      source: 'games',
      provider: row.provider,
      period: row.period,
      clock: row.clock,
      status: row.status,
      homeScore: row.home_score === null ? null : Number(row.home_score),
      awayScore: row.away_score === null ? null : Number(row.away_score),
      at: row.provider_updated_at,
    };
  },
};

export const headshots = {
  // Returns only a URL a licensed provider actually wrote. Callers render
  // initials when this is unavailable — nothing is scraped or guessed.
  async forPlayers({ playerIds = [], accessToken }) {
    if (!ready()) return unavailable('Supabase is not configured.');
    if (!playerIds.length) return { available: true, source: 'players', rows: [] };

    const list = playerIds.map((id) => `"${String(id).replace(/"/g, '')}"`).join(',');
    const { rows } = await from('players', { accessToken })
      .select('id,name,team,position,headshot_url', { filters: { id: `in.(${list})` }, limit: playerIds.length });

    const withImage = rows.filter((row) => row.headshot_url);
    return {
      available: true,
      source: 'players',
      licensed: withImage.length,
      missing: rows.length - withImage.length,
      rows: rows.map((row) => ({
        id: row.id,
        name: row.name,
        team: row.team,
        position: row.position,
        // null means "render initials", never a scraped or placeholder image.
        headshotUrl: row.headshot_url || null,
        initials: String(row.name || '').split(/\s+/).map((part) => part[0] || '').join('').slice(0, 2).toUpperCase(),
      })),
    };
  },
};

// --- provider diagnostics (admin console) ---------------------------------

export const diagnostics = {
  async startRun({ provider, sportKey = null, metadata = {} }) {
    if (!ready()) return null;
    const rows = await from('provider_sync_runs', { serviceRole: true })
      .insert({ provider, sport_key: sportKey, status: 'RUNNING', metadata });
    return rows?.[0]?.id || null;
  },

  async finishRun(runId, { status = 'SUCCEEDED', eventsCount = 0, propsCount = 0, linesCount = 0, creditsUsed = null, metadata }) {
    if (!ready() || !runId) return;
    await from('provider_sync_runs', { serviceRole: true }).update({
      status,
      completed_at: new Date().toISOString(),
      events_count: eventsCount,
      props_count: propsCount,
      lines_count: linesCount,
      credits_used: creditsUsed,
      ...(metadata ? { metadata } : {}),
    }, { filters: { id: `eq.${runId}` }, returning: 'minimal' });
  },

  async recordError({ provider, sportKey = null, eventId = null, endpoint = null, httpStatus = null, errorCode = null, reason }) {
    if (!ready()) return;
    await from('provider_errors', { serviceRole: true }).insert({
      provider, sport_key: sportKey, event_id: eventId, endpoint,
      http_status: httpStatus, error_code: errorCode,
      reason: String(reason || '').slice(0, 1000),
    }, { returning: 'minimal' }).catch(() => {});
  },

  async recordUsage({ provider, sportKey = null, endpoint = null, credits = null, requestsUsed = null, requestsRemaining = null }) {
    if (!ready()) return;
    await from('api_usage', { serviceRole: true }).insert({
      provider, sport_key: sportKey, endpoint, credits,
      requests_used: requestsUsed, requests_remaining: requestsRemaining,
    }, { returning: 'minimal' }).catch(() => {});
  },

  async recentRuns({ limit = 20, accessToken } = {}) {
    if (!ready()) return unavailable('Supabase is not configured.');
    const { rows } = await from('provider_sync_runs', { accessToken })
      .select('id,provider,sport_key,started_at,completed_at,status,events_count,props_count,lines_count,credits_used', {
        order: 'started_at.desc', limit,
      });
    return { available: true, source: 'provider_sync_runs', rows };
  },

  async recentErrors({ limit = 25, accessToken } = {}) {
    if (!ready()) return unavailable('Supabase is not configured.');
    const { rows } = await from('provider_errors', { accessToken })
      .select('id,provider,sport_key,endpoint,http_status,error_code,reason,created_at', {
        order: 'created_at.desc', limit,
      });
    return { available: true, source: 'provider_errors', rows };
  },

  async usageSummary({ limit = 50, accessToken } = {}) {
    if (!ready()) return unavailable('Supabase is not configured.');
    const { rows } = await from('api_usage', { accessToken })
      .select('provider,endpoint,credits,requests_used,requests_remaining,created_at', {
        order: 'created_at.desc', limit,
      });
    if (!rows.length) return { available: true, source: 'api_usage', rows: [], byProvider: {} };

    const byProvider = {};
    for (const row of rows) {
      const bucket = byProvider[row.provider] || (byProvider[row.provider] = { calls: 0, credits: 0, remaining: null });
      bucket.calls += 1;
      bucket.credits += Number(row.credits || 0);
      if (bucket.remaining === null && row.requests_remaining !== null) {
        bucket.remaining = Number(row.requests_remaining);
      }
    }
    return { available: true, source: 'api_usage', rows, byProvider };
  },
};

// --- subscriptions --------------------------------------------------------

export const subscriptions = {
  async forUser({ userId, accessToken }) {
    if (!ready()) return null;
    const { rows } = await from('subscriptions', { accessToken })
      .select('tier,status,provider,provider_customer_id,provider_subscription_id,current_period_end,updated_at', {
        filters: { user_id: `eq.${userId}` }, limit: 1,
      });
    return rows[0] || null;
  },

  // Written with the service role: a user must never be able to grant
  // themselves a tier by calling PostgREST directly.
  async upsert({ userId, tier, status, provider, providerCustomerId, providerSubscriptionId, currentPeriodEnd }) {
    if (!ready()) throw new SupabaseError('Supabase is not configured.', { status: 503, code: 'SUPABASE_UNCONFIGURED' });
    const rows = await from('subscriptions', { serviceRole: true }).insert({
      user_id: userId,
      tier,
      status,
      provider: provider || null,
      provider_customer_id: providerCustomerId || null,
      provider_subscription_id: providerSubscriptionId || null,
      current_period_end: currentPeriodEnd || null,
      updated_at: new Date().toISOString(),
    }, { upsert: true, onConflict: 'user_id' });
    return rows?.[0] || null;
  },

  async listAll({ limit = 100, accessToken } = {}) {
    if (!ready()) return unavailable('Supabase is not configured.');
    const { rows } = await from('subscriptions', { accessToken })
      .select('user_id,tier,status,provider,current_period_end,updated_at', {
        order: 'updated_at.desc', limit,
      });
    return { available: true, source: 'subscriptions', rows };
  },
};

// --- admin: users ---------------------------------------------------------

export const users = {
  async list({ limit = 100, accessToken } = {}) {
    if (!ready()) return unavailable('Supabase is not configured.');
    const { rows } = await from('users', { accessToken })
      .select('id,email,display_name,role,created_at,updated_at', { order: 'created_at.desc', limit });
    return { available: true, source: 'users', rows };
  },

  async setRole({ userId, role, accessToken }) {
    const allowed = ['USER', 'PREMIUM', 'ADMIN', 'OWNER'];
    if (!allowed.includes(role)) throw new Error(`Role must be one of ${allowed.join(', ')}.`);
    const rows = await from('users', { accessToken })
      .update({ role, updated_at: new Date().toISOString() }, { filters: { id: `eq.${userId}` } });
    return rows?.[0] || null;
  },
};
