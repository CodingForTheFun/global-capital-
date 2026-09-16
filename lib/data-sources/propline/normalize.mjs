// PropLine event odds -> the normalized board this product already renders.
//
// The odds response shape here is taken from PropLine's published contract, not
// from a captured live response: the shared demo key was at its daily cap when
// this was written. So every field is read defensively and anything unreadable
// is counted and reported rather than thrown - a shape surprise should show up
// in health as "skipped 400 outcomes", not take a refresh down.
import {
  normalizedEvent,
  normalizedPlayer,
  normalizedProp,
  normalizedBookmakerLine,
  numberOrNull,
  stableId,
} from '../../autoscout/models.mjs';
import { bookKey, isAlternateOutcome, sideFromOutcome, sportFromProplineKey, specialFromOddsType } from './markets.mjs';

const text = (value) => String(value ?? '').trim();
const list = (value) => (Array.isArray(value) ? value : []);
const validTime = (value) => {
  const ms = Date.parse(text(value));
  return Number.isFinite(ms) ? ms : null;
};

const invalidPlayerLabel = (value) => {
  const lower = text(value).toLowerCase();
  if (!lower) return true;
  if (/\binnings?\b/.test(lower) && /^(last|first|next|top|bottom)\b/.test(lower)) return true;
  if (/^(1st|2nd|3rd|4th|5th|6th|7th|8th|9th)\s+innings?\b/.test(lower)) return true;
  return false;
};

