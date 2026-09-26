// Serves the promoted global model, or the market's own no-vig probability
// when no model has earned a place for that kind of prop.
//
// Source labels are part of the contract: 'global-model' is a trained,
// held-out-validated estimate; 'market-consensus' is the sportsbooks' no-vig
// probability passed through unchanged. Neither is presented as the other.
import { featureVector, predictWith, createContextIndex, MIN_HISTORY } from './model.mjs';
import { nameKey } from './observations.mjs';
import { readArtifact, readObservations, globalModelDir } from './store.mjs';
import { SPORT_KEYS } from '../../data-sources/propline/markets.mjs';

const finite = v => typeof v === 'number' && Number.isFinite(v);
const RELOAD_MS = 10 * 60_000;
const HISTORY_KEEP = 30;
const HISTORY_GAP_MS = 3 * 3600_000;

export const GLOBAL_ENGINE = 'Oblige Global Model';

export function createGlobalPredictor({ dir = globalModelDir(), clock = Date.now } = {}) {
  const sports = new Map();

  async function load(sport) {
    const cached = sports.get(sport);
    if (cached && clock() - cached.at < RELOAD_MS) return cached;
    if (cached?.loading) return cached.loading;
    const loading = (async () => {
      const artifact = await readArtifact(sport, dir).catch(() => null);
      let history = cached?.history || new Map();
      let context = cached?.context || createContextIndex();
      // Rebuild the history and context indexes only when a new model (and so new data) landed.
      if (artifact && artifact.trainedAt !== cached?.artifact?.trainedAt) {
        history = new Map();
        context = createContextIndex();
        const floor = clock() - 400 * 86_400_000;
        const observations = (await readObservations(sport, dir).catch(() => [])).sort((a, b) => a.t - b.t);
        for (const o of observations) {
          if (o.t < floor) continue;
          // Every stored game is resolved, so it began before any prop served now.
          context.release(o);
          const key = `${nameKey(o.p)}|${o.m}`;
          const list = history.get(key) || [];
          list.push([o.t, o.a]);
          if (list.length > HISTORY_KEEP) list.shift();
          history.set(key, list);
        }
      }
      const entry = { at: clock(), artifact, history, context, loading: null };
      sports.set(sport, entry);
      return entry;
    })();
    sports.set(sport, { ...(cached || {}), at: cached?.at ?? -Infinity, loading });
    return loading;
  }

  /**
   * target: validated prediction target plus optional marketOverProbability.
   * base: the adaptive result (for its projection), or null.
   * Returns a prediction or null when nothing applies.
   */
  async function predict(target, base = null) {
    const sport = String(target?.sport || '').toUpperCase();
    const line = target?.line;
    if (!SPORT_KEYS[sport] || !finite(line)) return null;
    const marketP = finite(target.marketOverProbability) && target.marketOverProbability > 0.01 && target.marketOverProbability < 0.99
      ? target.marketOverProbability : null;
    const { artifact, history, context } = await load(sport);
    const start = Date.parse(target.gameStartTime || '') || clock();
    const past = (history.get(`${nameKey(target.playerName)}|${String(target.marketId || '').toLowerCase()}`) || [])
      .filter(([t]) => t <= start - HISTORY_GAP_MS).map(([, a]) => a);

    const regime = marketP !== null ? 'withMarket' : 'withoutMarket';
    const projection = base?.available === true && finite(base.projection) ? base.projection : null;
    const integerLine = Number.isInteger(line);
    const pushFor = () => {
      if (!integerLine) return 0;
      if (past.length >= 10) return (past.filter(v => v === line).length + 1) / (past.length + 2);
      return artifact?.pushRates?.[String(target.marketId || '').toLowerCase()] ?? null;
    };

    // With no two-sided market, the model's only information is the player's
    // own history; without enough of it the answer is a constant, not an
    // estimate about this player, so it is not offered as one.
    const informative = regime === 'withMarket' || past.length >= MIN_HISTORY;
    if (artifact?.regimes?.[regime] && informative) {
      const ctx = context?.describe({ playerName: target.playerName, homeTeam: target.homeTeam, awayTeam: target.awayTeam, market: target.marketId, t: start, e: target.eventId }) || null;
      const over = predictWith(artifact.weights, featureVector({ history: past, line, marketP, context: ctx }));
      const push = pushFor();
      if (push !== null) {
        const m = artifact.metrics || {};
        return {
          ...target, available: true, modelled: true, engine: GLOBAL_ENGINE, code: 'READY',
          modelVersion: `${artifact.version}:${sport}:${artifact.trainedAt}`,
          sourceKind: 'global-model', inputs: { market: marketP !== null, historyGames: past.length, context: Boolean(ctx?.team) && artifact.weights.length > 8 },
          projection, probabilityOver: over * (1 - push), probabilityUnder: (1 - over) * (1 - push), probabilityPush: push,
          generatedAt: new Date(clock()).toISOString(),
          validation: {
            method: 'chronological-holdout-resolved-props', observations: m.holdoutRows, events: m.holdoutEvents,
            brier: m[regime]?.model?.brier ?? null,
            baselineBrier: regime === 'withMarket' ? m.withMarket?.market?.brier ?? null : m.withoutMarket?.hitRate?.brier ?? null,
            calibrationError: m.all?.calibrationError ?? null, end: m.holdoutEnd ?? null, trainedAt: artifact.trainedAt,
          },
          message: 'Global model estimate for this sport, trained on resolved props and checked on later games it never saw. Not a guarantee.',
        };
      }
    }

    if (marketP !== null) {
      // Books refund pushes, so the no-vig split is over vs under excluding push.
      const push = pushFor() ?? 0;
      return {
        ...target, available: true, modelled: false, engine: 'Market consensus', code: 'READY',
        modelVersion: 'market-no-vig', sourceKind: 'market-consensus', inputs: { market: true, historyGames: past.length },
        projection, probabilityOver: marketP * (1 - push), probabilityUnder: (1 - marketP) * (1 - push), probabilityPush: push,
        generatedAt: new Date(clock()).toISOString(),
        message: 'Sportsbook consensus: the no-vig probability from books quoting both sides of this exact line. Not a model estimate.',
      };
    }
    return null;
  }

  async function status() {
    const out = {};
    for (const sport of Object.keys(SPORT_KEYS)) {
      const a = await readArtifact(sport, dir).catch(() => null);
      out[sport] = a ? { trainedAt: a.trainedAt, dataThrough: a.dataThrough, observations: a.observations, regimes: a.regimes,
        holdoutRows: a.metrics?.holdoutRows, brier: a.metrics?.all?.brier, calibrationError: a.metrics?.all?.calibrationError,
        marketBrier: a.metrics?.withMarket?.market?.brier, modelBrierWithMarket: a.metrics?.withMarket?.model?.brier } : null;
    }
    return out;
  }

  return { predict, status };
}
