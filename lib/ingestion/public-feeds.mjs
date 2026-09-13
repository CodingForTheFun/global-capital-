import crypto from 'node:crypto';

const UA = process.env.AUTOSCOUT_PUBLIC_FEED_USER_AGENT || 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1';
const TIMEOUT_MS = Math.max(3000, Number(process.env.AUTOSCOUT_PUBLIC_FEED_TIMEOUT_MS || 12000));
const text = v => String(v ?? '').trim();
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const iso = v => { if (!v) return null; const d = new Date(v); return Number.isFinite(d.getTime()) ? d.toISOString() : null; };
const hash = (...parts) => crypto.createHash('sha1').update(parts.map(text).join('|')).digest('hex');
const canonical = v => text(v).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function getJson(url, { signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener?.('abort', abort, { once: true });
  try {
    const r = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json,text/plain,*/*', 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', 'cache-control': 'no-cache' } });
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status, endpoint: url });
    return await r.json();
  } finally {
    clearTimeout(timer); signal?.removeEventListener?.('abort', abort);
  }
}

function row({ source, bookmaker, sport, playerId, playerName, team, position, eventId, market, side, line, gameStartTime, payload }) {
  if (!playerName || !market || !Number.isFinite(Number(line))) return null;
  const observedAt = new Date().toISOString();
  const pid = text(playerId) || `${source}:${sport}:${canonical(playerName)}`;
  const eid = text(eventId) || `${source}:${sport}:${hash(playerName, gameStartTime).slice(0,16)}`;
  const normalizedSide = text(side).toUpperCase();
  const sideValue = normalizedSide === 'UNDER' ? 'UNDER' : 'OVER';
  return { id: `${source}:${hash(pid,eid,market,sideValue,line)}`, source, bookmaker, sport: text(sport).toUpperCase() || 'UNKNOWN', player_id: pid, player_name: playerName, team: text(team) || null, position: text(position) || null, event_id: eid, market: text(market), side: sideValue, line: Number(line), game_start_time: iso(gameStartTime) || observedAt, observed_at: observedAt, expires_at: iso(gameStartTime) || new Date(Date.now()+15*60_000).toISOString(), payload };
}

function ppSport(projection, league) { return text(league?.attributes?.name || league?.attributes?.sport || projection?.attributes?.league).toUpperCase(); }
export async function fetchPrizePicks({ signal } = {}) {
  const json = await getJson('https://api.prizepicks.com/projections', { signal });
  const included = new Map((json.included || []).map(x => [`${x.type}:${x.id}`, x]));
  const out = [];
  for (const p of json.data || []) {
    const a = p.attributes || {};
    const rel = p.relationships || {};
    const playerRef = rel.new_player?.data || rel.player?.data;
    const leagueRef = rel.league?.data;
    const player = playerRef ? included.get(`${playerRef.type}:${playerRef.id}`) : null;
    const league = leagueRef ? included.get(`${leagueRef.type}:${leagueRef.id}`) : null;
    const pa = player?.attributes || {};
    const common = { source:'prizepicks', bookmaker:'PrizePicks', sport:ppSport(p,league), playerId:player?.id, playerName:pa.name || a.player_name, team:pa.team || pa.team_name, position:pa.position, eventId:a.game_id || a.event_id || rel.game?.data?.id, market:a.stat_type || a.stat_display_name, line:num(a.line_score), gameStartTime:a.start_time || a.game_time, payload:{ projection_id:p.id, odds_type:a.odds_type || null, flash_sale_line_score:a.flash_sale_line_score ?? null, original_line_score:a.original_line_score ?? null, demon:a.odds_type === 'demon', goblin:a.odds_type === 'goblin' } };
    for (const side of ['OVER','UNDER']) { const r=row({...common,side}); if(r) out.push(r); }
  }
  return out;
}

export async function fetchUnderdog({ signal } = {}) {
  const json = await getJson('https://api.underdogfantasy.com/beta/v5/over_under_lines', { signal });
  const players = new Map((json.players || []).map(p => [text(p.id), p]));
  const appearances = new Map((json.appearances || []).map(a => [text(a.id), a]));
  const games = new Map((json.games || []).map(g => [text(g.id), g]));
  const out=[];
  for (const l of json.over_under_lines || []) {
    const ou = l.over_under || l;
    const app = appearances.get(text(ou.appearance_stat?.appearance_id || ou.appearance_id || l.appearance_id)) || {};
    const player = players.get(text(app.player_id || ou.player_id || l.player_id)) || ou.player || l.player || {};
    const game = games.get(text(app.match_id || app.game_id || ou.game_id || l.game_id)) || {};
    const playerName = player.full_name || player.name || [player.first_name,player.last_name].filter(Boolean).join(' ');
    const common={source:'underdog',bookmaker:'Underdog',sport:text(game.sport_id || game.sport || app.sport_id || player.sport_id).toUpperCase(),playerId:player.id,playerName,team:player.team_abbr || player.team || app.team_abbr,position:player.position,eventId:game.id || app.match_id || app.game_id,market:ou.stat_value || ou.stat || ou.appearance_stat?.display_stat || l.stat_value,line:num(l.stat_value ?? l.line ?? ou.line),gameStartTime:game.scheduled_at || game.start_time || app.scheduled_at,payload:{line_id:l.id,payout_multiplier:l.payout_multiplier ?? l.multiplier ?? null,choice_options:l.choice_options || ou.choice_options || null}};
    for(const side of ['OVER','UNDER']){const r=row({...common,side});if(r)out.push(r);}
  }
  return out;
}

function walk(value, fn) { if (Array.isArray(value)) for (const v of value) walk(v,fn); else if(value && typeof value==='object'){fn(value);for(const v of Object.values(value)) walk(v,fn);} }
function dkCandidate(o, sportHint='') {
  const playerName = o.participantName || o.playerName || o.label || o.name;
  const market = o.subcategoryName || o.marketName || o.categoryName || o.statType;
  const line = num(o.line ?? o.points ?? o.handicap);
  if (!playerName || !market || line===null) return [];
  const sideRaw = text(o.outcomeType || o.side || o.selection || o.label).toUpperCase();
  const side = sideRaw.includes('UNDER') ? 'UNDER' : sideRaw.includes('OVER') ? 'OVER' : null;
  if(!side) return [];
  const r=row({source:'draftkings',bookmaker:'DraftKings',sport:text(o.sport || o.sportName || sportHint).toUpperCase(),playerId:o.participantId || o.playerId,playerName,team:o.teamName || o.team,position:o.position,eventId:o.eventId || o.event?.id,market,side,line,gameStartTime:o.startDate || o.startTime || o.event?.startDate,payload:{outcome_id:o.id || o.outcomeId,oddsAmerican:o.oddsAmerican ?? o.americanOdds ?? null}});
  return r?[r]:[];
}
export async function fetchDraftKings({ signal, sport=''} = {}) {
  const base='https://sportsbook-nash.draftkings.com/sites/US-SB/api/v5';
  const urls=[`${base}/eventgroups`,`${base}/sports`];
  const out=[]; const seen=new Set(); let lastError=null;
  for(const url of urls){
    try{const json=await getJson(url,{signal});walk(json,o=>{for(const r of dkCandidate(o,sport)){if(!seen.has(r.id)){seen.add(r.id);out.push(r);}}});if(out.length)break;}catch(e){lastError=e;}
  }
  if(!out.length && lastError) throw lastError;
  return out;
}

export async function fetchAllPublicProps({ signal }={}) {
  const settled=await Promise.allSettled([fetchPrizePicks({signal}),fetchUnderdog({signal}),fetchDraftKings({signal})]);
  const names=['prizepicks','underdog','draftkings']; const rows=[]; const providers={};
  settled.forEach((r,i)=>{if(r.status==='fulfilled'){providers[names[i]]={ok:true,count:r.value.length};rows.push(...r.value);}else providers[names[i]]={ok:false,error:String(r.reason?.status || r.reason?.message || 'failed').slice(0,100)};});
  return {rows,providers};
}
