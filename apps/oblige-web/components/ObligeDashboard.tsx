'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

type Account = { id: string; email?: string };
type PropRow = {
  id?: string;
  playerName?: string;
  market?: string;
  line?: number | string;
  side?: string;
  price?: number | string;
  sportsbook?: string;
  sportsbookKey?: string;
  team?: string;
  opponent?: string;
  homeTeam?: string;
  awayTeam?: string;
  gameStartTime?: string;
  eventId?: string;
  live?: boolean;
  providerUpdatedAt?: string;
  updatedAt?: string;
};
type BoardMeta = { provider?: string; warning?: string; sportsbookCount?: number; lineCount?: number; stale?: boolean };
type Group = { key: string; player: string; market: string; line: string; matchup: string; start: string; live: boolean; quotes: PropRow[] };
type AuthMode = 'login' | 'register' | 'verify';

const SPORTS = ['NFL', 'NBA', 'MLB', 'WNBA', 'NHL', 'NCAAF', 'NCAAB', 'TENNIS', 'SOCCER'];

function priceLabel(value: PropRow['price']) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n > 0 ? `+${n}` : String(n);
}

function timeLabel(value?: string) {
  if (!value) return 'Time unavailable';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';
  return date.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

function matchupLabel(row: PropRow) {
  if (row.awayTeam && row.homeTeam) return `${row.awayTeam} @ ${row.homeTeam}`;
  if (row.team && row.opponent) return `${row.team} vs ${row.opponent}`;
  return row.team || row.opponent || 'Matchup unavailable';
}

function bestQuote(rows: PropRow[], side: 'OVER' | 'UNDER') {
  return rows
    .filter((row) => String(row.side || '').toUpperCase() === side)
    .sort((a, b) => Number(b.price ?? -100000) - Number(a.price ?? -100000))[0] || null;
}

function groupRows(rows: PropRow[]): Group[] {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const player = String(row.playerName || '').trim();
    const market = String(row.market || '').trim();
    const line = String(row.line ?? '').trim();
    if (!player || !market || !line) continue;
    const key = [row.eventId || matchupLabel(row), player, market, line].join('|');
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        player,
        market,
        line,
        matchup: matchupLabel(row),
        start: timeLabel(row.gameStartTime),
        live: row.live === true,
        quotes: [],
      });
    }
    groups.get(key)!.quotes.push(row);
  }
  return [...groups.values()];
}

