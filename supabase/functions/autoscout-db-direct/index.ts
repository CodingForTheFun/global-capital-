import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.3";

const rawDbUrl = Deno.env.get("SUPABASE_DB_URL") || "";
const configuredPoolerUrl = Deno.env.get("SUPABASE_DB_POOLER_URL") || "";
const configuredPoolerHost = Deno.env.get("SUPABASE_DB_POOLER_HOST") || "";

function poolerUrl(raw: string, host: string) {
  if (!raw || !host) return "";
  try {
    const url = new URL(raw);
    const match = url.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
    if (!match) return raw;
    const projectRef = match[1];
    url.hostname = host;
    url.port = "6543";
    if (!decodeURIComponent(url.username || "").includes(".")) url.username = `postgres.${projectRef}`;
    return url.toString();
  } catch {
    return "";
  }
}

function configuredDatabaseUrl() {
  if (configuredPoolerUrl) return configuredPoolerUrl;
  if (configuredPoolerHost && rawDbUrl) return poolerUrl(rawDbUrl, configuredPoolerHost);
  // Never guess a Supavisor cluster. A guessed cluster can authenticate against
  // an unintended database. Direct persistence stays unavailable until an
  // explicit transaction-pooler URL or host is configured.
  return "";
}

type SqlClient = ReturnType<typeof postgres>;
let sqlClient: SqlClient | null = null;
let connecting: Promise<SqlClient> | null = null;

async function closeClient(client: SqlClient | null) {
  if (!client) return;
  try { await client.end({ timeout: 0 }); } catch { /* no-op */ }
}

async function connectDatabase(): Promise<SqlClient> {
  if (sqlClient) return sqlClient;
  if (connecting) return connecting;
  connecting = (async () => {
    const url = configuredDatabaseUrl();
    if (!url) throw Object.assign(new Error("direct database pooler not configured"), { code: "DATABASE_POOLER_NOT_CONFIGURED" });
    const candidate = postgres(url, {
      prepare: false,
      max: 1,
      connect_timeout: 3,
      idle_timeout: 20,
    });
    try {
      await candidate`select 1 as ok`;
      sqlClient = candidate;
      console.log("autoscout-db-direct database transport=explicit-transaction-pooler");
      return candidate;
    } catch (error) {
      await closeClient(candidate);
      throw error;
    }
  })();
  try { return await connecting; }
  finally { connecting = null; }
}

const transientSafeFunctions = new Set([
  "autoscout_ingest_board",
  "autoscout_line_history",
  "autoscout_public_store",
  "autoscout_public_history_store",
]);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
});

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!configuredDatabaseUrl()) return json({ error: "database_pooler_not_configured" }, 503);

  let body: any;
  try { body = await req.json(); }
  catch { return json({ error: "invalid_json" }, 400); }

  const name = String(body?.name || "");
  const args = body?.args && typeof body.args === "object" ? body.args : {};
  const token = String(args?.p_token || "");
  const headerToken = String(req.headers.get("x-autoscout-ingest-token") || "");
  if (!transientSafeFunctions.has(name)) return json({ error: "unsupported_function" }, 400);
  if (!token || !headerToken || token !== headerToken) return json({ error: "unauthorized" }, 401);

  try {
    const sql = await connectDatabase();
    if (name === "autoscout_ingest_board") {
      const payload = JSON.stringify(args?.p_payload || {});
      const rows = await sql`select public.autoscout_ingest_board(${token}, ${payload}::jsonb) as result`;
      return json(rows[0]?.result ?? null);
    }
    if (name === "autoscout_public_store") {
      const action = String(args?.p_action || "");
      const payload = JSON.stringify(args?.p_payload || {});
      const rows = await sql`select public.autoscout_public_store(${token}, ${action}, ${payload}::jsonb) as result`;
      return json(rows[0]?.result ?? null);
    }
    if (name === "autoscout_public_history_store") {
      const action = String(args?.p_action || "");
      const payload = JSON.stringify(args?.p_payload || {});
      const rows = await sql`select public.autoscout_public_history_store(${token}, ${action}, ${payload}::jsonb) as result`;
      return json(rows[0]?.result ?? null);
    }
    const propId = String(args?.p_prop_id || "");
    const bookmaker = args?.p_bookmaker_key == null ? null : String(args.p_bookmaker_key);
    const side = args?.p_side == null ? null : String(args.p_side);
    const limit = Math.max(1, Math.min(1000, Number(args?.p_limit) || 250));
    const rows = await sql`select * from public.autoscout_line_history(${token}, ${propId}, ${bookmaker}, ${side}, ${limit})`;
    return json(rows);
  } catch (error: any) {
    const broken = sqlClient;
    sqlClient = null;
    await closeClient(broken);
    console.error("autoscout-db-direct", name, error);
    const pgCode = String(error?.code || "").slice(0, 32);
    let message = String(error?.message || "database operation failed").slice(0, 180);
    if (token) message = message.split(token).join("[redacted]");
    if (headerToken) message = message.split(headerToken).join("[redacted]");
    if (name === "autoscout_public_store") {
      const action = String(args?.p_action || "").slice(0, 24);
      const source = String(args?.p_payload?.source || "").slice(0, 80);
      const observedAt = String(args?.p_payload?.observed_at || "").slice(0, 40);
      message = `${message}; context action=${action || "none"} source=${source || "none"} observed_at=${observedAt || "none"}`.slice(0, 320);
    }
    return json({ error: "database_operation_failed", code: pgCode || null, message }, 500);
  }
});
