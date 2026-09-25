/**
 * Verified-history projection candidate. This is NOT a calibrated probability
 * model. The shared API withholds adaptive probabilities until a separate,
 * real-line, chronological calibration/promotion path has passed validation.
 * Existing validated snapshot models remain the production probability path.
 */
const ENGINE = 'Auto Scout Adaptive';
export const ADAPTIVE_VERSION = 'adaptive-ridge-v3-shadow';
export const ADAPTIVE_SPORTS = Object.freeze(['NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB','SOCCER','MLS','EPL','UCL','TENNIS']);
const MAX_HISTORY = 120;
const MIN_HISTORY = 9;
const finite = v => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
const rmse = a => a.length ? Math.sqrt(mean(a.map(v => v * v))) : null;
const label = v => typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : null;
const identity = v => (typeof v === 'string' && v.trim()) || (typeof v === 'number' && Number.isFinite(v)) ? String(v).trim() : null;
const time = v => typeof v === 'string' && v.trim() ? Date.parse(v) : NaN;
const valuesOf = rows => rows.map(r => r.value);
function number(v) {
  // Number(null), Number('') and Number(false) are zero, not verified results.
  if (finite(v)) return v;
  if (typeof v !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(v.trim())) return null;
  const n = Number(v); return Number.isFinite(n) ? n : null;
}
function sd(a) { const m = mean(a); return a.length < 2 ? 0 : Math.sqrt(mean(a.map(v => (v - m) ** 2))); }
function slope(a) {
  const n = a.length; if (n < 2) return 0;
  const mx = (n - 1) / 2, my = mean(a); let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - mx) * (a[i] - my); den += (i - mx) ** 2; }
  return den ? num / den : 0;
}
function context(r = {}) {
  r = r && typeof r === 'object' ? r : {};
  return {opponent: label(r.opponent), opponentId: identity(r.opponentId),
    isHome: typeof r.isHome === 'boolean' ? r.isHome : null, season: identity(r.season)};
}
function sameOpponent(a, b) {
  if (a.opponentId && b.opponentId) return a.opponentId === b.opponentId;
  return Boolean(a.opponent && b.opponent && a.opponent === b.opponent);
}

/** Input must originate in the existing verified research resolver, not clicks. */
export function cleanAdaptiveHistory(gameLog, target = {}, now = Date.now()) {
  const start = time(target.gameStartTime);
  const cutoff = Math.min(now, Number.isFinite(start) ? start : now);
  const targetId = identity(target.eventId);
  const groups = new Map();
  const input = Array.isArray(gameLog) ? gameLog : [];
  // The research resolver is bounded already; refuse an unexpectedly huge feed.
  if (input.length > 10000 || !finite(cutoff)) return [];
  for (const row of input) {
    if (!row || typeof row !== 'object') continue;
    const value = number(row.value), ts = time(row.date);
    if (value === null || !Number.isFinite(ts) || ts >= cutoff) continue;
    if (row.verified === false || row.completed === false || row.isFinal === false) continue;
    const status = label(row.status);
    if (status && !['FINAL','COMPLETED','COMPLETE','FINISHED','CLOSED','FT'].includes(status)) continue;
    const gameId = identity(row.gameId), eventId = identity(row.eventId);
    if (targetId && (gameId === targetId || eventId === targetId)) continue;
    let valid = true, availableTs = ts;
    for (const field of ['availableAt', 'completedAt']) {
      if (row[field] == null) continue;
      const stamp = time(row[field]);
      if (!Number.isFinite(stamp) || stamp >= cutoff || stamp < ts) valid = false;
      else availableTs = Math.max(availableTs, stamp);
    }
    if (!valid) continue;
    const ctx = context(row);
    // Date-only rows with no game identity cannot safely represent doubleheaders.
    const key = gameId || eventId || `date:${row.date}`;
    const clean = {value, ts, availableTs, date: row.date, gameId, eventId, ...ctx};
    const signature = JSON.stringify([ts, availableTs, value, ctx.opponent, ctx.opponentId, ctx.isHome, ctx.season]);
    const existing = groups.get(key);
    if (!existing) groups.set(key, {clean, signature, conflict: false});
    else if (existing.signature !== signature) existing.conflict = true;
  }
  return [...groups.values()].filter(g => !g.conflict).map(g => g.clean)
    .sort((a, b) => a.ts - b.ts || String(a.gameId || a.eventId || '').localeCompare(String(b.gameId || b.eventId || '')))
    .slice(-MAX_HISTORY);
}

