#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildHistoryPlan, createHistoryTransport, runHistoryMaintenance, summarizeHistoryPlan } from '../lib/diagnostics/verified-history-maintenance.mjs';

const MAX_BYTES = 12000000;
export function parseHistoryArgs(args) {
  const allowed = new Set(['mode','max-players','max-requests','max-rows','max-ms','offset','out','snapshot-in','snapshot-out','evidence-out','approve-snapshot']);
  const result = {};
  for (const arg of args) {
    const match = /^--([a-z-]+)=(.+)$/.exec(arg);
    if (!match || !allowed.has(match[1]) || Object.hasOwn(result, match[1])) throw new Error('INVALID_ARGUMENT');
    result[match[1]] = match[2];
  }
  if (result.mode && !['audit','probe','apply'].includes(result.mode)) throw new Error('INVALID_MODE');
  for (const [name, max] of [['max-players',100],['max-requests',500],['max-rows',1000],['max-ms',600000],['offset',100000]]) {
    if (result[name] !== undefined && (!/^\d+$/.test(result[name]) || Number(result[name]) > max
      || (name !== 'offset' && Number(result[name]) < 1))) throw new Error('INVALID_LIMIT');
  }
  if ((result.mode || 'audit') === 'apply' && !/^[a-f0-9]{64}$/.test(result['approve-snapshot'] || '')) throw new Error('SNAPSHOT_APPROVAL_REQUIRED');
  return result;
}

async function limitedJson(response) {
  if (!response.ok) throw new Error('MAINTENANCE_RPC_FAILED');
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('MAINTENANCE_RESPONSE_TOO_LARGE');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('MAINTENANCE_RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createHistoryRpc(env = process.env, fetchImpl = globalThis.fetch) {
  const root = String(env.AUTOSCOUT_SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/$/,'');
  const key = env.AUTOSCOUT_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
  const token = env.AUTOSCOUT_SUPABASE_INGEST_TOKEN;
  let url;
  try { url = new URL(root); } catch { throw new Error('MAINTENANCE_NOT_CONFIGURED'); }
  if (url.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/.test(url.hostname) || url.port
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !key || !token)
    throw new Error('MAINTENANCE_NOT_CONFIGURED');
  return async (action, payload = {}) => {
    if (!['snapshot','read_keys','insert_verified'].includes(action)) throw new Error('INVALID_RPC_ACTION');
    try {
      const response = await fetchImpl(`${root}/rest/v1/rpc/autoscout_verified_history_maintenance`, {
        method:'POST', redirect:'error', headers:{'content-type':'application/json',accept:'application/json',apikey:key},
        body:JSON.stringify({p_token:token,p_action:action,p_payload:payload}), signal:AbortSignal.timeout(12000),
      });
      return await limitedJson(response);
    } catch {
      // Never include request headers, bodies, raw provider errors, or secrets.
      throw new Error('MAINTENANCE_RPC_UNAVAILABLE');
    }
  };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseHistoryArgs(args), mode = options.mode || 'audit';
  // Lazy imports keep argument/help tests independent of any runtime setup.
  // This is the PUBLIC adapter, not researchPlayerProp (which has paid fallback).
  const { createPublicResearch } = await import('../lib/data-sources/espn/research.mjs');
  const { canonicalSport, marketContract, PUBLIC_LEAGUES } = await import('../lib/data-sources/espn/stat-contract.mjs');
  const { historyRowsFromResearch } = await import('../lib/ingestion/game-log-persistence.mjs');
  let rpc;
  const getRpc = () => rpc ||= createHistoryRpc();
  let snapshot;
  if (options['snapshot-in']) {
    const data = await readFile(options['snapshot-in']);
    if (data.length > MAX_BYTES) throw new Error('SNAPSHOT_TOO_LARGE');
    snapshot = JSON.parse(data.toString('utf8'));
  } else snapshot = await getRpc()('snapshot');
  if (mode === 'apply' && (Date.now() - Date.parse(snapshot.asOf) > 1800000 || Date.parse(snapshot.asOf) > Date.now()))
    throw new Error('APPLY_SNAPSHOT_EXPIRED');
  const plan = buildHistoryPlan(snapshot, { canonicalSport, marketContract, publicLeagues: PUBLIC_LEAGUES });
  const transport = createHistoryTransport({ maxRequests: options['max-requests'], maxMs: options['max-ms'] });
  const evidence = [];
  const report = await runHistoryMaintenance(plan, {
    mode, approveSnapshot: options['approve-snapshot'], maxPlayers: options['max-players'], maxRows: options['max-rows'],
    offset: Number(options.offset || 0), fetchResearch: createPublicResearch({fetchImpl:transport.fetch}),
    mapRows: historyRowsFromResearch, transportStatus: transport.status,
    onEvidence: options['evidence-out'] ? async record => { evidence.push(record); } : undefined,
    readRows: async rows => (await getRpc()('read_keys', {rows: rows.map(({player_id,game_id,category}) => ({player_id,game_id,category}))})).rows,
    insertRows: (rows, candidate) => getRpc()('insert_verified', {rows,candidate}),
  });
  report.scope = snapshot.scope || 'explicit input cohort';
  report.completeActiveUniverse = snapshot.completeActiveUniverse === true;
  if (mode === 'apply') {
    try {
      const after = await getRpc()('snapshot');
      const fixedCohort = buildHistoryPlan({...snapshot, history: after.history}, {canonicalSport,marketContract,publicLeagues:PUBLIC_LEAGUES});
      report.after = {asOf:after.asOf,cohortHash:fixedCohort.cohortHash,sports:summarizeHistoryPlan(fixedCohort),
        note:'Same frozen active cohort; concurrent live writes can also affect this comparison.'};
    } catch { report.after = {status:'UNVERIFIABLE'}; process.exitCode=2; }
  }
  const path = options.out || `history-coverage-${Date.now()}.json`;
  // Report and snapshot are internal operational data; neither contains secrets.
  // Exclusive creation prevents an accidental overwrite of a reviewed artifact.
  await writeFile(path, JSON.stringify(report,null,2)+'\n', {mode:0o600,flag:'wx'});
  if (options['evidence-out']) await writeFile(options['evidence-out'], JSON.stringify({schemaVersion:1,scope:report.scope,cohortHash:plan.cohortHash,verifiedAt:new Date().toISOString(),source:'ESPN existing verified public parser',records:evidence},null,2)+'\n', {mode:0o600,flag:'wx'});
  if (options['snapshot-out']) await writeFile(options['snapshot-out'], JSON.stringify(snapshot)+'\n', {mode:0o600,flag:'wx'});
  console.log(JSON.stringify({mode,report:path,cohortHash:plan.cohortHash,players:plan.totalPlayers,
    attempted:report.attemptedPlayers,insertedRows:report.insertedRows,stopped:report.stopped}));
  if (report.stopped) process.exitCode = 2;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('VERIFIED_HISTORY_MAINTENANCE_FAILED: inspect configuration, migration, arguments and report; no raw error is logged.'); process.exitCode=2; });
}
