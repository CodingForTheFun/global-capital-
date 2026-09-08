import fs from 'node:fs/promises';
import path from 'node:path';

const action = process.argv[2] || '';

function emit(type, data) {
  process.stdout.write(`${JSON.stringify({ type, data })}\n`);
}

async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

async function requireUnlocked() {
  const { validateSavedPickFinderSession } = await import('./auth-v3.mjs');
  const auth = await validateSavedPickFinderSession();
  if (!auth?.connected || !auth?.unlocked) {
    throw Object.assign(
      new Error('PickFinder needs to be reconnected before using live research. Connect your own PickFinder account and verify it is unlocked.'),
      { code: 'PICKFINDER_RECONNECT' },
    );
  }
  return auth;
}

async function main() {
  const payload = await readInput();
  if (!process.env.DATA_DIR) throw new Error('User worker DATA_DIR is required.');
  await fs.mkdir(path.resolve(process.env.DATA_DIR), { recursive: true, mode: 0o700 });

  if (action === 'connection') {
    const { getPickFinderConnectionState } = await import('./secure-store.mjs');
    emit('result', await getPickFinderConnectionState());
    return;
  }

  if (action === 'validate') {
    const { validateSavedPickFinderSession } = await import('./auth-v3.mjs');
    emit('result', await validateSavedPickFinderSession());
    return;
  }

  if (action === 'connect') {
    const { verifyPickFinderConnection } = await import('./auth-v3.mjs');
    emit('result', await verifyPickFinderConnection({ email: payload.email, password: payload.password }));
    return;
  }

  if (action === 'disconnect') {
    const { disconnectPickFinder } = await import('./production.mjs');
    emit('result', await disconnectPickFinder());
    return;
  }

  if (action === 'scan') {
    await requireUnlocked();
    const { runLiveScan } = await import('./production.mjs');
    const result = await runLiveScan({
      rules: payload.rules,
      onProgress: (data) => emit('progress', data),
    });
    emit('result', result);
    return;
  }

  if (action === 'search') {
    await requireUnlocked();
    const { searchLiveProps } = await import('./focused.mjs');
    emit('result', await searchLiveProps(String(payload.query || '')));
    return;
  }

  if (action === 'scan-prop') {
    await requireUnlocked();
    const { scanLiveProp } = await import('./focused.mjs');
    if (!payload.selection) throw new Error('A verified prop selection is required.');
    emit('result', await scanLiveProp(payload.selection));
    return;
  }

  throw new Error(`Unknown user worker action: ${action}`);
}

main().catch((error) => {
  emit('error', {
    message: error?.message || String(error),
    code: error?.code || null,
    stack: process.env.DIAGNOSTICS === 'true' ? error?.stack || null : null,
  });
  process.exitCode = 1;
});