export default function ObligeDashboard() {
  const [account, setAccount] = useState<Account | null>(null);
  const [checkingAccount, setCheckingAccount] = useState(true);
  const [sport, setSport] = useState('NFL');
  const [rows, setRows] = useState<PropRow[]>([]);
  const [meta, setMeta] = useState<BoardMeta>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [book, setBook] = useState('all');
  const [market, setMarket] = useState('all');
  const [refreshKey, setRefreshKey] = useState(0);
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const [rememberMe, setRememberMe] = useState(true);

  async function refreshAccount() {
    setCheckingAccount(true);
    try {
      const response = await fetch('/api/account/me', { credentials: 'same-origin', cache: 'no-store' });
      const body = await response.json();
      setAccount(response.ok && body?.authenticated && body?.user?.id ? body.user : null);
    } catch {
      setAccount(null);
    } finally {
      setCheckingAccount(false);
    }
  }

  useEffect(() => { void refreshAccount(); }, []);

  useEffect(() => {
    if (checkingAccount || !account) {
      setRows([]);
      setMeta({});
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18000);
    setLoading(true);
    setError('');
    fetch(`/api/apex/props?sport=${encodeURIComponent(sport)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          setAccount(null);
          throw new Error('Your session ended. Sign in again to continue.');
        }
        if (!response.ok) throw new Error('The live prop board is temporarily unavailable.');
        return response.json();
      })
      .then((body) => {
        setRows(Array.isArray(body?.props) ? body.props : []);
        setMeta(body?.meta || {});
      })
      .catch((cause) => setError(controller.signal.aborted ? 'The prop board took too long to respond. Try again.' : String(cause?.message || cause)))
      .finally(() => { clearTimeout(timer); setLoading(false); });
    return () => { controller.abort(); clearTimeout(timer); };
  }, [checkingAccount, account, sport, refreshKey]);

  const groups = useMemo(() => groupRows(rows), [rows]);
  const books = useMemo(() => [...new Set(rows.map((row) => String(row.sportsbook || '').trim()).filter(Boolean))].sort(), [rows]);
  const markets = useMemo(() => [...new Set(rows.map((row) => String(row.market || '').trim()).filter(Boolean))].sort(), [rows]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return groups.filter((group) => {
      if (needle && !`${group.player} ${group.market} ${group.matchup}`.toLowerCase().includes(needle)) return false;
      if (market !== 'all' && group.market !== market) return false;
      if (book !== 'all' && !group.quotes.some((quote) => quote.sportsbook === book)) return false;
      return true;
    }).slice(0, 80);
  }, [groups, query, market, book]);

  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    if (!authMode) return;
    setAuthBusy(true);
    setAuthMessage('');
    const endpoint = authMode === 'login' ? '/api/account/login' : authMode === 'register' ? '/api/account/register' : '/api/account/verify';
    const payload = authMode === 'verify'
      ? { email: authEmail, code: authCode }
      : { email: authEmail, password: authPassword, rememberMe };
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok === false) {
        setAuthMessage(body?.message || 'That request could not be completed.');
        return;
      }
      if (authMode === 'register' && !body?.authenticated) {
        setAuthMode('verify');
        setAuthMessage(body?.message || 'Enter the verification code sent to your email.');
        return;
      }
      if (authMode === 'verify') {
        setAuthMode('login');
        setAuthPassword('');
        setAuthMessage(body?.message || 'Email verified. Sign in to continue.');
        return;
      }
      await refreshAccount();
      setAuthMode(null);
      setAuthMessage('');
      setAuthPassword('');
    } catch {
      setAuthMessage('The account service could not be reached.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout() {
    await fetch('/api/account/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => null);
    setAccount(null);
    setRows([]);
  }

  const providerLabel = String(meta.provider || 'PropLine').replace(/[-_]/g, ' ');

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Oblige Props home">
          <span className="brand-mark">OP</span>
          <span><strong>OBLIGE</strong> PROPS</span>
        </a>
        <nav className="topnav" aria-label="Main navigation">
          <a className="active" href="/">Props</a>
          <a href="/apex">Research</a>
          <a href="/live">Live</a>
          <a href="/news">News</a>
        </nav>
        <div className="account-zone">
          <span className="system-pill"><i />PropLine primary</span>
          {checkingAccount ? <span className="muted">Checking…</span> : account ? (
            <button className="ghost-button" onClick={() => void logout()}>Sign out</button>
          ) : (
            <button className="ghost-button" onClick={() => setAuthMode('login')}>Sign in</button>
          )}
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">LIVE PROP RESEARCH</p>
          <h1>Cleaner research. Faster decisions.</h1>
          <p className="hero-copy">A lightweight Vercel frontend over the same Oblige Props production APIs, with PropLine as the primary covered-data source.</p>
        </div>
        <div className="hero-actions">
          <a className="primary-button" href="/apex">Open advanced research</a>
          <button className="secondary-button" onClick={() => setRefreshKey((value) => value + 1)}>Refresh board</button>
        </div>
      </section>

      <section className="sport-strip" aria-label="Sport selection">
        {SPORTS.map((item) => (
          <button key={item} className={sport === item ? 'sport active' : 'sport'} onClick={() => { setSport(item); setBook('all'); setMarket('all'); }}>
            {item}
          </button>
        ))}
      </section>

      <section className="workspace">
        <div className="workspace-head">
          <div>
            <p className="eyebrow">{sport} BOARD</p>
            <h2>Available player props</h2>
            <p className="subcopy">Only real returned lines are shown. Missing research stays unavailable instead of being guessed.</p>
          </div>
          <div className="board-status">
            <span>{providerLabel}</span>
            {meta.stale ? <b className="warn">Retained data</b> : <b>Live</b>}
          </div>
        </div>

        <div className="filters">
          <label className="search-box"><span>Search</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Player, market, matchup" /></label>
          <label><span>Market</span><select value={market} onChange={(event) => setMarket(event.target.value)}><option value="all">All markets</option>{markets.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label><span>Book</span><select value={book} onChange={(event) => setBook(event.target.value)}><option value="all">All books</option>{books.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        </div>

        {!checkingAccount && !account ? (
          <div className="gate-card">
            <div className="gate-icon">↗</div>
            <h3>Sign in to load live props</h3>
            <p>The prop board stays behind the same production account gate. Your session remains HttpOnly and handled by the Railway backend.</p>
            <div className="gate-actions"><button className="primary-button" onClick={() => setAuthMode('login')}>Sign in</button><button className="secondary-button" onClick={() => setAuthMode('register')}>Create account</button></div>
          </div>
        ) : null}

        {account && loading ? <div className="loading-grid">{Array.from({ length: 8 }, (_, index) => <div className="skeleton-card" key={index} />)}</div> : null}
        {account && error ? <div className="error-card"><strong>Board unavailable</strong><span>{error}</span><button onClick={() => setRefreshKey((value) => value + 1)}>Try again</button></div> : null}
        {account && !loading && !error && !visible.length ? <div className="empty-card"><strong>No matching props right now.</strong><span>Try another sport or clear the filters.</span></div> : null}

        {account && !loading && !error && visible.length ? (
          <div className="prop-grid">
            {visible.map((group) => {
              const over = bestQuote(group.quotes, 'OVER');
              const under = bestQuote(group.quotes, 'UNDER');
              return (
                <article className="prop-card" key={group.key}>
                  <div className="prop-top"><div><p className="player">{group.player}</p><p className="matchup">{group.matchup} · {group.start}</p></div>{group.live ? <span className="live-chip">LIVE</span> : null}</div>
                  <div className="market-row"><span>{group.market}</span><strong>{group.line}</strong></div>
                  <div className="quote-grid">
                    <div className="quote"><span>OVER</span><strong>{priceLabel(over?.price)}</strong><small>{over?.sportsbook || 'Unavailable'}</small></div>
                    <div className="quote"><span>UNDER</span><strong>{priceLabel(under?.price)}</strong><small>{under?.sportsbook || 'Unavailable'}</small></div>
                  </div>
                  <div className="card-foot"><span>{group.quotes.length} returned line{group.quotes.length === 1 ? '' : 's'}</span><a href="/apex">Research →</a></div>
                </article>
              );
            })}
          </div>
        ) : null}

        {meta.warning ? <p className="coverage-note">{meta.warning}</p> : null}
      </section>

      <footer className="footer"><span>Oblige Props</span><span>Frontend: Vercel-ready Next.js · API/data: Railway + PropLine</span></footer>

      {authMode ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setAuthMode(null); }}>
          <section className="auth-modal" role="dialog" aria-modal="true" aria-label="Account access">
            <button className="close-button" aria-label="Close" onClick={() => setAuthMode(null)}>×</button>
            <p className="eyebrow">OBLIGE PROPS ACCOUNT</p>
            <h2>{authMode === 'login' ? 'Welcome back' : authMode === 'register' ? 'Create your account' : 'Verify your email'}</h2>
            <p className="subcopy">{authMode === 'verify' ? 'Enter the code sent to your email.' : 'Account access is handled by the existing production authentication service.'}</p>
            <form onSubmit={submitAuth} className="auth-form">
              <label><span>Email</span><input type="email" autoComplete="email" required value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} /></label>
              {authMode === 'verify' ? <label><span>Verification code</span><input inputMode="numeric" autoComplete="one-time-code" required value={authCode} onChange={(event) => setAuthCode(event.target.value)} /></label> : <label><span>Password</span><input type="password" autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} required value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} /></label>}
              {authMode !== 'verify' ? <label className="remember"><input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />Keep me signed in</label> : null}
              {authMessage ? <p className="auth-message">{authMessage}</p> : null}
              <button className="primary-button full" disabled={authBusy}>{authBusy ? 'Working…' : authMode === 'login' ? 'Sign in' : authMode === 'register' ? 'Create account' : 'Verify email'}</button>
            </form>
            <div className="auth-switch">
              {authMode === 'login' ? <button onClick={() => { setAuthMode('register'); setAuthMessage(''); }}>Need an account?</button> : <button onClick={() => { setAuthMode('login'); setAuthMessage(''); }}>Already have an account?</button>}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
