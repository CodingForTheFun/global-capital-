from pathlib import Path
import hashlib,subprocess
expected={'apps/oblige-web/lib/api.ts':'1abc86dbcd6466f50dbd2501e11da99f2704e655192c5c69b48b8cc3aaa4a9ff','apps/oblige-web/lib/player-headshots.ts':'58763d08d0baee9590aa64e9e1b13e6ad7adad438e3df0f379bb49a2cfe7a912','apps/oblige-web/components/terminal-board.tsx':'c731dc8f6907eab7141b8e6007965bb6f1c922bea3d97cfd0faf35e9f157ae88','apps/oblige-web/components/player-view.tsx':'f290ab950155af585a5912bb2703a245bce84b0c3bddf20293a9a3a1d82472d4','apps/oblige-web/components/prop-explorer.tsx':'c8f26572e03f05f1e5411580777f415d28934307144afa3d5491239ae634ff0c','apps/oblige-web/tests/player-headshots.test.mjs':'4a5789c3cc7cdc5722076f5af4bf2f0ae9e31d0be22f5133a5efba9682703a26'}
for f,h in expected.items():assert hashlib.sha256(Path(f).read_bytes()).hexdigest()==h,'Source advanced: '+f
def edit(f,old,new):
 p=Path(f);s=p.read_text();assert old in s,(f,old[:90]);p.write_text(s.replace(old,new,1))
api='apps/oblige-web/lib/api.ts'
edit(api,"  code: string;\n  constructor(message: string, status: number, code = 'REQUEST_FAILED') {", "  code: string;\n  retryAt: number;\n  constructor(message: string, status: number, code = 'REQUEST_FAILED', retryAt = 0) {")
edit(api,'    this.code = code;','    this.code = code;\n    this.retryAt = retryAt;')
edit(api,'new Set([429, 502, 503, 504])','new Set([502, 503, 504])')
edit(api,"if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 250), 5_000);", "if (Number.isFinite(seconds) && seconds >= 0) return Math.max(seconds * 1000, 250);")
edit(api,"if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 250), 5_000);", "if (Number.isFinite(date)) return Math.max(date - Date.now(), 250);")
edit(api,"  return Math.min(450 * 2 ** attempt, 1_800);", "  return response.status === 429 ? 60_000 : Math.min(450 * 2 ** attempt, 1_800);")
edit(api," * rate-limit failures. The browser respects Retry-After when supplied and", " * gateway failures. Rate limits pause the shared research queue for the FULL\n * Retry-After duration, rather than shortening 60 seconds to 5 seconds.\n * The browser respects Retry-After when supplied and")
edit(api,"    if (response.ok) return body;\n\n    if (attempt", """    if (response.ok) return body;
    if (response.status === 429) {
      const retryAt = Date.now() + retryAfterMs(response, attempt);
      if (path.startsWith('/api/apex/research') || path.startsWith('/api/apex/propline')) researchCooldownUntil = Math.max(researchCooldownUntil, retryAt);
      throw new ApiError(path.startsWith('/api/apex/research') || path.startsWith('/api/apex/propline') ? 'Research is temporarily paused. This is a request limit, not a missing-history result.' : (body?.message || 'Too many requests. Try again after the cooldown.'), 429, body?.code || 'RATE_LIMITED', retryAt);
    }
    if (attempt""")
