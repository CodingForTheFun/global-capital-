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

async function main() {
  const payload = await readInput();
  if (!process.env.DATA_DIR) throw new Error('User worker DATA_DIR is required.');
  await fs.mkdir(path.resolve(process.env.DATA_DIR), { recursive: true });

  if (action === 'connection') {
    const { getPickFinderConnectionState } = await import('./secure-store.mjs');
    emit('result', await getPickFinderConnectionState());
    return;
  }

  if (action === 'connect') {
    const { connectPickFinderV3 } = await import('./pickfinder-auth-v3.mjs');
    emit('result', await connectPickFinderV3(payload));
    return;
  }

  if (action === 'disconnect') {
    const { disconnectPickFinder } = await import('./pickfinder-v2.mjs');
    emit('result', await disconnectPickFinder());
    return;
  }

  if (action === 'scan') {
    const { ensurePickFinderV3 } = await import('./pickfinder-auth-v3.mjs');
    await ensurePickFinderV3({ onProgress: (data) => emit('progress', data) });
    const { runLiveScan } = await import('./pickfinder-v2.mjs');
    const result = await runLiveScan({
      rules: payload.rules,
      onProgress: (data) => emit('progress', data),
    });
    emit('result', result);
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
