// The projection accuracy ledger.
//
// Every competitor in this space claims accuracy. Almost none of them show a
// graded record, because keeping one means the number can come back bad. That
// is exactly why it is worth keeping: a measured record is the only honest
// answer to "how accurate is this?", and it is the one thing here that cannot
// be copied by writing better marketing.
//
// Each projection is written down when it is made, with the line and the side
// it implied. Later, when the player's game log is fetched for any reason, the
// real result for that game is matched back and the entry is graded. Nothing
// is ever graded from an estimate — only from a game log the app actually
// fetched, the same source the cards are built from.
//
// Three measures, because they answer different questions:
//   • hit rate — of the picks it called, how many landed. What a bettor asks.
//   • Brier score — how well-calibrated the probabilities are, where lower is
//     better and 0.25 is what you get by saying 50% to everything. A model can
//     have a good hit rate and terrible calibration; this catches that.
//   • mean absolute error — how far the projected number was from the real one,
//     in the units of the market. Says whether the projection itself is any
//     good, separately from whether the side was right.

import fs from 'node:fs/promises';
import path from 'node:path';

const DATA = path.resolve(process.env.DATA_DIR || './data');
const FILE = path.join(DATA, 'projection-ledger.json');

// Enough to measure a season without letting the file grow without bound.
export const MAX_ENTRIES = 5000;
// A projection is matched to the first logged game on or after it, inside this
// window. Beyond that the projection was for a game that never got logged, and
// pairing it with a later one would grade the wrong night.
export const MATCH_WINDOW_DAYS = 8;
// Below this, a rate is noise. The report says so rather than printing it.
export const MIN_GRADED_FOR_RATE = 20;

let cache = null;
let writeQueue = Promise.resolve();

const text = (value, max = 120) => String(value ?? '').trim().slice(0, max);
const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** A stable identity for "this player, this market, this sport". */
export function subjectKey({ sport, playerName, market } = {}) {
  return [text(sport, 12), text(playerName, 90), text(market, 100)]
    .map((part) => part.toLowerCase())
    .join('|');
}

async function readAll() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(await fs.readFile(FILE, 'utf8'));
    cache = Array.isArray(parsed?.entries) ? parsed.entries : [];
  } catch {
    cache = [];
  }
  return cache;
}

