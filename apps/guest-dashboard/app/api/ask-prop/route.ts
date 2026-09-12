import { NextRequest, NextResponse } from 'next/server';

type AskPayload = {
  prompt?: string;
  prop?: {
    player?: string;
    team?: string;
    opponent?: string;
    stat?: string;
    line?: number;
    pickDirection?: 'OVER' | 'UNDER';
    recentGameResults?: number[];
  };
};

const SYSTEM_PROMPT = `You are the ObligePay Edge prop research assistant. Answer ONLY from the structured prop card data supplied by the user. Do not use outside facts, injuries, news, projections, sportsbook information, or unstated assumptions. Do not tell the user what to bet, whether a pick is good, or recommend wagering. You may summarize trends, count recent outcomes above or below the supplied line, compare the supplied game values with the line, and explain uncertainty. If the question requires information not present in the card, say that the card does not contain enough information. Keep the answer concise and factual.`;

function validBody(body: AskPayload) {
  const p = body.prop;
  return Boolean(
    body.prompt?.trim() &&
    p?.player?.trim() &&
    p?.stat?.trim() &&
    Number.isFinite(Number(p?.line)) &&
    (p?.pickDirection === 'OVER' || p?.pickDirection === 'UNDER') &&
    Array.isArray(p?.recentGameResults) &&
    p.recentGameResults.length > 0 &&
    p.recentGameResults.every((n) => Number.isFinite(Number(n)))
  );
}

export async function POST(request: NextRequest) {
  if (request.cookies.get('obligepay_edge_guest_ask')?.value === '1') {
    return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 403 });
  }

  let body: AskPayload;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }); }

  if (!validBody(body)) return NextResponse.json({ error: 'Missing or invalid prop context.' }, { status: 400 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'AI service is not configured.' }, { status: 503 });

  const prop = body.prop!;
  const context = {
    player: prop.player,
    team: prop.team,
    opponent: prop.opponent,
    stat: prop.stat,
    line: Number(prop.line),
    pickDirection: prop.pickDirection,
    recentGameResults: prop.recentGameResults,
  };

  const upstream = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
      instructions: SYSTEM_PROMPT,
      input: `PROP CARD JSON:\n${JSON.stringify(context)}\n\nGUEST QUESTION:\n${body.prompt!.trim()}`,
      max_output_tokens: 220,
    }),
    cache: 'no-store',
  });

  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) return NextResponse.json({ error: 'AI service request failed.' }, { status: 502 });

  const answer = data.output_text || data.output?.flatMap((item: any) => item.content || []).find((item: any) => item.type === 'output_text')?.text;
  if (!answer) return NextResponse.json({ error: 'AI service returned no answer.' }, { status: 502 });

  const response = NextResponse.json({ answer });
  response.cookies.set('obligepay_edge_guest_ask', '1', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  return response;
}
