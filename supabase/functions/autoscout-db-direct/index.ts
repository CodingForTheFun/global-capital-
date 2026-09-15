import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.3";

const dbUrl = Deno.env.get("SUPABASE_DB_URL") || "";
const sql = postgres(dbUrl, {
  prepare: false,
  max: 1,
  connect_timeout: 10,
  idle_timeout: 20,
});

const allowedFunctions = new Set([
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
  if (!dbUrl) return json({ error: "database_not_configured" }, 503);

  let body: any;
  try { body = await req.json(); }
  catch { return json({ error: "invalid_json" }, 400); }

  const name = String(body?.name || "");
  const args = body?.args && typeof body.args === "object" ? body.args : {};
  const token = String(args?.p_token || "");
  const headerToken = String(req.headers.get("x-autoscout-ingest-token") || "");
  if (!allowedFunctions.has(name)) return json({ error: "unsupported_function" }, 400);
  if (!token || !headerToken || token !== headerToken) return json({ error: "unauthorized" }, 401);

  try {
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
  } catch (error) {
    console.error("autoscout-db-direct", name, error);
    return json({ error: "database_operation_failed" }, 500);
  }
});
