import {readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {ML_ENGINE,ML_SPORTS,ML_SOURCE_COMMIT,targetKey,predictionTarget,timestamp,unavailable,validatedModel,validatePrediction} from './contract.mjs';
import {adaptivePrediction,ADAPTIVE_SPORTS} from './adaptive.mjs';

/**
 * Read-only model store. The original Sportstradamus snapshot semantics remain
 * exact unless a verified research resolver is explicitly injected. Production
 * injects that resolver in routes.mjs; low-level tests and offline callers do not.
 */
export function createMLStore({file = path.resolve(process.env.DATA_DIR || './data','ml/predictions.json'), clock = Date.now, pollMs = 5000,
  research = null, global = null, adaptiveBudgetMs = 1500} = {}) {
  let cached = null, checked = -Infinity, inflight = null;
  async function load() {
    if (clock()-checked < pollMs) return cached;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const stat = await lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8_000_000) throw Error('size');
        const raw = await readFile(file,'utf8');
        if (Buffer.byteLength(raw) > 8_000_000) throw Error('size');
        const p = JSON.parse(raw);
        if (p.version !== 1 || p.engine !== ML_ENGINE || p.sourceCommit !== ML_SOURCE_COMMIT ||
            !Array.isArray(p.models) || p.models.length > 500 || !Array.isArray(p.predictions) || p.predictions.length > 12000) throw Error('schema');
        const models = new Map(), duplicates = new Set(), rows = new Map();
        for (const m of p.models) {if (models.has(m.id)) duplicates.add(m.id);else models.set(m.id,m);}
        for (const id of duplicates) models.delete(id);
        const badTargets = new Set();
        for (const row of p.predictions) {
          const value = validatePrediction(row,models.get(row.modelId),clock());
          if (!value) continue;
          const key = targetKey(value);
          if (rows.has(key)) {badTargets.add(key);continue;}
          rows.set(key,value);
        }
        for (const key of badTargets) rows.delete(key);
        cached = {models,rows};
      } catch (e) {cached = {error:e.code === 'ENOENT' ? 'MODEL_NOT_READY' : 'MODEL_FEED_UNAVAILABLE'};}
      finally {checked = clock();}
      return cached;
    })().finally(()=>{inflight=null;});
    return inflight;
  }

  async function adaptive(t) {
    if (typeof research !== 'function' || !ADAPTIVE_SPORTS.includes(t.sport)) return null;
    try {
      // Start with the normal verified-history path so a warm/current-season
      // archive remains cheap. When that sample is too short to train, retry
      // through the existing deep-history hierarchy. That path can extend the
      // exact stat with prior seasons and verified fallbacks (ESPN/public
      // archives, research-only providers, then quota-aware SportsGameOdds)
      // without inventing rows or widening background polling.
      const base = {
        // A board row without a provider player id sends name:<player>; that is
        // not a provider id, so research resolves the player by name instead.
        sport:t.sport,playerName:t.playerName,providerPlayerId:t.playerId.startsWith('name:')?undefined:t.playerId,
        market:t.marketId,providerMarketKey:t.marketId,line:t.line,side:'OVER',
        games:30,eventId:t.eventId,gameStartTime:t.gameStartTime,
      };
      let history = await research(base);
      const usableRows = value => Array.isArray(value?.gameLog)
        ? value.gameLog.filter(row => Number.isFinite(Number(row?.value)) && Number.isFinite(Date.parse(row?.date || ''))).length
        : 0;
      if (!history?.available || usableRows(history) < 9) {
        history = await research({...base,historyYears:3});
      }
      return adaptivePrediction({research:history,target:t,now:clock()});
    } catch {
      return {available:false,modelled:true,engine:'Auto Scout Adaptive',code:'MODEL_FEED_UNAVAILABLE',
        message:'Verified history could not be loaded for the adaptive model. Historical research remains unchanged.'};
    }
  }

  async function lookup(input) {
    const t = predictionTarget(input);
    if (!t) return unavailable('TARGET_UNVERIFIED');
    if (t.entityType !== 'player' || t.isAlternate) return unavailable('MARKET_NOT_SUPPORTED');
    if (t.live || timestamp(t.gameStartTime) <= clock()) return unavailable('PREMATCH_ONLY');

    let original = unavailable(ML_SPORTS.includes(t.sport)?'MODEL_NOT_READY':'SPORT_NOT_SUPPORTED');
    if (ML_SPORTS.includes(t.sport)) {
      const snapshot = await load();
      if (snapshot.error) original = unavailable(snapshot.error);
      else {
        const models = [...snapshot.models.values()].filter(m=>m.sport === t.sport && m.marketId === t.marketId);
        if (!models.length) original = unavailable('MARKET_NOT_SUPPORTED');
        else if (!models.some(validatedModel)) original = unavailable('MODEL_WITHHELD');
        else {
          const row = snapshot.rows.get(targetKey(t));
          if (!row) original = unavailable('NO_EXACT_PREDICTION');
          else if (timestamp(row.expiresAt) <= clock()) original = unavailable('PREDICTION_EXPIRED');
          else {
            const model = snapshot.models.get(row.modelId);
            return {...row,available:true,modelled:true,engine:ML_ENGINE,code:'READY',modelVersion:model.version,
              validation:{method:model.validation.method,observations:model.validation.observations,events:model.validation.events,
                brier:model.validation.brier,calibrationError:model.validation.calibrationError,end:model.validation.end},
              message:'Validated trained-model estimate, not a measured statistic or guaranteed outcome.'};
          }
        }
      }
    }

    // Explicit injection is the activation switch. This preserves all old store
    // return codes for callers that do not opt into the adaptive research model.
    // The global model (or, failing that, the market's own no-vig probability)
    // supplies probabilities; the adaptive model supplies projections. A cold
    // player history can take seconds to load, so when the global answer is
    // ready the projection waits only a short budget; the history keeps
    // loading in the background and is cached for the next request.
    const adaptiveTask = adaptive(t);
    if (global) {
      let quick = null;
      try { quick = await global.predict(t, null); } catch { /* fall through */ }
      if (quick) {
        let timer;
        const learned = await Promise.race([
          adaptiveTask,
          new Promise(resolve => { timer = setTimeout(() => resolve(null), adaptiveBudgetMs); timer.unref?.(); }),
        ]).finally(() => clearTimeout(timer));
        if (learned?.available === true && Number.isFinite(learned.projection)) {
          try { return (await global.predict(t, learned)) || quick; } catch { return quick; }
        }
        return quick;
      }
    }
    const learned = await adaptiveTask;
    return learned || original;
  }
  return {lookup};
}
