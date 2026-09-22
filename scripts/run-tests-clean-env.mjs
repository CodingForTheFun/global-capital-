import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Both suite directories are collected. `test/` used to be left out, so a file
// there could sit broken indefinitely without anything reporting it -- which is
// exactly what happened to test/player-prop-research-card.test.mjs.
const testFiles = ['tests', 'test']
  .flatMap((dir) =>
    readdirSync(path.join(root, dir))
      .filter((name) => name.endsWith('.test.mjs'))
      .sort()
      .map((name) => path.join(dir, name)),
  );

if (!testFiles.length) {
  console.error('[predeploy] refusing to pass with zero test files');
  process.exit(1);
}

// Production services carry live credentials and owner/account configuration.
// Unit/integration tests must not inherit those values: doing so changes test
// semantics and can make tests touch production state. Keep only process-level
// runtime variables and force a test environment, matching CI's clean context.
const cleanEnv = {
  PATH: process.env.PATH || '',
  HOME: process.env.HOME || '',
  USER: process.env.USER || '',
  TMPDIR: process.env.TMPDIR || '/tmp',
  TEMP: process.env.TEMP || '',
  TMP: process.env.TMP || '',
  TZ: process.env.TZ || 'UTC',
  CI: '1',
  NODE_ENV: 'test',
};

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: root,
  env: cleanEnv,
  stdio: 'inherit',
});

if (result.error) {
  console.error(`[predeploy] test runner failed to start: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