/** Serialised so two concurrent grades cannot clobber each other. */
function write(mutate) {
  writeQueue = writeQueue.then(async () => {
    const entries = await readAll();
    const next = mutate(entries.slice());
    if (!next) return;
    const trimmed = next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
    cache = trimmed;
    await fs.mkdir(DATA, { recursive: true });
    const temp = `${FILE}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify({ version: 1, entries: trimmed }, null, 0), 'utf8');
    await fs.rename(temp, FILE);
  }).catch((error) => {
    // The ledger is a measurement, not a dependency. A failure to write one
    // must never take down the projection the customer asked for.
    console.error('[projections] ledger write failed', String(error?.message || 'unknown').slice(0, 120));
  });
  return writeQueue;
}

/**
 * Record one projection at the moment it is made.
 *
 * Only a projection that actually took a side is worth grading — a PASS makes
 * no claim, so scoring it would flatter the record.
 */
export async function recordProjection(result = {}, input = {}) {
  const line = num(result.line);
  const projection = num(result.projection);
  const probabilityOver = num(result.probabilityOver);
  if (line === null || projection === null || probabilityOver === null) return null;

  const entry = {
    key: subjectKey({ sport: input.sport, playerName: input.playerName, market: input.market }),
    sport: text(input.sport, 12),
    player: text(input.playerName, 90),
    market: text(input.market, 100),
    line,
    projection,
    probabilityOver,
    confidence: num(result.confidence),
    pick: text(result.pick, 20) || 'PASS',
    side: result.side === 'OVER' || result.side === 'UNDER' ? result.side : null,
    ev: num(result.ev),
    calibrated: result.calibration?.applied === true,
    madeAt: new Date().toISOString(),
    actual: null,
    gradedAt: null,
    gameDate: null,
  };
  await write((entries) => {
    // One live projection per subject and line. Re-asking the same question
    // before the game is played replaces the entry rather than stuffing the
    // ledger with duplicates of the same claim.
    const filtered = entries.filter((row) => !(row.actual === null && row.key === entry.key && row.line === entry.line));
    filtered.push(entry);
    return filtered;
  });
  return entry;
}

function dayDifference(fromIso, toIso) {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return (to - from) / 86_400_000;
}

/**
 * Grade every open entry for this player and market against a real game log.
 *
 * Called opportunistically whenever a log is fetched, so the ledger keeps
 * itself current with no scheduler and no extra provider calls.
 */
export async function gradeFromGameLog({ sport, playerName, market, gameLog = [] } = {}) {
  const key = subjectKey({ sport, playerName, market });
  const games = (Array.isArray(gameLog) ? gameLog : [])
    .map((row) => ({ date: text(row?.date, 32), value: num(row?.value) }))
    .filter((row) => row.date && row.value !== null);
  if (!games.length) return 0;

  let graded = 0;
  await write((entries) => {
    let changed = false;
    const next = entries.map((row) => {
      if (row.key !== key || row.actual !== null) return row;
      // The first logged game on or after the projection, inside the window.
      const match = games
        .map((game) => ({ ...game, offset: dayDifference(row.madeAt, game.date) }))
        .filter((game) => game.offset !== null && game.offset >= -1 && game.offset <= MATCH_WINDOW_DAYS)
        .sort((a, b) => a.offset - b.offset)[0];
      if (!match) return row;
      changed = true;
      graded += 1;
      return { ...row, actual: match.value, gameDate: match.date, gradedAt: new Date().toISOString() };
    });
    return changed ? next : null;
  });
  return graded;
}

/**
 * The measured record.
 *
 * Reports `sufficient: false` rather than a rate when too few picks have been
 * graded. A hit rate over three picks is not a hit rate, and publishing one
 * would be the exact dishonesty this ledger exists to avoid.
 */
export async function accuracyReport({ sport = null, minGraded = MIN_GRADED_FOR_RATE } = {}) {
  const entries = await readAll();
  const scope = sport ? entries.filter((row) => row.sport === text(sport, 12)) : entries;
  const graded = scope.filter((row) => row.actual !== null);
  // Pushes make no claim about a side and cannot be won or lost.
  const decided = graded.filter((row) => row.side && row.actual !== row.line);
  const called = decided.filter((row) => row.pick && row.pick !== 'PASS');

  const wins = called.filter((row) => (row.actual > row.line ? 'OVER' : 'UNDER') === row.side).length;
  const brierSample = graded.filter((row) => row.actual !== row.line);
  const brier = brierSample.length
    ? brierSample.reduce((sum, row) => sum + (row.probabilityOver - (row.actual > row.line ? 1 : 0)) ** 2, 0) / brierSample.length
    : null;
  const errors = graded.map((row) => Math.abs(row.projection - row.actual));
  const mae = errors.length ? errors.reduce((sum, value) => sum + value, 0) / errors.length : null;

  return {
    sport: sport ? text(sport, 12) : 'ALL',
    recorded: scope.length,
    graded: graded.length,
    awaitingResult: scope.length - graded.length,
    calledPicks: called.length,
    sufficient: called.length >= minGraded,
    minimumForRate: minGraded,
    // Null until there is enough to mean something. The caller renders the
    // count and an explanation instead of a number nobody should act on.
    hitRate: called.length >= minGraded ? Number(((wins / called.length) * 100).toFixed(1)) : null,
    wins: called.length >= minGraded ? wins : null,
    // Lower is better; 0.25 is what "50% on everything" scores.
    brierScore: brierSample.length >= minGraded ? Number(brier.toFixed(4)) : null,
    meanAbsoluteError: errors.length >= minGraded ? Number(mae.toFixed(2)) : null,
    updatedAt: new Date().toISOString(),
  };
}

/** Test seam. */
export function resetLedgerCache() {
  cache = null;
  writeQueue = Promise.resolve();
}
