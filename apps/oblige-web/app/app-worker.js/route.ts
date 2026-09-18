import { appWorker, APP_RELEASE } from '@/lib/pwa';
export function GET() {
  return new Response(appWorker, { headers: {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0', 'Service-Worker-Allowed': '/',
    'X-Content-Type-Options': 'nosniff', 'X-Oblige-App-Release': APP_RELEASE,
  } });
}