export function adaptiveFeatures(history, targetContext = {}) {
  const ctx = context(targetContext), values = valuesOf(history);
  if (!values.length) return null;
  const l5 = mean(values.slice(-5)), l10 = mean(values.slice(-10)), l20 = mean(values.slice(-20));
  const h2h = history.filter(r => sameOpponent(context(r), ctx));
  const homeAway = ctx.isHome === null ? [] : history.filter(r => r.isHome === ctx.isHome);
  // Do not guess a cross-year league season from a calendar year.
  const season = ctx.season === null ? [] : history.filter(r => identity(r.season) === ctx.season);
  const shrink = rows => rows.length ? (mean(valuesOf(rows)) - l10) * rows.length / (rows.length + 8) : 0;
  return {base: l10,
    x: [1, values.at(-1) - l10, mean(values.slice(-3)) - l10, l5 - l10,
      l20 - l10, slope(values.slice(-5)), shrink(h2h), shrink(homeAway), shrink(season)],
    evidence: {l5: {games: Math.min(5, values.length), average: l5},
      l10: {games: Math.min(10, values.length), average: l10},
      l20: {games: Math.min(20, values.length), average: l20},
      h2h: {available: h2h.length > 0, games: h2h.length, opponent: ctx.opponent,
        opponentId: ctx.opponentId, average: mean(valuesOf(h2h)), shrinkage: h2h.length / (h2h.length + 8)},
      homeAway: {available: homeAway.length > 0, games: homeAway.length, isHome: ctx.isHome, average: mean(valuesOf(homeAway))},
      season: {available: season.length > 0, games: season.length, season: ctx.season, average: mean(valuesOf(season))}}};
}

function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    if (Math.abs(M[i][i]) < 1e-10) return null;
    for (let r = i + 1; r < n; r++) { const f = M[r][i] / M[i][i]; for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c]; }
  }
  const x = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let c = i + 1; c < n; c++) s -= M[i][c] * x[c]; x[i] = s / M[i][i]; }
  return x.every(finite) ? x : null;
}
function trainingRows(logs) {
  const rows = [];
  for (let i = 5; i < logs.length; i++) {
    const hist = logs.slice(0, i).filter(r => (r.availableTs ?? r.ts) < logs[i].ts);
    if (hist.length < 5) continue;
    const f = adaptiveFeatures(hist, logs[i]);
    rows.push({i, x: f.x, y: logs[i].value - f.base});
  }
  return rows;
}
function fit(rows) {
  if (rows.length < 4) return null;
  const k = rows[0].x.length;
  // Train-only scaling prevents stat-unit changes from changing regularization.
  const scales = Array.from({length: k}, (_, j) => j === 0 ? 1 : Math.max(1, sd(rows.map(r => r.x[j]))));
  const A = Array.from({length: k}, () => Array(k).fill(0)), b = Array(k).fill(0);
  const last = rows.at(-1).i;
  for (const row of rows) {
    const w = Math.pow(.5, (last - row.i) / 20), x = row.x.map((v, j) => v / scales[j]);
    for (let r = 0; r < k; r++) { b[r] += w * x[r] * row.y; for (let c = 0; c < k; c++) A[r][c] += w * x[r] * x[c]; }
  }
  for (let j = 1; j < k; j++) A[j][j] += 8;
  const coefficients = solve(A, b);
  return coefficients ? coefficients.map((v, j) => v / scales[j]) : null;
}
function forecast(history, ctx, earlierChecks) {
  const f = adaptiveFeatures(history, ctx), coefficients = fit(trainingRows(history));
  if (!f || !coefficients) return null;
  const raw = f.base + f.x.reduce((sum, v, j) => sum + v * coefficients[j], 0);
  const past = earlierChecks.slice(-20);
  const modelError = rmse(past.map(r => r.actual - r.raw)), baseError = rmse(past.map(r => r.actual - r.baseline));
  const gain = past.length >= 6 && baseError > 0 ? clamp(1 - modelError / baseError, 0, 1) : 0;
  const sampleFactor = clamp((history.length - 8) / 24, 0, 1);
  const projection = f.base + (raw - f.base) * gain * sampleFactor;
  if (!finite(projection)) return null;
  return {projection, raw, baseline: f.base, evidence: f.evidence,
    selectedStrategy: gain > 0 ? 'trained-adjustment' : 'recent-mean-fallback'};
}

