import { ImageResponse } from 'next/og';

// Raster versions of the existing OP app/icon.svg, not player artwork.
// The built-in image font is used; no remote font or provider request.
export async function GET(_request: Request, context: { params: Promise<{ size: string }> }) {
  const { size: filename } = await context.params;
  const size = ({ '180.png': 180, '192.png': 192, '512.png': 512 } as Record<string, number>)[filename];
  if (!size) return new Response('Not found', { status: 404 });
  return new ImageResponse(
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#3DE8A8', color: '#04150E', fontSize: size * .4, fontWeight: 800, letterSpacing: -size * .025 }}>OP</div>,
    { width: size, height: size, headers: { 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' } },
  );
}
