import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.3";

const rawDbUrl = Deno.env.get("SUPABASE_DB_URL") || "";
const configuredPoolerUrl = Deno.env.get("SUPABASE_DB_POOLER_URL") || "";
const configuredPoolerHost = Deno.env.get("SUPABASE_DB_POOLER_HOST") || "aws-0-us-east-1.pooler.supabase.com";
const canonicalPoolerHost = "aws-0-us-east-1.pooler.supabase.com";

// Supabase's direct database endpoint is IPv6-first and is intended for
// persistent backends. This function is short-lived edge/serverless traffic,
// so route its transient PostgreSQL connections through Supavisor transaction
// pooling instead. Preserve the existing database password in-memory; never log
// or return the connection string. A separately configured pooler URL wins, but
// an invalid configured pooler can fall back to the known-good regional host.
function transactionPoolerUrl(raw: string, poolerHost = configuredPoolerHost) {
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.hostname.endsWith(".pooler.supabase.com") && url.port === "6543") {
      url.hostname = poolerHost;
      return url.toString();
    }
    const match = url.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
    if (!match) return raw;
    const projectRef = match[1];
    url.hostname = poolerHost;
    url.port = "6543";
    if (!decodeURIComponent(url.username || "").includes(".")) url.username = `postgres.${projectRef}`;
    return url.toString();
  } catch {
    return raw;
  }
}

const configuredDbUrl = configuredPoolerUrl || transactionPoolerUrl(rawDbUrl);
const canonicalDbUrl = transactionPoolerUrl(rawDbUrl, canonicalPoolerHost);
const dbUrls = [...new Set([configuredDbUrl, canonicalDbUrl].filter(Boolean))];
const sqlClients = dbUrls.map((url) => postgres(url, {
  // Transaction pool mode does not support prepared statements.
  prepare: false,
  max: 1,
  connect_timeout: 10,
  idle_timeout: 2,
}));

const transientConnectionCodes = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "CONNECT_TIMEOUT",
]);

async function withDatabase<T>(operation: (client: any) => Promise<T>): Promise<T> {
  let lastError: any = null;
  for (let i = 0; i < sqlClients.length; i += 1) {
    try {
      return await operation(sqlClients[i]);
    } catch (error: any) {
      lastError = error;
      const code = String(error?.code || "");
      if (!transientConnectionCodes.has(code) || i === sqlClients.length - 1) throw error;
      console.warn("autoscout-db-direct transient database connection failure; retrying fallback pooler", code);
    }
  }
  throw lastError || new Error("database_not_configured");
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

console.log(`autoscout-db-direct database transport=transaction-pooler candidates=${sqlClients.length}`);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!sqlClients.length) return json({ error: "database_not_configured" }, 503);

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
    if (name === "autoscout_ingest_board") {
      const payload = JSON.stringify(args?.p_payload || {});
      const rows: any = await withDatabase((sql) => sql`select public.autoscout_ingest_board(${token}, ${payload}::jsonb) as result`);
      return json(rows[0]?.result ?? null);
    }

    if (name === "autoscout_public_store") {
      const action = String(args?.p_action || "");
      const payload = JSON.stringify(args?.p_payload || {});
      const rows: any = await withDatabase((sql) => sql`select public.autoscout_public_store(${token}, ${action}, ${payload}::jsonb) as result`);
      return json(rows[0]?.result ?? null);
    }

    if (name === "autoscout_public_history_store") {
      const action = String(args?.p_action || "");
      const payload = JSON.stringify(args?.p_payload || {});
      const rows: any = await withDatabase((sql) => sql`select public.autoscout_public_history_store(${token}, ${action}, ${payload}::jsonb) as result`);
      return json(rows[0]?.result ?? null);
    }

    const propId = String(args?.p_prop_id || "");
    const bookmaker = args?.p_bookmaker_key == null ? null : String(args.p_bookmaker_key);
    const side = args?.p_side == null ? null : String(args.p_side);
    const limit = Math.max(1, Math.min(1000, Number(args?.p_limit) || 250));
    const rows: any = await withDatabase((sql) => sql`select * from public.autoscout_line_history(${token}, ${propId}, ${bookmaker}, ${side}, ${limit})`);
    return json(rows);
  } catch (error: any) {
    console.error("autoscout-db-direct", name, error);
    const pgCode = String(error?.code || "").slice(0, 32);
    let message = String(error?.message || "database operation failed").slice(0, 240);
    if (token) message = message.split(token).join("[redacted]");
    if (headerToken) message = message.split(headerToken).join("[redacted]");
    return json({ error: "database_operation_failed", code: pgCode || null, message }, 500);
  }
});