/** Pure offline fit. Never persists a customer's request as a training label. */
export function fitAdaptiveHistory({research, target, now = Date.now()} = {}) {
  const logs = cleanAdaptiveHistory(research?.gameLog, target, now);
  if (logs.length < MIN_HISTORY) return null;
  const checks = [];
  for (let i = MIN_HISTORY; i < logs.length; i++) {
    const hist = logs.slice(0, i).filter(r => (r.availableTs ?? r.ts) < logs[i].ts);
    if (hist.length < MIN_HISTORY) continue;
    // Strategy selection, H2H, splits and scaling all use this fold's past only.
    const prior = checks.filter(r => (r.availableTs ?? r.ts) < logs[i].ts);
    const p = forecast(hist, logs[i], prior);
    if (p) checks.push({ts: logs[i].ts, availableTs: logs[i].availableTs, gameId: logs[i].gameId, actual: logs[i].value,
      pred: p.projection, raw: p.raw, baseline: p.baseline, residual: logs[i].value - p.projection});
  }
  const ctx = {...context(research), ...Object.fromEntries(Object.entries(context(research?.matchup)).filter(([, v]) => v !== null))};
  const out = forecast(logs, ctx, checks);
  if (!out) return null;
  const line = number(target?.line), values = valuesOf(logs);
  const hits = rows => { const vals = valuesOf(rows), pushes = vals.filter(v => v === line).length;
    const over = vals.filter(v => v > line).length, under = vals.filter(v => v < line).length;
    return {games: vals.length, over, under, pushes, decided: over + under,
      overRate: over + under ? over / (over + under) : null, underRate: over + under ? under / (over + under) : null}; };
  return {...out, sampleSize: values.length, featureCutoff: new Date(logs.at(-1).ts).toISOString(), checks,
    currentLineHistory: line === null ? null : {line, descriptiveOnly: true, l5: hits(logs.slice(-5)),
      l10: hits(logs.slice(-10)), l20: hits(logs.slice(-20)), all: hits(logs),
      h2h: hits(logs.filter(r => sameOpponent(context(r), ctx)))},
    validation: {method: 'rolling-player-history', observations: checks.length, events: checks.length,
      rmse: rmse(checks.map(r => r.actual - r.pred)), baselineRmse: rmse(checks.map(r => r.actual - r.baseline)),
      mae: checks.length ? mean(checks.map(r => Math.abs(r.actual - r.pred))) : null,
      selectedStrategy: out.selectedStrategy, evaluatesDisplayedAlgorithm: true,
      probabilityCalibrated: false, probabilityObservations: 0}};
}

export function adaptivePrediction({research, target, now = Date.now()} = {}) {
  const unavailable = (code, message) => ({available: false, modelled: true, engine: ENGINE, code, message});
  if (!ADAPTIVE_SPORTS.includes(String(target?.sport || '').toUpperCase())) return unavailable('SPORT_NOT_SUPPORTED', 'No adaptive history model is configured for this sport.');
  if (identity(research?.matchup?.eventId) && identity(target?.eventId) !== identity(research.matchup.eventId)) return unavailable('TARGET_UNVERIFIED', 'Matchup evidence does not match the current event.');
  if (!research?.available) return unavailable(research?.code || 'NO_GAME_LOG_DATA', research?.message || 'Verified game history is unavailable for this prop.');
  const start = time(target?.gameStartTime);
  if (!finite(now) || !Number.isFinite(start) || !finite(target?.line)) return unavailable('TARGET_UNVERIFIED', 'A verified current event and numeric line are required.');
  if (target?.live || start <= now) return unavailable('PREMATCH_ONLY', 'Pre-game model estimates are not used for an event already in progress.');
  const fit = fitAdaptiveHistory({research, target, now});
  if (!fit) return unavailable('MODEL_NOT_READY', 'At least 9 usable, distinct, verified completed games are required.');
  // No normal-CDF conversion of a handful of regression errors. A current-line
  // historical hit rate also MUST NOT masquerade as a calibrated forecast.
  return {...target, ...unavailable('MODEL_WITHHELD', 'History Model is being validated. H2H and recent/season/home-away evidence are evaluated when verified, but calibrated Over/Under probabilities and model EV are unavailable until real-line validation passes.'),
    modelVersion: ADAPTIVE_VERSION, probabilityAvailable: false,
    probabilityOver: null, probabilityUnder: null, probabilityPush: null,
    projection: null, generatedAt: new Date(now).toISOString(), expiresAt: new Date(Math.min(start, now + 10 * 60_000)).toISOString(),
    featureCutoff: fit.featureCutoff, sampleSize: fit.sampleSize, validation: fit.validation,
    evidence: fit.evidence, currentLineHistory: fit.currentLineHistory,
    sourceKind: 'verified-history-adaptive-model'};
}
