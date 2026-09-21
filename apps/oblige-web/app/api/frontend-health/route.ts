export const dynamic = 'force-dynamic';

const BACKEND = (process.env.OBLIGE_BACKEND_ORIGIN || 'https://autoprop-live-production.up.railway.app').replace(/\/+$/, '');

export async function GET() {
  let backendHealthy = false;
  try {
    const response = await fetch(`${BACKEND}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    backendHealthy = response.ok;
  } catch {
    backendHealthy = false;
  }

  return Response.json({
    ok: true,
    service: 'oblige-web',
    revision: process.env.RAILWAY_GIT_COMMIT_SHA || null,
    backendHealthy,
  });
}
