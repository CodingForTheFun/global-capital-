import {readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {ML_ENGINE,ML_SPORTS,ML_SOURCE_COMMIT,targetKey,predictionTarget,timestamp,unavailable,validatedModel,validatePrediction} from './contract.mjs';
import {adaptivePrediction,ADAPTIVE_SPORTS} from './adaptive.mjs';
import {researchPlayerProp} from '../autoscout/research-service-v2.mjs';

/**
 * Lookup order:
 * 1) exact, fresh, fully validated Sportstradamus export when one exists;
 * 2) Auto Scout Adaptive trained from verified completed player game logs.
 *
 * The adaptive fallback never invents observations or relaxes the stricter
 * Sportstradamus release gate. Missing/ambiguous history still fails closed.
 */
export function createMLStore({file = path.resolve(process.env.DATA_DIR || './data','ml/predictions.json'), clock = Date.now, pollMs = 5000,
  research = researchPlayerProp} = {}) {
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
    if (!ADAPTIVE_SPORTS.includes(t.sport)) return null;
    try {
      const history = await research({sport:t.sport,playerName:t.playerName,providerPlayerId:t.playerId,
        market:t.marketId,providerMarketKey:t.marketId,line:t.line,side:'OVER',games:30});
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

    // A validated exact export always wins. A missing snapshot or missing exact
    // result is not grounds to fabricate one, so only then try the history model.
    if (ML_SPORTS.includes(t.sport)) {
      const snapshot = await load();
      if (!snapshot.error) {
        const models = [...snapshot.models.values()].filter(m=>m.sport === t.sport && m.marketId === t.marketId);
        const row = snapshot.rows.get(targetKey(t));
        if (row) {
          const model = snapshot.models.get(row.modelId);
          if (model && validatedModel(model) && timestamp(row.expiresAt) > clock()) return {...row,available:true,modelled:true,engine:ML_ENGINE,code:'READY',modelVersion:model.version,
            validation:{method:model.validation.method,observations:model.validation.observations,events:model.validation.events,
              brier:model.validation.brier,calibrationError:model.validation.calibrationError,end:model.validation.end},
            message:'Validated trained-model estimate, not a measured statistic or guaranteed outcome.'};
        }
      }
    }

    const learned = await adaptive(t);
    if (learned) return learned;
    return unavailable(ML_SPORTS.includes(t.sport)?'NO_EXACT_PREDICTION':'SPORT_NOT_SUPPORTED');
  }
  return {lookup};
}