needle="const researchCache = new Map<string, { expiresAt: number; value: ResearchResponse }>();"
edit(api,needle,needle+'''
// Shared, bounded research work. Sorting/unmounting one subscriber must not
// abort another subscriber or restart the same request. Abandoned queued work
// never starts; executing work may populate the cache after navigation.
let researchCooldownUntil = 0;
let activeResearch = 0;
type ResearchTask = {
  path: string;
  promise: Promise<ResearchResponse>;
  resolve(value: ResearchResponse): void;
  reject(reason: unknown): void;
  subscribers: Set<symbol>;
};
const researchPending = new Map<string, ResearchTask>();
const researchQueue: ResearchTask[] = [];
export function researchRetryAt() { return researchCooldownUntil; }
function pausedResearch() {
  return new ApiError('Research is temporarily paused. This is a request limit, not a missing-history result.', 429, 'RATE_LIMITED', researchCooldownUntil);
}
function pumpResearch() {
  while (activeResearch < 4 && researchQueue.length) {
    const task = researchQueue.shift()!;
    if (!task.subscribers.size || researchCooldownUntil > Date.now()) {
      researchPending.delete(task.path);
      task.reject(task.subscribers.size ? pausedResearch() : new ApiError('The request was cancelled.', 0, 'ABORTED'));
      continue;
    }
    activeResearch++;
    void getJson<ResearchResponse>(task.path).then(value => {
      rememberResearch(task.path, value);
      task.resolve(value);
    }, task.reject).finally(() => {
      researchPending.delete(task.path);
      activeResearch--;
      pumpResearch();
    });
  }
}
function subscribeResearch(task: ResearchTask, signal?: AbortSignal) {
  return new Promise<ResearchResponse>((resolve, reject) => {
    const token = Symbol();
    const cleanup = () => { task.subscribers.delete(token); signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new ApiError('The request was cancelled.', 0, 'ABORTED')); };
    // Always consume rejection, including a subscriber cancelled before start.
    task.promise.then(value => { cleanup(); if (!signal?.aborted) resolve(value); }, error => { cleanup(); reject(error); });
    if (signal?.aborted) { abort(); return; }
    task.subscribers.add(token);
    signal?.addEventListener('abort', abort, { once: true });
    pumpResearch();
  });
}
''')
edit(api,"  const value = await getJson<ResearchResponse>(path, signal);\n  rememberResearch(path, value);\n  return value;", """  if (researchCooldownUntil > Date.now()) throw pausedResearch();
  let task = researchPending.get(path);
  if (!task) {
    if (researchQueue.length >= 80) throw new ApiError('Research is busy. Try again shortly.', 503, 'RESEARCH_BUSY');
    let resolve!: ResearchTask['resolve'], reject!: ResearchTask['reject'];
    const promise = new Promise<ResearchResponse>((yes, no) => { resolve = yes; reject = no; });
    task = { path, promise, resolve, reject, subscribers: new Set() };
    researchPending.set(path, task);
    researchQueue.push(task);
  }
  return subscribeResearch(task, signal);""")
board='apps/oblige-web/components/terminal-board.tsx'
edit(board,"const pageKey = page.map((group) => group.key).join('|');", "// A changed sort order is not a changed research batch.\n  const pageKey = page.map((group) => group.key).sort().join('|');")
edit(board,"        } catch {\n          if (!controller.signal.aborted) {\n            setResearch((current) => ({ ...current, [group.key]: null }));", """        } catch (cause) {
          if (cause instanceof ApiError && cause.status === 429) {
            // Stop the batch; the shared pool enforces the complete cooldown.
            // Throttled rows are not permanently marked as missing history.
            queue.length = 0;
            break;
          }
          if (!controller.signal.aborted) {
            setResearch((current) => ({ ...current, [group.key]: null }));""")
