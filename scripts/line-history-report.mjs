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
 * Needs AUTOSCOUT_SUPABASE_URL and AUTOSCOUT_SUPABASE_SERVICE_ROLE_KEY, the
 * same pair lib/autoscout/supabase-persistence.mjs uses. Neither is printed.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { analyzeLineHistory, formatLineHistoryReport } from '../lib/diagnostics/line-history.mjs';

const text = (value) => String(value ?? '').trim();
const SUPABASE_URL = text(process.env.AUTOSCOUT_SUPABASE_URL || process.env.SUPABASE_URL).replace(/\/$/, '');
const SERVICE_KEY = text(process.env.AUTOSCOUT_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

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
async function fetchSnapshots(sinceIso) {
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
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
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

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('AUTOSCOUT_SUPABASE_URL and AUTOSCOUT_SUPABASE_SERVICE_ROLE_KEY must be set.');
    process.exit(2);
  }
  const since = new Date(Date.now() - days * 24 * 3_600_000).toISOString();
  const rows = await fetchSnapshots(since);
  const report = analyzeLineHistory(rows, { windowDays: days });
  const ledger = await appendLedger(report);

  if (asJson) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(formatLineHistoryReport(report));
    if (ledger) console.log(`\n  ledger: ${ledger}`);
  }
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(`[line-history] ${error?.message || error}`);
  process.exit(2);
});
