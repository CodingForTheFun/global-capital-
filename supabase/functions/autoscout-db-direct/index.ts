import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.3";

const rawDbUrl = Deno.env.get("SUPABASE_DB_URL") || "";
const configuredPoolerUrl = Deno.env.get("SUPABASE_DB_POOLER_URL") || "";
const configuredPoolerHost = Deno.env.get("SUPABASE_DB_POOLER_HOST") || "";
const projectRegion = "us-east-1";

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
    return raw;
  }
}

function candidateUrls() {
  if (configuredPoolerUrl) return [configuredPoolerUrl];
  if (!rawDbUrl) return [];
  try {
    const parsed = new URL(rawDbUrl);
    if (parsed.hostname.endsWith(".pooler.supabase.com")) {
      parsed.port = "6543";
      return [parsed.toString()];
    }
  } catch {
    return [rawDbUrl];
  }

  // Shared Supavisor cluster indexes are not derivable from region. Probe only
  // official hosts for this project's region, cache the first working endpoint,
  // and never expose or log a connection string or database password.
  const hosts = [
    configuredPoolerHost,
    ...Array.from({ length: 8 }, (_, index) => `aws-${index}-${projectRegion}.pooler.supabase.com`),
  ].filter(Boolean);
  return [...new Set(hosts)].map((host) => poolerUrl(rawDbUrl, host));
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
    const urls = candidateUrls();
    if (!urls.length) throw Object.assign(new Error("database not configured"), { code: "DATABASE_NOT_CONFIGURED" });
    let lastError: any = null;
    for (let index = 0; index < urls.length; index += 1) {
      const candidate = postgres(urls[index], {
        prepare: false,
        max: 1,
        connect_timeout: 3,
        idle_timeout: 20,
      });
      try {
        await candidate`select 1 as ok`;
        sqlClient = candidate;
        console.log(`autoscout-db-direct database transport=transaction-pooler candidate=${index + 1}/${urls.length}`);
        return candidate;
      } catch (error) {
        lastError = error;
        await closeClient(candidate);
      }
    }
    throw lastError || Object.assign(new Error("database connection failed"), { code: "CONNECT_FAILED" });
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
  if (!rawDbUrl && !configuredPoolerUrl) return json({ error: "database_not_configured" }, 503);

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
    let message = String(error?.message || "database operation failed").slice(0, 240);
    if (token) message = message.split(token).join("[redacted]");
    if (headerToken) message = message.split(headerToken).join("[redacted]");
    return json({ error: "database_operation_failed", code: pgCode || null, message }, 500);
  }
});
