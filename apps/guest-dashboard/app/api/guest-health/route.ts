import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export function GET() { return NextResponse.json({ ok: true, application: 'ObligePay Edge', guestDashboard: true, samplePreview: true, aiAvailable: Boolean(process.env.GEMINI_API_KEY), release: process.env.RAILWAY_GIT_COMMIT_SHA || 'local' }, { headers: { 'cache-control': 'no-store' } }); }
