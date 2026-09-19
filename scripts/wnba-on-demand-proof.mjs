#!/usr/bin/env node
// Standalone operator command: no env credentials, production API call, or persistence.
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runWnbaProof, PROOF_EXIT } from '../lib/diagnostics/wnba-on-demand-proof.mjs';
let result;
try {
  const { values } = parseArgs({ options: { live: { type: 'boolean', default: false },
    date: { type: 'string', default: '2026-09-17' }, 'event-id': { type: 'string' }, 'athlete-id': { type: 'string' } } });
  if (!values.live) result = { status: 'UNVERIFIABLE', code: 'EXPLICIT_LIVE_OPT_IN_REQUIRED', issue: 308 };
  else {
    const source = new URL('../lib/data-sources/espn/research.mjs', import.meta.url);
    const sourceHash = createHash('sha256').update(await readFile(source)).digest('hex');
    const { createPublicResearch } = await import(source.href);
    result = await runWnbaProof({ date: values.date, eventId: values['event-id'], athleteId: values['athlete-id'],
      createResearch: createPublicResearch });
    result.providerSourceSha256 = sourceHash;
  }
} catch {
  result = { status: 'UNVERIFIABLE', code: 'PROBE_SETUP_FAILED', issue: 308 };
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = PROOF_EXIT[result.status] ?? 2;
