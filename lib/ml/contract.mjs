/** Model forecasts are a separate data product from observed game-log statistics. */
export const ML_ENGINE = 'Sportstradamus';
export const ML_SOURCE_COMMIT = 'a7c401297266142563b75104f4ea00d480fde3fb';
export const ML_SPORTS = Object.freeze(['NFL', 'NBA', 'WNBA', 'MLB', 'NHL']);
export const MAX_FORECAST_AGE_MS = 30 * 60_000;
export const finite = value => typeof value === 'number' && Number.isFinite(value);
const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000-\u001f]/.test(v);
export const timestamp = value => typeof value === 'string' && /(Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;

export function predictionTarget(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const {sport, eventId, playerId, playerName, marketId, sportsbookKey, gameStartTime, line} = input;
  if (![sport,eventId,playerId,playerName,marketId,sportsbookKey].every(v => text(v,200)) ||
      !finite(line) || Math.abs(line) > 1e6 || !Number.isFinite(timestamp(gameStartTime))) return null;
  return {sport, eventId, playerId, playerName, marketId, sportsbookKey, gameStartTime:new Date(timestamp(gameStartTime)).toISOString(), line,
    entityType:input.entityType || 'player', live:input.live === true, isAlternate:input.isAlternate === true};
}

export function targetKey(input) {
  const t = predictionTarget(input);
  return t ? JSON.stringify([t.sport,t.eventId,t.playerId,t.playerName,t.marketId,t.sportsbookKey,t.gameStartTime,t.line,t.entityType,t.live,t.isAlternate]) : null;
}

export function unavailable(code) {
  const messages = {
    MODEL_NOT_READY:'No trained, validated model has been loaded for this market.',
    SPORT_NOT_SUPPORTED:'This engine does not currently provide a trained model for this sport.',
    MARKET_NOT_SUPPORTED:'No validated model is available for this prop type.',
    MODEL_WITHHELD:'The model has not passed the required validation checks.',
    NO_EXACT_PREDICTION:'No model result matches this player, game, sportsbook and line.',
    PREDICTION_EXPIRED:'This forecast is out of date. A fresh model result is required.',
    PREMATCH_ONLY:'Pre-game model estimates are not used for a game already in progress.',
    TARGET_UNVERIFIED:'The exact player, game, or prop identity could not be verified.',
    MODEL_FEED_UNAVAILABLE:'The prediction feed is unavailable. Historical statistics are unchanged.',
    AUTH_REQUIRED:'Sign in to view model estimates.',
  };
  return {available:false,modelled:true,engine:ML_ENGINE,code,message:messages[code] || messages.MODEL_FEED_UNAVAILABLE};
}

/** A deployment gate, not a promise of future accuracy or profitability. */
export function validatedModel(m) {
  const v = m?.validation;
  if (!text(m?.id,160) || !text(m?.version,160) || m.version === 'book_fallback' ||
      !ML_SPORTS.includes(m.sport) || !text(m.marketId,120) ||
      !/^[a-f0-9]{64}$/.test(m.artifactSha256 || '') || m.sourceCommit !== ML_SOURCE_COMMIT ||
      v?.method !== 'chronological-heldout-real-lines' || v.passed !== true ||
      !/^[a-f0-9]{64}$/.test(v.dataSha256 || '') || !Number.isInteger(v.observations) || v.observations < 300 ||
      !Number.isInteger(v.events) || v.events < 50 || v.events > v.observations ||
      ![v.brier,v.bookBrier,v.calibrationError,v.brierDeltaUpper95].every(finite) ||
      v.brier < 0 || v.brier >= .25 || v.bookBrier < 0 || v.bookBrier > 1 || v.brier > v.bookBrier ||
      v.calibrationError < 0 || v.calibrationError > .075 || v.brierDeltaUpper95 >= .005) return false;
  const dates = [m.trainedThrough,v.start,v.end].map(timestamp);
  return dates.every(Number.isFinite) && dates[0] < dates[1] && dates[1] <= dates[2];
}

export function validProbabilities(row) {
  const p = [row?.probabilityOver,row?.probabilityUnder,row?.probabilityPush];
  return p.every(v => finite(v) && v >= 0 && v <= 1) && Math.abs(p.reduce((a,b)=>a+b,0)-1) < 1e-6;
}

export function validatePrediction(row, model, now = Date.now()) {
  const t = predictionTarget(row);
  if (!t || !validatedModel(model) || row.modelId !== model.id || model.sport !== t.sport || model.marketId !== t.marketId ||
      t.entityType !== 'player' || t.live || t.isAlternate || row.sourceKind !== 'trained-model-output' ||
      !/^[a-f0-9]{64}$/.test(row.sourceRecordSha256 || '') || !finite(row.projection) || !validProbabilities(row)) return null;
  const generated = timestamp(row.generatedAt), expires = timestamp(row.expiresAt), cutoff = timestamp(row.featureCutoff);
  if (![generated,expires,cutoff].every(Number.isFinite) || generated > now + 30_000 || cutoff > generated ||
      timestamp(model.validation.end) >= generated || expires <= generated || expires > generated + MAX_FORECAST_AGE_MS ||
      generated >= timestamp(t.gameStartTime) || cutoff >= timestamp(t.gameStartTime)) return null;
  return {...t,modelId:row.modelId,projection:row.projection,probabilityOver:row.probabilityOver,
    probabilityUnder:row.probabilityUnder,probabilityPush:row.probabilityPush,generatedAt:row.generatedAt,expiresAt:row.expiresAt};
}
