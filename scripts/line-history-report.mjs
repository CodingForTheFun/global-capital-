#!/usr/bin/env node
/**
 * Prove — or disprove — that line history is actually accumulating.
 *
 * Reads recent `line_snapshots` straight from PostgREST, analyses them with
 * lib/diagnostics/line-history.mjs, prints a report, and appends one JSON line
 * to a ledger so that running it daily builds the week-long evidence rather
 * than only ever showing a single moment.
 *
 * Exits non-zero when history is not being written, so it can gate a check.
 *
 *   node scripts/line-history-report.mjs [--days 7] [--limit 50000] [--json]
 *
 * Needs a Supabase URL plus either a service-role key or a publishable/anon key.
 * The report accepts both the legacy AUTOSCOUT_* names and the current Railway
 * SUPABASE_* publishable-key contract. Credential values are never printed.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { analyzeLineHistory, formatLineHistoryReport } from '../lib/diagnostics/line-history.mjs';

const text = (value) => String(value ?? '').trim();
const SUPABASE_URL = text(process.env.AUTOSCOUT_SUPABASE_URL || process.env.SUPABASE_URL).replace(/\/$/, '');
const SERVICE_KEY = text(process.env.AUTOSCOUT_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
const PUBLIC_KEY = text(
  process.env.AUTOSCOUT_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY,
);

/**
 * Which credential we get to read with, and whether it is actually allowed to
 * see rows.
 *
 * RLS on line_snapshots grants select to the `authenticated` role. A service
 * role key satisfies that; the publishable key authenticates as `anon` and gets
 * an empty set with HTTP 200 rather than a refusal. So with the publishable key
 * an empty result is genuinely ambiguous, and the report must say so instead of
 * announcing that history has stopped.
 */
function credential() {
  if (SERVICE_KEY) return { key: SERVICE_KEY, tier: 'service', privileged: true };
  if (PUBLIC_KEY) return { key: PUBLIC_KEY, tier: 'publishable', privileged: false };
  return { key: '', tier: 'none', privileged: false };
}

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
const days = flag('days', 7);
const limit = flag('limit', 50_000);
const asJson = process.argv.includes('--json');

/** PostgREST pages at 1000 rows by default; walk it with Range headers. */
async function fetchSnapshots(sinceIso, cred) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; offset < limit; offset += pageSize) {
    const query = new URLSearchParams({
      select: 'prop_id,bookmaker_key,side,line,price,created_at',
      created_at: `gte.${sinceIso}`,
      order: 'created_at.asc',
    });
    const response = await fetch(`${SUPABASE_URL}/rest/v1/line_snapshots?${query}`, {
      headers: {
        apikey: cred.key,
        authorization: `Bearer ${cred.key}`,
        accept: 'application/json',
        range: `${offset}-${offset + pageSize - 1}`,
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      // The body can echo connection strings on some errors; report status only.
      throw new Error(`line_snapshots read failed with HTTP ${response.status}`);
    }
    const page = await response.json();
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function appendLedger(report) {
  const dir = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
  const file = path.join(dir, 'line-history-proof.jsonl');
  const entry = {
    at: report.evaluatedAt,
    ok: report.ok,
    unverifiable: report.unverifiable,
    credentialTier: report.credentialTier,
    rows: report.rows,
    series: report.series,
    trackedSeries: report.trackedSeries,
    longestSpanHours: report.longestSpanHours,
    daysCovered: report.daysCovered,
    provenForWindow: report.provenForWindow,
    failures: report.failures,
  };
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8');
    return file;
  } catch (error) {
    // A missing volume must not fail the check itself.
    console.error(`[line-history] could not append ledger: ${error?.code || 'write failed'}`);
    return null;
  }
}

function printUnverifiable(reason) {
  if (asJson) {
    console.log(JSON.stringify({
      verdict: 'UNVERIFIABLE',
      ok: false,
      unverifiable: true,
      evaluatedAt: new Date().toISOString(),
      failures: [reason],
    }, null, 2));
  } else {
    console.error(`Line history — UNVERIFIABLE (evaluated ${new Date().toISOString()})`);
    console.error(`\n  unverifiable because:\n    - ${reason}`);
  }
}

async function main() {
  const cred = credential();
  if (!SUPABASE_URL || !cred.key) {
    printUnverifiable('Supabase URL or readable credential is not configured for the proof job');
    process.exit(3);
  }
  const since = new Date(Date.now() - days * 24 * 3_600_000).toISOString();
  const rows = await fetchSnapshots(since, cred);
  // Rows coming back prove the credential can read, whatever its tier.
  const readable = cred.privileged || rows.length > 0;
  const report = analyzeLineHistory(rows, { windowDays: days, readable });
  report.credentialTier = cred.tier;
  report.verdict = report.unverifiable ? 'UNVERIFIABLE' : report.ok ? 'HEALTHY' : 'FAILING';
  const ledger = await appendLedger(report);

  if (asJson) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(formatLineHistoryReport(report));
    if (ledger) console.log(`\n  ledger: ${ledger}`);
  }
  // 0 healthy, 1 genuinely failing, 3 cannot tell. A daily job must not report
  // a failure it did not actually observe.
  if (report.unverifiable) {
    console.error('\n  Cannot distinguish "no history" from "not allowed to read it".');
    console.error('  Use a service-role credential or grant select on line_snapshots to the reading role.');
    process.exit(3);
  }
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  printUnverifiable(error?.message || 'unexpected line-history read error');
  process.exit(3);
});
