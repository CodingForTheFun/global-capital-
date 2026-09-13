import {readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {ML_ENGINE,ML_SPORTS,ML_SOURCE_COMMIT,targetKey,predictionTarget,timestamp,unavailable,validatedModel,validatePrediction} from './contract.mjs';
import {createResearchProjectionStore} from './research-projection.mjs';

/** Read-only, bounded model output. Strict Sportstradamus output remains preferred; a separately
 * labelled Auto Scout research model may fill only the NFL markets it actually trained/validated. */
export function createMLStore({file = path.resolve(process.env.DATA_DIR || './data','ml/predictions.json'), clock = Date.now, pollMs = 5000,
  researchStore = createResearchProjectionStore({clock})} = {}) {
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
  async function strictLookup(t) {
    if (!ML_SPORTS.includes(t.sport)) return null;
    const snapshot = await load();
    if (snapshot.error) return null;
    const models = [...snapshot.models.values()].filter(m=>m.sport === t.sport && m.marketId === t.marketId);
    if (!models.length || !models.some(validatedModel)) return null;
    const row = snapshot.rows.get(targetKey(t));
    if (!row || timestamp(row.expiresAt) <= clock()) return null;
    const model = snapshot.models.get(row.modelId);
    return {...row,available:true,modelled:true,engine:ML_ENGINE,code:'READY',modelVersion:model.version,
      validation:{observations:model.validation.observations,events:model.validation.events,
        brier:model.validation.brier,calibrationError:model.validation.calibrationError,end:model.validation.end},
      message:'Model estimate, not a measured statistic or guaranteed outcome.'};
  }
  async function lookup(input) {
    const t = predictionTarget(input);
    if (!t) return unavailable('TARGET_UNVERIFIED');
    if (t.entityType !== 'player' || t.isAlternate) return unavailable('MARKET_NOT_SUPPORTED');
    if (t.live || timestamp(t.gameStartTime) <= clock()) return unavailable('PREMATCH_ONLY');
    const strict = await strictLookup(t);
    if (strict) return strict;
    const research = await researchStore.lookup(input);
    if (research?.available) return research;
    if (research?.code && !['SPORT_NOT_SUPPORTED','MARKET_NOT_SUPPORTED'].includes(research.code)) return research;
    if (!ML_SPORTS.includes(t.sport)) return unavailable('SPORT_NOT_SUPPORTED');
    return research || unavailable('MODEL_NOT_READY');
  }
  return {lookup};
}