view='apps/oblige-web/components/player-view.tsx'
edit(view,"  const [researchError, setResearchError] = React.useState('');", """  const [researchError, setResearchError] = React.useState('');
  const [retryAt, setRetryAt] = React.useState(0);
  const [retryIn, setRetryIn] = React.useState(0);
  const [researchAttempt, setResearchAttempt] = React.useState(0);
  const loadedIdentity = React.useRef('');
  React.useEffect(() => {
    const update = () => setRetryIn(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    update();
    if (retryAt <= Date.now()) return;
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);""")
edit(view,"    setResearch(null);\n    setResearchError('');\n    fetchResearch", "    if (loadedIdentity.current !== researchIdentity) setResearch(null);\n    loadedIdentity.current = researchIdentity;\n    setResearchError('');\n    setRetryAt(0);\n    fetchResearch")
edit(view,"      .then((value) => {\n        setResearch(value);", "      .then((value) => {\n        if (controller.signal.aborted) return;\n        setResearch(value);")
edit(view,"        setResearch(null);\n        setResearchError(", "        if (cause instanceof ApiError && cause.status === 429) setRetryAt(cause.retryAt);\n        setResearchError(")
edit(view,"  }, [researchIdentity]);", "  }, [researchIdentity, researchAttempt]);")
edit(view,"              unavailableReason={\n                researchError ||", "              unavailableTitle={researchError ? (retryAt ? 'Research temporarily paused' : 'Research temporarily unavailable') : undefined}\n              unavailableReason={\n                (!games.length ? researchError : '') ||")
edit(view,"            {researchError || research?.message || 'No verified history is available for this player and market yet.'}\n          </p>", """            <span>{researchError || research?.message || 'No verified history is available for this player and market yet.'}
              {researchError && <Button className="ml-2" size="sm" disabled={loadingResearch || retryIn > 0} onClick={() => setResearchAttempt(value => value + 1)}>{retryIn > 0 ? `Retry in ${retryIn}s` : 'Retry research'}</Button>}
            </span>
          </p>""")
