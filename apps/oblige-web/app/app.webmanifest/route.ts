import { appManifest, APP_RELEASE } from '@/lib/pwa';
export function GET() {
  return new Response(JSON.stringify(appManifest), { headers: {
    'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff', 'X-Oblige-App-Release': APP_RELEASE,
  } });
}
