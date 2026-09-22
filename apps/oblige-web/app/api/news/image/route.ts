import { relayNewsImage } from '@/lib/news-image';

// Serves ESPN news photos from this origin so the CSP can stay img-src 'self'.
// All validation lives in lib/news-image.ts.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return relayNewsImage(request);
}
