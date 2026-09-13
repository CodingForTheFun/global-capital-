import {readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {ML_ENGINE,ML_SPORTS,ML_SOURCE_COMMIT,targetKey,predictionTarget,timestamp,unavailable,validatedModel,validatePrediction} from './contract.mjs';

/** Read-only, bounded local model output. Never trains, fetches odds, or calls an LLM. */
export function createMLStore({file = path.resolve(process.env.DATA_DIR || './data','ml/predictions.json'), clock = Date.now, pollMs = 5000} = {}) {
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
          if (rows.has(key)) {badTargets.add(key);continue;} // conflicting exports must be resolved by the publisher
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
  async function lookup(input) {
    const t = predictionTarget(input);
    if (!t) return unavailable('TARGET_UNVERIFIED');
    if (!ML_SPORTS.includes(t.sport)) return unavailable('SPORT_NOT_SUPPORTED');
    if (t.entityType !== 'player' || t.isAlternate) return unavailable('MARKET_NOT_SUPPORTED');
    if (t.live || timestamp(t.gameStartTime) <= clock()) return unavailable('PREMATCH_ONLY');
    const snapshot = await load();
    if (snapshot.error) return unavailable(snapshot.error);
    const models = [...snapshot.models.values()].filter(m=>m.sport === t.sport && m.marketId === t.marketId);
    if (!models.length) return unavailable('MARKET_NOT_SUPPORTED');
    if (!models.some(validatedModel)) return unavailable('MODEL_WITHHELD');
    const row = snapshot.rows.get(targetKey(t));
    if (!row) return unavailable('NO_EXACT_PREDICTION');
    if (timestamp(row.expiresAt) <= clock()) return unavailable('PREDICTION_EXPIRED');
    const model = snapshot.models.get(row.modelId);
    return {...row,available:true,modelled:true,engine:ML_ENGINE,code:'READY',modelVersion:model.version,
      validation:{observations:model.validation.observations,events:model.validation.events,
        brier:model.validation.brier,calibrationError:model.validation.calibrationError,end:model.validation.end},
      message:'Model estimate, not a measured statistic or guaranteed outcome.'};
  }
  return {lookup};
}
