export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return;
  const { verifyTypeSafeOnce } = await import('./lib/typesafe');
  const result = await verifyTypeSafeOnce();
  // A failed optional AI connection must never prevent the research site starting.
  console.info(`[typesafe] ${result.status}`);
}