edit(view,"import { ApiError,", "import { artworkUrl, ApiError,")
edit(view,"                  <span>{group.matchup}</span>", "                  <span>{group.matchup}</span>\n                  <a href={artworkUrl(group.sport, group.player, group.team, group.providerPlayerId) + '&format=credits'} target=\"_blank\" rel=\"noopener noreferrer\" className=\"underline\">Photo credit</a>")
f='apps/oblige-web/components/prop-explorer.tsx'
edit(f,'loading,unavailableReason,state,','loading,unavailableReason,unavailableTitle,state,')
edit(f,'unavailableReason?:string|null;','unavailableReason?:string|null;unavailableTitle?:string;')
edit(f,"unavailableReason?'History unavailable':","unavailableReason?(unavailableTitle||'History unavailable'):")
edit(f,'<strong>Verified history unavailable</strong>',"<strong>{unavailableTitle||'Verified history unavailable'}</strong>")
photo='apps/oblige-web/lib/player-headshots.ts'
edit(photo,"  if (code.startsWith('TENNIS_')) return 'TENNIS';", "  if (code.startsWith('TENNIS_') || ['ATP', 'WTA', 'ITF'].includes(code)) return 'TENNIS';\n  if (code.startsWith('GOLF_') || ['PGA', 'LPGA', 'LIV'].includes(code)) return 'GOLF';\n  if (code.startsWith('MMA_') || code === 'UFC') return 'MMA';")
edit(photo,"? (raw === 'MLS' || raw === 'SOCCER_USA_MLS' ? 'MLS' : raw === 'UCL' || raw === 'SOCCER_UEFA_CHAMPS_LEAGUE' ? 'UCL' : 'EPL') : sport;", "? (raw === 'MLS' || raw === 'SOCCER_USA_MLS' ? 'MLS' : raw === 'UCL' || raw === 'SOCCER_UEFA_CHAMPS_LEAGUE' ? 'UCL' : raw === 'EPL' || raw === 'SOCCER_EPL' ? 'EPL' : 'SOCCER') : sport;")
edit(photo,"{ sport: resolverSport, name, v: 'player-cards-2' }", "{ sport: resolverSport, name, v: 'all-sport-photos-3', requirePhoto: '1' }")
edit(photo,"    sources.push(`/api/apex/player-artwork?${params}`);", "    // Verify and persist first; explicit provider images are bounded fallback.\n    sources.unshift(`/api/apex/player-artwork?${params}`);")
f='apps/oblige-web/tests/player-headshots.test.mjs';p=Path(f);s=p.read_text()
s=s.replace("const remote=src=>new URL(src,'https://example.test').searchParams.get('url');", "const remote=src=>new URL(src,'https://example.test').searchParams.get('url');\nconst providerPhoto=sources=>sources.find(s=>s.startsWith('/_next/image?'));")
s=s.replace("assert.ok(sources[0].startsWith('/_next/image?'));", "assert.ok(sources[0].startsWith('/api/apex/player-artwork?'));").replace("remote(sources[0])", "remote(providerPhoto(sources))").replace("assert.ok(sources[1].startsWith('/api/apex/player-artwork?'));", "assert.ok(sources[1].startsWith('/_next/image?'));")
s=s.replace("headshotSources({...player,providerPlayerId:'history:NFL:42'})[0].startsWith('/_next/image?')", "providerPhoto(headshotSources({...player,providerPlayerId:'history:NFL:42'}))?.startsWith('/_next/image?')")
s=s.replace("assert.ok(headshotSources({...player,providerPlayerId:'history:NBA:42'})[0].startsWith('/api/apex/'));", "assert.equal(providerPhoto(headshotSources({...player,providerPlayerId:'history:NBA:42'})),undefined);")
s=s.replace("assert.ok(headshotSources({...player,providerPlayerId})[0].startsWith('/api/apex/'));", "assert.equal(providerPhoto(headshotSources({...player,providerPlayerId})),undefined);")
s=s.replace("remote(headshotSources({...player,sport:'soccer_uefa_nations_league',providerPlayerId:'espn:42'})[0])", "remote(providerPhoto(headshotSources({...player,sport:'soccer_uefa_nations_league',providerPlayerId:'espn:42'})))")
s=s.replace("url.searchParams.get('sport'),'EPL'", "url.searchParams.get('sport'),'SOCCER'")
s=s.replace("remote(headshotSources({sport:'MLB',name:'Test Player',providerPlayerId:'mlb:660271'})[0])", "remote(providerPhoto(headshotSources({sport:'MLB',name:'Test Player',providerPlayerId:'mlb:660271'})))")
s=s.replace("remote(headshotSources({sport:'NBA',name:'Test Player',providerPlayerId:'nba:201939'})[0])", "remote(providerPhoto(headshotSources({sport:'NBA',name:'Test Player',providerPlayerId:'nba:201939'})))")
s=s.replace("assert.ok(headshotSources({sport:'NFL',name:'Test Player',providerPlayerId:'nba:201939'})[0].startsWith('/api/apex'));", "assert.equal(providerPhoto(headshotSources({sport:'NFL',name:'Test Player',providerPlayerId:'nba:201939'})),undefined);")
s+='''\ntest('every sport starts with a persistent strict identity lookup',()=>{
 for(const sport of ['NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB','TENNIS','GOLF','MMA','ROCKETLEAGUE','CS2','LOL','DOTA2','VALORANT','CRICKET','RUGBY','NEW_SPORT']) {
  const [url]=headshotSources({sport,name:'Fixture Person'});const q=new URL(url,'https://example.test').searchParams;
  assert.equal(q.get('requirePhoto'),'1');assert.equal(q.get('v'),'all-sport-photos-3');
 }
});
''';p.write_text(s)
f='scripts/verify-restored-terminal.mjs'
assert subprocess.check_output(['git','hash-object',f],text=True).strip()=='952ba65ea68453542eead0604bb416ae8f901c2f','Browser regression source advanced'
edit(f,"  assert.ok(new URL(imgSrc,base).searchParams.get('url').includes('/nfl/players/full/42.png'));", "  const imageUrl=new URL(imgSrc,base);assert.equal(imageUrl.pathname,'/api/apex/player-artwork');assert.equal(imageUrl.searchParams.get('sport'),'NFL');assert.equal(imageUrl.searchParams.get('providerPlayerId'),'espn:42');assert.equal(imageUrl.searchParams.get('requirePhoto'),'1');")
edit(f,"new URL(n.src).searchParams.get('url')?.includes('/wnba/players/full/84.png')&&n.complete&&n.naturalWidth>0", "new URL(n.src).searchParams.get('sport')==='WNBA'&&new URL(n.src).searchParams.get('providerPlayerId')==='espn:84'&&n.complete&&n.naturalWidth>0")
