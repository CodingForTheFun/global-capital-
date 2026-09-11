// "Ask about this prop" — a short, grounded conversation about one prop.
//
// Same discipline as the projection service: dormant without a key, bounded
// payload, nothing invented. The difference is the answer is prose rather than
// a schema, so the grounding has to come from the prompt and from the fact that
// the model is handed the same measured payload the card is drawn from.
//
// Each message is a paid request, so history is capped and the route that calls
// this carries its own tight rate limit.

import Anthropic from '@anthropic-ai/sdk';
import { buildModelPayload } from './service.mjs';

const MODEL = process.env.PROJECTION_MODEL || 'claude-opus-5';
const MAX_TOKENS = 1024;
const MAX_TURNS = 8;
const MAX_QUESTION = 500;
const REQUEST_TIMEOUT_MS = 45_000;

let client = null;

export const ASK_SYSTEM_PROMPT = `You answer a bettor's questions about one specific player prop. The user's message is preceded by a JSON payload describing that prop: the sportsbook lines and prices, the player's recent game log and rolling averages, the opponent, and whatever context is available.

Ground every claim in that payload. If you cite a number, it must appear there. When the payload does not contain what the question needs, say plainly what is missing and what would answer it — do not reach for general knowledge about the player, the team or the season, and do not estimate a figure the payload does not support.

Be short. Two or three sentences for most questions; a brief list only when the question genuinely has several parts. Write for someone deciding whether to place a bet in the next few minutes, not for an analyst reading a report.

You are not a tipster. You can lay out what the numbers show and what the risks are, but do not tell the user to place a bet, do not predict outcomes with certainty, and do not describe anything as a lock or free money. If the evidence is thin, say so — that is the useful answer.

Stay on this prop. If asked about something else, say it is outside what you can see here.`;

export function askConfigured() {
  return Boolean(String(process.env.ANTHROPIC_API_KEY || '').trim());
}

function getClient() {
  if (!client) client = new Anthropic({ maxRetries: 1, timeout: REQUEST_TIMEOUT_MS });
  return client;
}

const unavailable = (code, message) => ({
  ok: true, available: false, code,
  message: message || 'That question could not be answered right now.',
});

/**
 * Normalize prior turns.
 *
 * Only role and text survive, alternating from the user. Anything else a
 * caller sends — a forged assistant turn carrying instructions, say — is
 * dropped rather than replayed to the model.
 */
export function normalizeHistory(history = []) {
  return (Array.isArray(history) ? history : [])
    .slice(-MAX_TURNS)
    .map((turn) => ({
      role: turn?.role === 'assistant' ? 'assistant' : 'user',
      content: String(turn?.content ?? '').trim().slice(0, MAX_QUESTION),
    }))
    .filter((turn) => turn.content);
}

export async function askAboutProp({ question, prop = {}, history = [] } = {}) {
  if (!askConfigured()) return unavailable('ASK_NOT_CONFIGURED', 'Ask is not enabled.');
  const text = String(question ?? '').trim().slice(0, MAX_QUESTION);
  if (!text) return unavailable('ASK_EMPTY_QUESTION', 'Type a question first.');

  const payload = buildModelPayload(prop);
  const turns = normalizeHistory(history);
  // The payload rides with the first user turn so the cached system prefix
  // stays byte-identical across every prop and every question.
  const messages = [
    { role: 'user', content: `Prop under discussion:\n${JSON.stringify(payload)}` },
    ...turns,
    { role: 'user', content: text },
  ];

  let response;
  try {
    response = await getClient().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: 'text', text: ASK_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low' },
      messages,
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return unavailable('ASK_NOT_CONFIGURED', 'Ask is not enabled.');
    if (error instanceof Anthropic.RateLimitError) return unavailable('ASK_RATE_LIMITED', 'Too busy right now. Try again shortly.');
    if (error instanceof Anthropic.APIError) {
      console.error('[ask] provider error', String(error.status || '').slice(0, 8));
      return unavailable('ASK_PROVIDER_ERROR');
    }
    console.error('[ask] request failed', String(error?.message || 'unknown').slice(0, 120));
    return unavailable('ASK_PROVIDER_ERROR');
  }

  if (response?.stop_reason === 'refusal') return unavailable('ASK_DECLINED', 'That question could not be answered.');
  const answer = (response?.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
  if (!answer) return unavailable('ASK_EMPTY_ANSWER');

  return { ok: true, available: true, answer, truncated: response?.stop_reason === 'max_tokens' };
}
