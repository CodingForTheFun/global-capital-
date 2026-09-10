import { rpc, supabaseConfig } from './supabase.mjs';

// The database already exposes a token-gated backend ingest path
// (public.autoscout_ingest_board) that upserts the whole board in one
// transaction. Writes go through it rather than opening a second write path
// with the service-role key.
//
// Payload contract, mirroring the function's jsonb_to_recordset columns:
//   bookmakers [{ key, name, updated_at }]
//   markets    [{ key, name, sport_key, period, updated_at }]
//   events     [{ id, provider, provider_event_id, sport_key, league_key,
//                 home_team, away_team, commence_time, status,
//                 home_score, away_score, provider_updated_at, ingested_at, updated_at }]
//   players    [{ id, sport_key, league_key, provider, provider_player_id,
//                 canonical_name, name, team, position, headshot_url, updated_at }]
//   props      [{ id, event_id, player_id, sport_key, league_key, market_key,
//                 market_name, period, is_alternate, provider, ingested_at, updated_at }]
//   lines      [{ id, prop_id, provider, bookmaker_key, side, line, price,
//                 implied_probability, deeplink, provider_updated_at, ingested_at, updated_at }]
//   snapshots  [{ prop_id, bookmaker_key, side, line, price, provider_updated_at, ingested_at }]

export function ingestConfig() {
  const token = String(process.env.AUTOSCOUT_BACKEND_TOKEN || '').trim();
  return {
    token,
    configured: Boolean(token && supabaseConfig().configured),
  };
}

const SECTIONS = ['bookmakers', 'markets', 'events', 'players', 'props', 'lines', 'snapshots'];

export function emptyBoard() {
  return Object.fromEntries(SECTIONS.map((section) => [section, []]));
}

function countRows(payload) {
  return SECTIONS.reduce((total, section) => total + (payload[section]?.length || 0), 0);
}

export async function ingestBoard(payload) {
  const config = ingestConfig();
  if (!config.configured) {
    return {
      ok: false,
      skipped: true,
      reason: supabaseConfig().configured
        ? 'AUTOSCOUT_BACKEND_TOKEN is not set, so nothing was written.'
        : 'Supabase is not configured, so nothing was written.',
    };
  }

  const body = { ...emptyBoard(), ...payload };
  for (const section of SECTIONS) {
    if (!Array.isArray(body[section])) body[section] = [];
  }
  if (!countRows(body)) return { ok: true, skipped: true, reason: 'Nothing to ingest.' };

  // The function raises 42501 on a bad token; surface that as-is rather than
  // silently treating a rejected write as success.
  const result = await rpc('autoscout_ingest_board', { p_token: config.token, p_payload: body });
  return { ok: true, skipped: false, ...(result || {}) };
}

// Backend read path, used when no end-user JWT is available (workers, jobs).
export async function readLineHistory({ propId, bookmakerKey = null, side = null, limit = 250 }) {
  const config = ingestConfig();
  if (!config.configured) {
    return { available: false, reason: 'AUTOSCOUT_BACKEND_TOKEN is not set.', rows: [] };
  }
  const rows = await rpc('autoscout_line_history', {
    p_token: config.token,
    p_prop_id: propId,
    p_bookmaker_key: bookmakerKey,
    p_side: side,
    p_limit: Math.max(1, Math.min(Number(limit) || 250, 1000)),
  });
  if (!rows?.length) return { available: false, reason: 'No line history recorded for this prop.', rows: [] };
  return {
    available: true,
    source: 'autoscout_line_history',
    rows: rows.map((row) => ({
      bookmakerKey: row.bookmaker_key,
      side: row.side,
      line: Number(row.line),
      price: row.price === null ? null : Number(row.price),
      at: row.created_at,
      providerUpdatedAt: row.provider_updated_at,
    })),
  };
}