// American odds -> implied probability, the same convention the rest of the
// board uses. Kept here so a PropLine price and a scraped price are comparable.
export function impliedProbability(price) {
  const n = numberOrNull(price);
  if (n === null || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
}

/**
 * Turn one PropLine event-odds payload into normalized rows.
 *
 * Returns the four board collections plus a `skipped` tally, so a caller can
 * tell the difference between "this event had no props" and "this event had
 * props in a shape we could not read".
 */
export function normalizeEventOdds(payload, { sport = null, ingestedAt = new Date().toISOString(), provider = 'propline' } = {}) {
  const resolvedSport = text(sport).toUpperCase() || sportFromProplineKey(payload?.sport_key);
  const providerEventId = text(payload?.id || payload?.event_id);
  const skipped = { noSport: 0, noSide: 0, noLine: 0, noPlayer: 0, unreadable: 0, suspended: 0, withdrawn: 0 };

  if (!resolvedSport || !providerEventId) {
    return { events: [], players: [], props: [], lines: [], skipped: { ...skipped, noSport: 1 } };
  }

  const event = normalizedEvent({
    provider,
    providerEventId,
    sport: resolvedSport,
    league: resolvedSport,
    homeTeam: text(payload?.home_team),
    awayTeam: text(payload?.away_team),
    commenceTime: payload?.commence_time || null,
    providerUpdatedAt: payload?.last_update || payload?.updated_at || null,
    ingestedAt,
  });

  const players = new Map();
  const props = new Map();
  const lines = [];

  for (const bookmaker of list(payload?.bookmakers)) {
    const book = bookKey(bookmaker?.key);
    if (!book) continue;
    const bookName = text(bookmaker?.title || bookmaker?.name || bookmaker?.key) || book;
    const pregameOnly = bookmaker?.pregame_only === true;

    for (const market of list(bookmaker?.markets)) {
      const marketKey = text(market?.key).toLowerCase();
      if (!marketKey) continue;
      const outcomes = list(market?.outcomes);

      // PropLine's pull-side availability signal. A suspended market must not be
      // shown merely because its last quoted prices are still present in the
      // payload. Push `market_suspended` handles this after startup; this check
      // makes a cold REST bootstrap fail closed too.
      if (text(market?.suspended_at)) {
        skipped.suspended += outcomes.length || 1;
        continue;
      }
      const marketUpdatedAt = validTime(market?.last_update);

      for (const outcome of outcomes) {
        try {
          // PropLine documents last_seen_at < market.last_update as a selection
          // that missed the market's latest delivery — a withdrawal in progress.
          // It is not currently takeable, so never publish it as a live quote.
          const lastSeenAt = validTime(outcome?.last_seen_at);
          if (lastSeenAt !== null && marketUpdatedAt !== null && lastSeenAt < marketUpdatedAt) {
            skipped.withdrawn += 1;
            continue;
          }

          const playerName = text(outcome?.description || outcome?.player_name);
          if (invalidPlayerLabel(playerName)) { skipped.noPlayer += 1; continue; }

          const side = sideFromOutcome(outcome);
          if (!side) { skipped.noSide += 1; continue; }

          const line = numberOrNull(outcome?.point);
          if (line === null) { skipped.noLine += 1; continue; }

          const player = normalizedPlayer({
            provider,
            // PropLine's league-permanent id is the whole reason to prefer this
            // over name matching, so it is carried through verbatim.
            providerPlayerId: text(outcome?.player_id),
            sport: resolvedSport,
            name: playerName,
            ingestedAt,
          });
          if (!players.has(player.id)) players.set(player.id, player);

          const alternate = isAlternateOutcome(outcome);
          const special = specialFromOddsType(outcome?.dfs_odds_type);
          const period = text(market?.period || 'game');
          // The Odds API separates alternates with a market-key suffix, so its
          // prop ids differ naturally. PropLine puts Goblin/Demon on the same
          // market key and flags them in a field, so without this the special
          // and the standard prop hash to the same id - the first one seen wins
          // and the alternate silently merges into the real line.
          const variant = special || (alternate ? 'alt' : '');
          const prop = normalizedProp({
            id: variant ? stableId(['prop', resolvedSport, event.id, player.id, marketKey, period, variant]) : '',
            sport: resolvedSport,
            league: resolvedSport,
            eventId: event.id,
            playerId: player.id,
            playerName,
            marketKey,
            marketName: text(market?.title || market?.name || marketKey),
            period,
            isAlternate: alternate,
            provider,
            ingestedAt,
          });
          if (!props.has(prop.id)) props.set(prop.id, prop);

          const price = numberOrNull(outcome?.price);
          const row = normalizedBookmakerLine({
            propId: prop.id,
            provider,
            bookmakerKey: book,
            bookmakerName: bookName,
            side,
            line,
            price,
            impliedProbability: impliedProbability(price),
            deeplink: outcome?.link || bookmaker?.link || null,
            providerUpdatedAt: outcome?.last_change_at || bookmaker?.last_update || null,
            ingestedAt,
          });
          // Carried alongside the contract fields rather than inside it, so the
          // normalized line shape stays exactly what every other provider emits.
          if (special) row.specialType = special;
          if (text(outcome?.outcome_id)) row.providerOutcomeId = text(outcome.outcome_id);
          if (pregameOnly) row.pregameOnly = true;
          if (text(outcome?.last_seen_at)) row.lastSeenAt = text(outcome.last_seen_at);
          lines.push(row);
        } catch {
          skipped.unreadable += 1;
        }
      }
    }
  }

  return { events: [event], players: [...players.values()], props: [...props.values()], lines, skipped };
}

/** Merge several normalized events into one board payload. */
export function mergeNormalized(parts = []) {
  const events = new Map(); const players = new Map(); const props = new Map(); const lines = new Map();
  const skipped = { noSport: 0, noSide: 0, noLine: 0, noPlayer: 0, unreadable: 0, suspended: 0, withdrawn: 0 };
  for (const part of list(parts)) {
    for (const row of list(part?.events)) events.set(row.id, row);
    for (const row of list(part?.players)) players.set(row.id, row);
    for (const row of list(part?.props)) props.set(row.id, row);
    for (const row of list(part?.lines)) lines.set(row.id, row);
    for (const key of Object.keys(skipped)) skipped[key] += Number(part?.skipped?.[key] || 0);
  }
  return { events: [...events.values()], players: [...players.values()], props: [...props.values()], lines: [...lines.values()], skipped };
}
