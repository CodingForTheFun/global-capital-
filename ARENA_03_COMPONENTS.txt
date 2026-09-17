# Oblige Props — Arena AI Visual Handoff 3/4

Player/research/account surfaces, search, motion, theme, pricing UI, and shared UI primitives.


## FILE: apps/oblige-web/components/account-view.tsx

```tsx
'use client';

import * as React from 'react';
import { Minus, Plus } from 'lucide-react';
import { ApiError, fetchAccount, postAccount } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { CardHeader, CardPanel, CardTitle } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { SignInPanel } from '@/components/sign-in';

const SECTIONS = [
  { id: 'support', label: 'Support' },
  { id: 'profile', label: 'Profile' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

const FAQ: [string, string][] = [
  [
    'Why do some players show fewer games than others?',
    'Because only games they actually played are counted. A player who missed three weeks shows the games they played and marks the rest, and the hit rate is calculated on the games that count.',
  ],
  [
    'How often do the lines update?',
    'The board refreshes on demand and on a short interval. Every change is written to the line-history log at the moment it happens, so movement is accurate to the minute rather than to the last page load.',
  ],
  [
    'A line here does not match my sportsbook. Why?',
    'Books move independently and we show what each one is actually posting. If the gap is more than a point and holds for more than a few minutes, send it below with the player and market and we will check the feed.',
  ],
  [
    'Do you give picks?',
    'No. Oblige Props is research — lines, history and prices. What you do with them is your call.',
  ],
  [
    'How do I cancel?',
    'Email us from the address on your account and we will cancel the renewal. Your access runs to the end of the period you already paid for; nothing is clawed back.',
  ],
];

export function AccountView() {
  const [account, setAccount] = React.useState<{ id: string; email?: string } | null>(null);
  const [checking, setChecking] = React.useState(true);
  const [section, setSection] = React.useState<SectionId>('support');

  React.useEffect(() => {
    const controller = new AbortController();
    fetchAccount(controller.signal)
      .then(setAccount)
      .finally(() => setChecking(false));
    return () => controller.abort();
  }, []);

  if (checking) {
    return (
      <Shell>
        <Skeleton className="h-96 rounded-[var(--radius)]" />
      </Shell>
    );
  }

  if (!account) {
    return (
      <Shell>
        <SignInPanel onSignedIn={setAccount} />
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-[length:var(--fs-xl)]" style={{ textTransform: 'var(--display-case)' as 'none' }}>
        Account &amp; support
      </h1>
      <p className="mt-1.5 text-[length:var(--fs-sm)] text-[var(--text-3)]">
        Signed in as {account.email || account.id}
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start">
        <nav aria-label="Account sections" className="rail lg:sticky lg:top-24 lg:grid lg:gap-1">
          {SECTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-current={section === option.id ? 'true' : undefined}
              onClick={() => setSection(option.id)}
              className={cn(
                'flex min-h-11 flex-none items-center gap-3 whitespace-nowrap rounded-[var(--radius)] px-4 text-left',
                'text-[length:var(--fs-sm)] font-medium',
                'transition-colors duration-200 ease-[var(--ease-out)]',
                section === option.id
                  ? 'bg-[var(--accent-soft)] font-semibold text-[var(--accent)]'
                  : 'text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]',
              )}
            >
              {option.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0">
          {section === 'support' ? <Support /> : <Profile account={account} onSignedOut={() => setAccount(null)} />}
        </div>
      </div>
    </Shell>
  );
}

function Support() {
  const [topic, setTopic] = React.useState('A line looks wrong');
  const [body, setBody] = React.useState('');
  const [error, setError] = React.useState('');
  const [sent, setSent] = React.useState(false);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim()) {
      setError('Add a short description so we know what to look at.');
      return;
    }
    setError('');
    setSent(true);
  }

  return (
    <>
      <CardPanel>
        <CardHeader>
          <CardTitle>Common questions</CardTitle>
        </CardHeader>
        <div className="grid gap-2">
          {FAQ.map(([question, answer]) => (
            <Disclosure key={question} question={question} answer={answer} />
          ))}
        </div>
      </CardPanel>

      <CardPanel className="mt-4">
        <CardHeader>
          <CardTitle>Still stuck? Send it here.</CardTitle>
        </CardHeader>

        {sent ? (
          <div
            role="status"
            className="grid justify-items-center gap-3 rounded-[var(--radius)] border border-[color-mix(in_srgb,var(--pos)_40%,transparent)] bg-[color-mix(in_srgb,var(--pos)_10%,transparent)] p-8 text-center"
          >
            <p className="text-[length:var(--fs-sm)] font-semibold text-[var(--pos)]">Message ready to send</p>
            <p className="max-w-[46ch] text-[length:var(--fs-sm)] text-[var(--text-2)]">
              Email it to{' '}
              <a
                className="font-semibold text-[var(--accent)] underline-offset-4 hover:underline"
                href={`mailto:support@obligeprops.com?subject=${encodeURIComponent(topic)}&body=${encodeURIComponent(body)}`}
              >
                support@obligeprops.com
              </a>{' '}
              and we will pick it up from there.
            </p>
            <Button variant="ghost" size="sm" onClick={() => setSent(false)}>
              Edit the message
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <div className="mb-5 grid gap-2">
              <span className="text-[length:var(--fs-sm)] font-semibold">Topic</span>
              <Select value={topic} onValueChange={setTopic}>
                <SelectTrigger aria-label="Topic">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="A line looks wrong">A line looks wrong</SelectItem>
                  <SelectItem value="Missing player or market">Missing player or market</SelectItem>
                  <SelectItem value="Billing or subscription">Billing or subscription</SelectItem>
                  <SelectItem value="Something else">Something else</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Field
              label="What happened?"
              htmlFor="support-body"
              hint="The more specific the better — player, market, and roughly when you saw it."
              error={error}
              className="mb-5"
            >
              <Textarea value={body} onChange={(event) => setBody(event.target.value)} />
            </Field>

            <Button type="submit">Prepare message</Button>
          </form>
        )}
      </CardPanel>
    </>
  );
}

function Profile({
  account,
  onSignedOut,
}: {
  account: { id: string; email?: string };
  onSignedOut: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');

  async function signOut() {
    setBusy(true);
    setError('');
    try {
      await postAccount('logout', {});
      onSignedOut();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not sign out. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <CardPanel>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <Field
        label="Email"
        htmlFor="profile-email"
        hint="This is the address your receipts and any replies come to."
        className="mb-6"
      >
        <Input type="email" defaultValue={account.email || ''} readOnly autoComplete="email" />
      </Field>

      {error && (
        <p role="alert" className="mb-4 text-[length:var(--fs-sm)] text-[var(--neg)]">
          {error}
        </p>
      )}

      {/* Signing out is the destructive action on this page, so it sits apart
          from everything else and carries the danger treatment. */}
      <div className="border-t border-[var(--line)] pt-5">
        <Button variant="danger" onClick={signOut} disabled={busy}>
          {busy ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
    </CardPanel>
  );
}

function Disclosure({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  return (
    <div
      className={cn(
        'overflow-hidden rounded-[var(--radius)] border bg-[var(--surface)]',
        'transition-colors duration-200 ease-[var(--ease-out)]',
        open ? 'border-[var(--line-strong)]' : 'border-[var(--line)]',
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-14 w-full items-center justify-between gap-3 p-4 text-left text-[length:var(--fs-sm)] font-semibold"
      >
        {question}
        {open ? (
          <Minus className="size-4 shrink-0 text-[var(--text-3)]" aria-hidden="true" />
        ) : (
          <Plus className="size-4 shrink-0 text-[var(--text-3)]" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div
          id={id}
          className="px-4 pb-4 text-[length:var(--fs-sm)] leading-relaxed text-[var(--text-2)]"
        >
          {answer}
        </div>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[var(--maxw)] px-4 pt-8 pb-16 md:px-8">{children}</div>;
}

```

---

## FILE: apps/oblige-web/components/book-prices.tsx

```tsx
'use client';

import * as React from 'react';
import type { PropGroup, PropRow } from '@/lib/types';
import { cn, odds, shortTime } from '@/lib/utils';
import { Badge, Dot } from '@/components/ui/badge';
import { CardHeader, CardPanel, CardTitle } from '@/components/ui/card';

/** Brand colours for the books the board actually carries. Anything else gets
 *  a neutral chip rather than a guessed colour. */
const BOOK_COLOURS: Record<string, string> = {
  draftkings: '#53D337',
  fanduel: '#1476FF',
  betmgm: '#BFA15A',
  caesars: '#0E7A4B',
  espnbet: '#C8102E',
  betrivers: '#1A4FA0',
  pointsbet: '#ED1C24',
  fanatics: '#1B1B1B',
  bet365: '#027B5B',
  hardrock: '#6A2B8A',
  underdog: '#FF5A1F',
  prizepicks: '#8B5CF6',
};

function bookColour(key?: string | null, name?: string | null) {
  const slug = String(key || name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return BOOK_COLOURS[slug] || 'var(--line-strong)';
}

function bookInitials(name: string) {
  const cleaned = String(name || '').replace(/[^A-Za-z0-9 ]/g, '').trim();
  if (!cleaned) return '??';
  const words = cleaned.split(/\s+/);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  return cleaned.slice(0, 3).toUpperCase();
}

type BookRow = { key: string; name: string; over: PropRow | null; under: PropRow | null };

function collapseByBook(quotes: PropRow[]): BookRow[] {
  const books = new Map<string, BookRow>();
  for (const quote of quotes) {
    const name = String(quote.sportsbook || quote.sportsbookKey || '').trim();
    if (!name) continue;
    const key = (quote.sportsbookKey || name).toLowerCase();
    if (!books.has(key)) books.set(key, { key, name, over: null, under: null });
    const row = books.get(key)!;
    const side = String(quote.side || '').toUpperCase();
    const price = Number(quote.price);
    if (!Number.isFinite(price)) continue;
    // A book can quote the same side more than once across a refresh window;
    // keep the better of the two rather than whichever arrived last.
    if (side === 'OVER' && (!row.over || price > Number(row.over.price))) row.over = quote;
    if (side === 'UNDER' && (!row.under || price > Number(row.under.price))) row.under = quote;
  }
  return [...books.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Every book we carry, side by side, with the best available number on each
 * side flagged — so finding two cents does not mean opening five tabs.
 */
export function BookPrices({ group }: { group: PropGroup }) {
  const rows = React.useMemo(() => collapseByBook(group.quotes), [group.quotes]);
  const bestOver = Math.max(...rows.map((row) => Number(row.over?.price ?? -1e6)));
  const bestUnder = Math.max(...rows.map((row) => Number(row.under?.price ?? -1e6)));
  const updated = shortTime(group.quotes[0]?.providerUpdatedAt || group.quotes[0]?.updatedAt);

  return (
    <CardPanel className="mt-4">
      <CardHeader>
        <CardTitle>Prices across books</CardTitle>
        <Badge variant="live">
          <Dot />
          Best flagged
        </Badge>
      </CardHeader>

      {!rows.length ? (
        <p className="py-8 text-center text-[length:var(--fs-sm)] text-[var(--text-3)]">
          No book is currently posting this market.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 text-[length:var(--fs-micro)] uppercase tracking-[.1em] text-[var(--text-3)]">
            <span>Book</span>
            <span className="min-w-[66px] text-center">Over</span>
            <span className="min-w-[66px] text-center">Under</span>
          </div>
          <div className="mt-2 grid gap-2">
            {rows.map((row) => (
              <div
                key={row.key}
                className={cn(
                  'grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-[var(--radius-sm)] p-3',
                  'border border-[var(--line)] bg-[var(--surface-2)]',
                  'transition-colors duration-200 ease-[var(--ease-out)]',
                  'hover:border-[var(--line-strong)] hover:bg-[var(--surface-3)]',
                )}
              >
                <span className="flex min-w-0 items-center gap-3 text-[length:var(--fs-sm)] font-semibold">
                  <span
                    aria-hidden="true"
                    className="grid size-7 shrink-0 place-items-center rounded-md text-[10px] font-extrabold text-white"
                    style={{ background: bookColour(row.key, row.name) }}
                  >
                    {bookInitials(row.name)}
                  </span>
                  <span className="truncate">{row.name}</span>
                </span>
                <Price quote={row.over} best={Number(row.over?.price) === bestOver} />
                <Price quote={row.under} best={Number(row.under?.price) === bestUnder} />
              </div>
            ))}
          </div>
        </>
      )}

      <p className="mt-4 text-[length:var(--fs-xs)] leading-relaxed text-[var(--text-3)]">
        {updated ? `Last quote ${updated}. ` : ''}
        Movement since open is recorded to the minute in the line history log.
      </p>
    </CardPanel>
  );
}

function Price({ quote, best }: { quote: PropRow | null; best: boolean }) {
  return (
    <span
      data-best={best && quote ? 'true' : undefined}
      className={cn(
        'num min-w-[66px] rounded-[var(--radius-sm)] border px-2.5 py-[7px] text-center text-[length:var(--fs-sm)] font-semibold',
        best && quote
          ? 'border-[var(--pos)] bg-[color-mix(in_srgb,var(--pos)_12%,transparent)] text-[var(--pos)]'
          : 'border-[var(--line)] bg-[var(--surface)] text-[var(--text-2)]',
      )}
    >
      {quote ? odds(quote.price) : '—'}
    </span>
  );
}

```

---

## FILE: apps/oblige-web/components/command-search.tsx

```tsx
'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';

function focusBoardSearch() {
  const input = document.querySelector<HTMLInputElement>('main input[type="search"]');
  if (!input) return false;
  input.focus({ preventScroll: true });
  input.select();
  input.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  return true;
}

/**
 * cmdk-inspired global search affordance without another dependency. The
 * existing board search remains the single source of truth; Cmd/Ctrl+K simply
 * takes the user there and focuses it.
 */
export function CommandSearchController() {
  const pathname = usePathname();
  const router = useRouter();
  const pendingFocus = React.useRef(false);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();

      if (pathname === '/board' && focusBoardSearch()) return;
      pendingFocus.current = true;
      router.push('/board');
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pathname, router]);

  React.useEffect(() => {
    if (pathname !== '/board' || !pendingFocus.current) return;
    pendingFocus.current = false;
    const frame = requestAnimationFrame(() => {
      if (focusBoardSearch()) return;
      window.setTimeout(focusBoardSearch, 120);
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  return null;
}

```

---

## FILE: apps/oblige-web/components/face-card.tsx

```tsx
'use client';

import * as React from 'react';
import { ART, teamFor } from '@/lib/teams';
import { artworkUrl, fetchResearch, playedGames } from '@/lib/api';
import type { GameLogRow, PropGroup } from '@/lib/types';
import { cn, initials, odds, rateTone, shortTime } from '@/lib/utils';
import { Badge, Dot } from '@/components/ui/badge';

/* ------------------------------------------------------------- team scene */

/**
 * The club's own backdrop, behind the player's face. It is one absolutely
 * positioned layer inside the card, so it cannot affect layout and does not
 * move when the card lifts on hover.
 */
export function TeamScene({ team, tall }: { team?: string | null; tall?: boolean }) {
  const club = teamFor(team);
  return (
    <span
      className="facebg"
      data-tall={tall ? 'true' : 'false'}
      aria-hidden="true"
      style={{ ['--t1' as string]: club.c1, ['--t2' as string]: club.c2 }}
    >
      <span className="facebg__band">
        <svg
          viewBox="0 0 400 150"
          preserveAspectRatio="xMinYMax slice"
          focusable="false"
          dangerouslySetInnerHTML={{ __html: ART[club.art] }}
        />
      </span>
    </span>
  );
}

/* ----------------------------------------------------------------- avatar */

/**
 * The headshot comes from the existing artwork route, which already falls back
 * to an initials card when a player has no verified photo. This still handles
 * a failed image load, because a broken icon on a card is worse than initials.
 */
export function PlayerAvatar({
  name,
  sport,
  team,
  providerPlayerId,
  size = 50,
  className,
}: {
  name: string;
  sport: string;
  team?: string | null;
  providerPlayerId?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);

  return (
    <span className={cn('ringavatar', className)} style={{ width: size, height: size }}>
      <span
        className={cn(
          'relative grid size-full place-items-center overflow-hidden rounded-full',
          'bg-[var(--face-surface-2)]',
        )}
      >
        <span className="text-[length:var(--fs-sm)] font-bold text-[var(--face-text-3)]" aria-hidden="true">
          {initials(name)}
        </span>
        {!failed && (
          // eslint-disable-next-line @next/next/no-img-element -- the artwork
          // route streams bytes from a same-origin proxy, so the optimizer has
          // nothing to add and would only add a second hop.
          <img
            src={artworkUrl(sport, name, team, providerPlayerId)}
            alt=""
            width={size}
            height={size}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={cn(
              'absolute inset-0 size-full object-cover object-top transition-opacity duration-300 ease-[var(--ease-out)]',
              loaded ? 'opacity-100' : 'opacity-0',
            )}
          />
        )}
      </span>
    </span>
  );
}

/**
 * Combo markets previously sent the entire display label to the artwork route,
 * which guarantees an initials fallback for strings such as "A + B". Split the
 * presentation identity only; research/player contracts still receive the
 * original provider label untouched.
 */
function playerNames(label: string) {
  const names = label
    .split(/\s+(?:\+|&|\/)\s+|\s*\+\s*/g)
    .map((name) => name.trim())
    .filter(Boolean);
  return names.length > 1 ? names.slice(0, 2) : [label];
}

export function PlayerPortraits({
  name,
  sport,
  team,
  providerPlayerId,
  size = 52,
}: {
  name: string;
  sport: string;
  team?: string | null;
  providerPlayerId?: string | null;
  size?: number;
}) {
  const names = playerNames(name);
  if (names.length === 1) {
    return (
      <PlayerAvatar
        name={name}
        sport={sport}
        team={team}
        providerPlayerId={providerPlayerId}
        size={size}
      />
    );
  }
  return (
    <span className="player-portrait-stack" aria-label={`${names.join(' and ')} portraits`}>
      {names.map((playerName, index) => (
        <PlayerAvatar
          key={`${playerName}-${index}`}
          name={playerName}
          sport={sport}
          team={index === 0 ? team : null}
          providerPlayerId={index === 0 ? providerPlayerId : null}
          size={size}
        />
      ))}
    </span>
  );
}

/* ------------------------------------------------------------- hit  meter */

export function HitMeter({
  label,
  hits,
  sample,
  rate,
  delay = 0,
}: {
  label: string;
  hits: number | null;
  sample: number | null;
  rate: number | null;
  delay?: number;
}) {
  const [grown, setGrown] = React.useState(false);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setGrown(true), delay + 60);
    return () => window.clearTimeout(timer);
  }, [delay]);

  const tone = rateTone(rate);
  const fill =
    tone === 'neg' ? 'var(--neg)' : tone === 'warn' ? 'var(--warn)' : 'var(--accent)';

  return (
    <div className="grid gap-[7px]">
      <div className="flex items-center justify-between text-[length:var(--fs-micro)] text-[var(--text-3)]">
        <span>{label}</span>
        <span className="num text-[var(--text)]">
          {sample === null || hits === null ? 'No sample' : `${hits}/${sample}`}
          {rate === null ? '' : ` · ${rate}%`}
        </span>
      </div>
      <div className="block h-2 overflow-hidden rounded-full border border-[var(--line)] bg-[var(--surface-3)]">
        <div
          className="block h-full origin-left rounded-full transition-transform duration-[720ms] ease-[var(--ease-out)]"
          style={{
            background: fill,
            transform: `scaleX(${grown && rate !== null ? rate / 100 : 0})`,
            transitionDelay: `${delay}ms`,
          }}
        />
      </div>
    </div>
  );
}

function gameResult(game: GameLogRow, line: number) {
  const value = Number(game.value);
  if (game.push === true || value === line) return 'push' as const;
  if (game.hit === true || (game.hit == null && value > line)) return 'hit' as const;
  return 'miss' as const;
}

function readableDate(value?: string) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

/**
 * Compact, real-observation L10 visualization. Unlike a generic progress bar,
 * every bar is one completed game from the research response. Hover/focus text
 * carries the exact value, opponent, date and minutes without crowding mobile.
 */
function L10GameStrip({
  games,
  line,
  hits,
  sample,
  rate,
}: {
  games: GameLogRow[];
  line: number;
  hits: number | null;
  sample: number | null;
  rate: number | null;
}) {
  const chronological = games.slice(0, 10).reverse();
  const values = chronological.map((game) => Number(game.value)).filter(Number.isFinite);
  const max = Math.max(line, ...values, 1);

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-[length:var(--fs-micro)] text-[var(--text-3)]">
        <span>Last 10 games</span>
        <span className="num text-[var(--text)]">
          {sample === null || hits === null ? `${chronological.length} games` : `${hits}/${sample}`}
          {rate === null ? '' : ` · ${rate}%`}
        </span>
      </div>

      <div
        className="grid h-9 grid-cols-10 items-end gap-1 rounded-[9px] border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-3)_72%,transparent)] px-1.5 pt-1.5 pb-1"
        aria-label={`Last ${chronological.length} game results against a line of ${line}`}
      >
        {chronological.map((game, index) => {
          const value = Number(game.value);
          const result = gameResult(game, line);
          const height = Math.max(24, Math.min(100, (value / max) * 100));
          const opponent = game.opponent || 'opponent unavailable';
          const minutes = game.minutes == null ? '' : ` · ${game.minutes} min`;
          const title = `${readableDate(game.date)} · ${opponent} · ${value}${minutes} · ${result}`;
          const background =
            result === 'hit'
              ? 'var(--accent)'
              : result === 'push'
                ? 'var(--warn)'
                : 'color-mix(in srgb, var(--neg) 72%, var(--surface-3))';

          return (
            <span
              key={game.gameId || `${game.date || 'game'}-${index}`}
              className="group relative flex h-full min-w-0 items-end"
              title={title}
              aria-label={title}
            >
              <span
                className="block w-full rounded-[3px] opacity-90 transition-[height,filter,opacity] duration-300 ease-[var(--ease-out)] group-hover:opacity-100 group-hover:brightness-110"
                style={{ height: `${height}%`, background }}
              />
            </span>
          );
        })}
        {Array.from({ length: Math.max(0, 10 - chronological.length) }).map((_, index) => (
          <span
            key={`empty-${index}`}
            className="block h-[24%] rounded-[3px] bg-[color-mix(in_srgb,var(--text)_8%,transparent)]"
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- prop card */

export type PropCardStats = {
  hits: number | null;
  sample: number | null;
  rate: number | null;
} | null;

/**
 * Dense mobile-first prop card inspired by the approved reference screens.
 * Every displayed line, book, matchup and percentage is still provider-backed.
 */
export function PropCard({
  group,
  stats,
  loading,
  onOpen,
  onPick,
  picked,
  delay = 0,
}: {
  group: PropGroup;
  stats: PropCardStats;
  loading?: boolean;
  onOpen: (group: PropGroup) => void;
  onPick?: (group: PropGroup, side: 'OVER' | 'UNDER') => void;
  picked?: 'OVER' | 'UNDER' | null;
  delay?: number;
}) {
  const club = teamFor(group.team);
  const kickoff = shortTime(group.startsAt);
  const bookCount = new Set(group.quotes.map((quote) => quote.sportsbookKey || quote.sportsbook).filter(Boolean)).size;
  const [recentGames, setRecentGames] = React.useState<GameLogRow[]>([]);

  React.useEffect(() => {
    setRecentGames([]);
    if (loading || !stats) return;

    const controller = new AbortController();
    fetchResearch(group, 'OVER', controller.signal)
      .then((research) => setRecentGames(playedGames(research).slice(0, 10)))
      .catch(() => setRecentGames([]));
    return () => controller.abort();
  }, [group.key, loading, stats]);

  return (
    <div className="face prop-card-v2">
      <TeamScene team={group.team} />

      <button
        type="button"
        onClick={() => onOpen(group)}
        className="prop-card-v2__open grid w-full text-left"
        aria-label={`Open ${group.player}, ${group.market} ${group.line}`}
      >
        <span className="prop-card-v2__identity flex items-center gap-3">
          <PlayerPortraits
            name={group.player}
            sport={group.sport}
            team={group.team}
            providerPlayerId={group.providerPlayerId}
            size={58}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[length:var(--fs-base)] font-semibold tracking-tight">
              {group.player}
            </span>
            <span className="prop-card-v2__meta mt-0.5 block truncate">
              {club.name} · {group.matchup}{kickoff ? ` · ${kickoff}` : ''}
            </span>
          </span>
          {group.live ? (
            <Badge variant="live">
              <Dot pulse />
              Live
            </Badge>
          ) : (
            <Badge>{group.sport}</Badge>
          )}
        </span>

        <span className="prop-card-v2__market-row border-t border-[var(--line)]">
          <span className="prop-card-v2__market-label min-w-0">
            <span className="truncate">{group.market}</span>
            <span>{bookCount ? `${bookCount} book${bookCount === 1 ? '' : 's'} available` : 'Book unavailable'}</span>
          </span>
          <span className="prop-card-v2__line num shrink-0 font-bold tracking-tight">
            {group.line}
          </span>
        </span>
      </button>

      <div className="prop-card-v2__hit">
        {loading ? (
          <span className="grid gap-[7px]">
            <span className="h-3 w-32 animate-pulse rounded bg-[var(--surface-3)]" />
            <span className="block h-9 animate-pulse rounded-[9px] bg-[var(--surface-3)]" />
          </span>
        ) : recentGames.length ? (
          <L10GameStrip
            games={recentGames}
            line={group.line}
            hits={stats?.hits ?? null}
            sample={stats?.sample ?? null}
            rate={stats?.rate ?? null}
          />
        ) : (
          <HitMeter
            label="L10 hit rate"
            hits={stats?.hits ?? null}
            sample={stats?.sample ?? null}
            rate={stats?.rate ?? null}
            delay={delay + 180}
          />
        )}
      </div>

      <div className="prop-card-v2__quotes grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {(['OVER', 'UNDER'] as const).map((side) => {
          const quote = side === 'OVER' ? group.bestOver : group.bestUnder;
          const isPicked = picked === side;
          const book = String(quote?.sportsbook || quote?.sportsbookKey || 'Unavailable');
          return (
            <button
              key={side}
              type="button"
              data-side={side}
              aria-pressed={isPicked}
              disabled={!quote}
              onClick={() => onPick?.(group, side)}
              className={cn(
                'prop-card-v2__quote flex items-center justify-between px-3',
                'border text-[length:var(--fs-xs)] font-semibold',
                'transition-[border-color,background-color,color,transform] duration-200 ease-[var(--ease-out)]',
                'active:scale-[.98] disabled:pointer-events-none disabled:opacity-40',
              )}
            >
              <span className="min-w-0 text-left">
                <span className="block truncate">{side === 'OVER' ? 'Over' : 'Under'}</span>
                <span className="prop-card-v2__book block max-w-[96px] truncate">{book}</span>
              </span>
              <span className="num shrink-0 text-[var(--text)]">{quote ? odds(quote.price) : '—'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Matches the real card's height so the grid does not jump when data lands. */
export function PropCardSkeleton() {
  return (
    <div className="face prop-card-v2">
      <div className="grid gap-4 p-4">
        <div className="flex items-center gap-3">
          <div className="size-[58px] shrink-0 animate-pulse rounded-[16px] bg-[var(--face-surface-2)]" />
          <div className="grid flex-1 gap-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--face-surface-2)]" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-[var(--face-surface-2)]" />
          </div>
        </div>
        <div className="h-8 animate-pulse rounded bg-[var(--face-surface-2)]" />
        <div className="h-9 animate-pulse rounded-[9px] bg-[var(--face-surface-2)]" />
      </div>
      <div className="grid grid-cols-2 gap-2 px-4 pb-4">
        <div className="h-12 animate-pulse rounded-[var(--radius-sm)] bg-[var(--face-surface-2)]" />
        <div className="h-12 animate-pulse rounded-[var(--radius-sm)] bg-[var(--face-surface-2)]" />
      </div>
    </div>
  );
}

```

---

## FILE: apps/oblige-web/components/motion.tsx

```tsx
'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Reveal-on-scroll. One shared observer for the whole page rather than one per
 * element, and the element is unobserved as soon as it has shown, so a long
 * board does not keep paying for cards the viewer has already scrolled past.
 */
function useReveal<T extends HTMLElement>(delay = 0) {
  const ref = React.useRef<T | null>(null);
  const [shown, setShown] = React.useState(false);

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (prefersReducedMotion()) {
      setShown(true);
      return;
    }
    // Anything already on screen at mount shows immediately: waiting for an
    // intersection callback would blank the first paint.
    if (node.getBoundingClientRect().top < window.innerHeight) {
      const timer = window.setTimeout(() => setShown(true), 16);
      return () => window.clearTimeout(timer);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.06 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [delay]);

  return { ref, shown };
}

export function Reveal({
  delay = 0,
  className,
  as: Tag = 'div',
  children,
  style,
  ...props
}: React.HTMLAttributes<HTMLElement> & { delay?: number; as?: 'div' | 'section' | 'li' }) {
  const { ref, shown } = useReveal<HTMLElement>(delay);
  return (
    <Tag
      ref={ref as React.Ref<never>}
      data-shown={shown}
      className={cn('rv', className)}
      style={{ ['--d' as string]: `${delay}ms`, ...style }}
      {...props}
    >
      {children}
    </Tag>
  );
}

/** Counts once on entry, and lands on the real figure immediately when the
 *  viewer has asked for reduced motion. */
export function CountUp({
  to,
  duration = 1100,
  className,
}: {
  to: number;
  duration?: number;
  className?: string;
}) {
  const ref = React.useRef<HTMLSpanElement | null>(null);
  const [value, setValue] = React.useState(0);
  const done = React.useRef(false);

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (prefersReducedMotion()) {
      setValue(to);
      return;
    }
    let frame = 0;
    const run = () => {
      if (done.current) return;
      done.current = true;
      const started = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - started) / duration);
        const eased = 1 - (1 - progress) ** 3;
        setValue(Math.round(to * eased));
        if (progress < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.isIntersecting && run()),
      { threshold: 0.5 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [to, duration]);

  return (
    <span ref={ref} className={cn('num', className)}>
      {value.toLocaleString()}
    </span>
  );
}

```

---

## FILE: apps/oblige-web/components/player-view.tsx

```tsx
'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, TriangleAlert } from 'lucide-react';
import type { PropGroup, ResearchResponse } from '@/lib/types';
import { ApiError, fetchAccount, fetchBoard, fetchResearch, playedGames } from '@/lib/api';
import {
  computeWindow,
  headToHead,
  playable,
  sortRecentFirst,
  type Side,
} from '@/lib/analytics';
import { teamFor } from '@/lib/teams';
import { cn, odds, shortTime } from '@/lib/utils';
import { Badge, Dot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CardPanel } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PlayerAvatar, TeamScene } from '@/components/face-card';
import { BookPrices } from '@/components/book-prices';
import { GameLog } from '@/components/research';
import { PropExplorer, type ExplorerState } from '@/components/prop-explorer';
import { SignInPanel } from '@/components/sign-in';
import { Reveal } from '@/components/motion';

const DERIVED_MARKET =
  /(?:\b(?:1q|2q|3q|4q|1h|2h)\b)|quarter|first half|second half|first inning|1st inning|fantasy/i;

const FAVOURITES_KEY = 'oblige-followed';

type PlayerSection = 'overview' | 'props' | 'trends' | 'splits';

const PLAYER_SECTIONS: { id: PlayerSection; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'props', label: 'Props' },
  { id: 'trends', label: 'Trends' },
  { id: 'splits', label: 'Splits' },
];

function readFavourites(): string[] {
  try {
    const raw = localStorage.getItem(FAVOURITES_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function PlayerView() {
  const router = useRouter();
  const params = useSearchParams();
  const sport = params.get('sport') || 'NFL';
  const player = params.get('player') || '';
  const market = params.get('market') || '';
  const lineParam = Number(params.get('line'));
  const postedLine = Number.isFinite(lineParam) ? lineParam : null;

  const [account, setAccount] = React.useState<{ id: string; email?: string } | null>(null);
  const [checking, setChecking] = React.useState(true);
  const [markets, setMarkets] = React.useState<PropGroup[]>([]);
  const [research, setResearch] = React.useState<ResearchResponse | null>(null);
  const [loadingBoard, setLoadingBoard] = React.useState(true);
  const [loadingResearch, setLoadingResearch] = React.useState(true);
  const [error, setError] = React.useState('');
  const [favourites, setFavourites] = React.useState<string[]>([]);
  const [section, setSection] = React.useState<PlayerSection>('overview');

  React.useEffect(() => {
    const controller = new AbortController();
    fetchAccount(controller.signal)
      .then(setAccount)
      .finally(() => setChecking(false));
    setFavourites(readFavourites());
    return () => controller.abort();
  }, []);

  React.useEffect(() => {
    if (checking || !account || !player) {
      setLoadingBoard(false);
      return;
    }
    const controller = new AbortController();
    setLoadingBoard(true);
    setError('');
    fetchBoard(sport, controller.signal)
      .then((board) => {
        const mine = board.groups.filter((candidate) => candidate.player === player);
        if (!mine.length) setError(`${player} is not on the ${sport} board right now.`);
        setMarkets(mine);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 401) {
          setAccount(null);
          return;
        }
        setError(cause instanceof Error ? cause.message : 'The board is unavailable.');
      })
      .finally(() => setLoadingBoard(false));
    return () => controller.abort();
  }, [checking, account, sport, player]);

  const group = React.useMemo(() => {
    if (!markets.length) return null;
    return (
      markets.find((candidate) => candidate.market === market && candidate.line === postedLine) ||
      markets.find((candidate) => candidate.market === market) ||
      markets[0]
    );
  }, [markets, market, postedLine]);

  const derived = group ? DERIVED_MARKET.test(group.market) : false;
  const [state, setState] = React.useState<ExplorerState>({ line: 0, side: 'OVER', book: null });

  React.useEffect(() => {
    if (!group) return;
    setState({ line: group.line, side: 'OVER', book: null });
    setSection('overview');
  }, [group?.key, group?.line]);

  React.useEffect(() => {
    if (!group) return;
    if (derived) {
      setResearch(null);
      setLoadingResearch(false);
      return;
    }
    const controller = new AbortController();
    setLoadingResearch(true);
    fetchResearch(group, state.side, controller.signal)
      .then(setResearch)
      .catch(() => setResearch(null))
      .finally(() => setLoadingResearch(false));
    return () => controller.abort();
    // The game sample is the same for Over and Under; line/side changes are
    // recalculated client-side so they do not create extra provider requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.key, derived]);

  function selectMarket(next: PropGroup) {
    const search = new URLSearchParams({
      sport: next.sport,
      player: next.player,
      market: next.market,
      line: String(next.line),
    });
    router.replace(`/research?${search}`, { scroll: false });
  }

  function selectSection(next: PlayerSection) {
    setSection(next);
    requestAnimationFrame(() => {
      document.getElementById(`player-${next}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function toggleFavourite(key: string) {
    setFavourites((prev) => {
      const next = prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key];
      try {
        localStorage.setItem(FAVOURITES_KEY, JSON.stringify(next));
      } catch {
        /* a followed prop is a per-device convenience, never required */
      }
      return next;
    });
  }

  if (checking) {
    return (
      <Shell>
        <Skeleton className="mt-4 h-40 rounded-[var(--radius-lg)]" />
      </Shell>
    );
  }
  if (!account) {
    return (
      <Shell>
        <SignInPanel onSignedIn={setAccount} />
      </Shell>
    );
  }
  if (!player) {
    return (
      <Shell>
        <Empty
          title="Pick a prop to research"
          body="Open any card on the board and its markets, history, splits and book prices land here."
        />
      </Shell>
    );
  }
  if (loadingBoard && !group) {
    return (
      <Shell>
        <Skeleton className="mt-4 h-40 rounded-[var(--radius-lg)]" />
        <Skeleton className="mt-4 h-12 rounded-full" />
        <Skeleton className="mt-4 h-[460px] rounded-[var(--radius)]" />
      </Shell>
    );
  }
  if (!group) {
    return (
      <Shell>
        <Empty
          title="That prop is no longer posted"
          body={error || 'The market may have settled or been pulled from the board.'}
        />
      </Shell>
    );
  }

  const club = teamFor(group.team);
  const kickoff = shortTime(group.startsAt);
  const games = playedGames(research);
  const favourite = favourites.includes(group.key);

  return (
    <Shell>
      <section id="player-overview" className="player-section-anchor">
        <Reveal>
          <div className="face player-cinematic-hero mt-4 p-5 md:p-6">
            <TeamScene team={group.team} tall />
            <div className="player-identity-row flex flex-wrap items-center gap-4">
              <span className="relative flex-none">
                <PlayerAvatar
                  name={group.player}
                  sport={group.sport}
                  team={group.team}
                  providerPlayerId={group.providerPlayerId}
                  size={82}
                />
                <span
                  aria-hidden="true"
                  className="absolute -right-1 -bottom-1 grid size-7 place-items-center rounded-full border-2 border-[var(--face-1)] text-[9px] font-extrabold text-white"
                  style={{ background: club.c1 }}
                >
                  {(group.team || '—').slice(0, 3)}
                </span>
              </span>

              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge size="md">{group.sport}</Badge>
                  {group.live && (
                    <Badge variant="live" size="md">
                      <Dot pulse />
                      Live
                    </Badge>
                  )}
                </div>
                <h1
                  className="text-[length:var(--fs-xl)] text-balance sm:text-[length:var(--fs-2xl)]"
                  style={{ textTransform: 'var(--display-case)' as 'none' }}
                >
                  {group.player}
                </h1>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[length:var(--fs-xs)] text-[var(--face-text-2)] sm:text-[length:var(--fs-sm)]">
                  <span className="truncate font-semibold">{club.name}</span>
                  <span aria-hidden="true">·</span>
                  <span>{group.matchup}</span>
                  {kickoff && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{kickoff}</span>
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="player-line-glance mt-5 grid gap-3 rounded-[var(--radius)] border border-[var(--face-line)] bg-[color-mix(in_srgb,var(--face-1)_72%,transparent)] p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <p className="truncate text-[length:var(--fs-sm)] font-semibold">{group.market}</p>
                <p className="mt-1 text-[length:var(--fs-micro)] text-[var(--face-text-3)]">
                  Best of {new Set(group.quotes.map((q) => q.sportsbookKey || q.sportsbook)).size} books
                </p>
              </div>
              <div className="flex items-center justify-between gap-5 sm:justify-end">
                <span className="num text-[length:var(--fs-2xl)] font-bold tracking-tight">{group.line}</span>
                <span className="grid gap-1 text-right">
                  <span className="num text-[length:var(--fs-sm)] font-semibold text-[var(--face-pos)]">
                    O {odds(group.bestOver?.price)}
                  </span>
                  <span className="num text-[length:var(--fs-sm)] font-semibold text-[var(--face-neg)]">
                    U {odds(group.bestUnder?.price)}
                  </span>
                </span>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      <PlayerSectionNav active={section} onSelect={selectSection} />

      <section id="player-props" className="player-section-anchor player-section-block">
        <div className="player-section-heading">
          <div>
            <span className="player-section-kicker">Prop markets</span>
            <h2>Choose the number you want to research.</h2>
          </div>
          <span className="player-section-count">{markets.length} market{markets.length === 1 ? '' : 's'}</span>
        </div>
        <div className="rail player-market-rail" role="tablist" aria-label="Markets for this player">
          {markets.map((candidate) => {
            const active = candidate.key === group.key;
            return (
              <button
                key={candidate.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => selectMarket(candidate)}
                className={cn(
                  'flex min-h-11 flex-none items-center gap-2 rounded-full border px-4',
                  'text-[length:var(--fs-xs)] font-semibold whitespace-nowrap',
                  'transition-[color,background-color,border-color,transform] duration-200 ease-[var(--ease-out)] active:scale-[.97]',
                  active
                    ? 'border-transparent bg-[var(--accent)] text-[var(--accent-ink)]'
                    : 'border-[var(--line)] bg-[var(--surface)] text-[var(--text-2)] hover:border-[var(--line-strong)] hover:text-[var(--text)]',
                )}
              >
                {candidate.market}
                <span className={cn('num', active ? 'opacity-80' : 'text-[var(--text-3)]')}>
                  {candidate.line}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section id="player-trends" className="player-section-anchor player-section-block">
        <div className="player-section-heading">
          <div>
            <span className="player-section-kicker">Interactive research</span>
            <h2>Move the line. Change the side. Recalculate instantly.</h2>
          </div>
          <span className="player-section-count">No extra provider calls</span>
        </div>
        <Reveal>
          <CardPanel className="player-explorer-panel p-4 sm:p-5">
            <PropExplorer
              group={group}
              games={games}
              loading={loadingResearch}
              unavailableReason={
                derived
                  ? 'A first-half, quarter or fantasy-score number cannot be rebuilt from a full-game box score, so Oblige does not try. This market is priced live, and every book above is real — there is simply no verified history behind it.'
                  : research && research.available === false
                    ? research.message || 'No verified game log is available for this player and market yet.'
                    : null
              }
              state={state}
              onState={setState}
              favourite={favourite}
              onFavourite={() => toggleFavourite(group.key)}
            />
          </CardPanel>
        </Reveal>

        {research?.available === false && !derived && !loadingResearch && (
          <p className="mt-4 flex items-start gap-2 rounded-[var(--radius)] border border-[color-mix(in_srgb,var(--warn)_36%,transparent)] bg-[color-mix(in_srgb,var(--warn)_8%,transparent)] p-3 text-[length:var(--fs-sm)] text-[var(--warn)]">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {research.message || 'No verified history is available for this player and market yet.'}
          </p>
        )}
      </section>

      <section id="player-splits" className="player-section-anchor player-section-block">
        <div className="player-section-heading">
          <div>
            <span className="player-section-kicker">Context splits</span>
            <h2>See where the current line has actually worked.</h2>
          </div>
          <span className="player-section-count">{state.side} {state.line}</span>
        </div>
        <SplitSummary
          games={games}
          group={group}
          line={state.line}
          side={state.side}
          loading={loadingResearch && !derived}
        />
      </section>

      <section className="player-detail-grid mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)] lg:items-start">
        <div className="min-w-0">
          <Reveal>
            <GameLog
              games={games}
              line={state.line}
              market={group.market}
              loading={loadingResearch && !derived}
            />
          </Reveal>
        </div>
        <div className="min-w-0">
          <Reveal>
            <BookPrices group={group} />
          </Reveal>
        </div>
      </section>
    </Shell>
  );
}

function PlayerSectionNav({
  active,
  onSelect,
}: {
  active: PlayerSection;
  onSelect: (section: PlayerSection) => void;
}) {
  return (
    <nav className="player-section-nav" aria-label="Player analysis sections">
      {PLAYER_SECTIONS.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={active === item.id}
          onClick={() => onSelect(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}

function SplitSummary({
  games,
  group,
  line,
  side,
  loading,
}: {
  games: ReturnType<typeof playedGames>;
  group: PropGroup;
  line: number;
  side: Side;
  loading: boolean;
}) {
  if (loading) {
    return <Skeleton className="h-[116px] rounded-[var(--radius)]" />;
  }

  const rows = sortRecentFirst(playable(games));
  const home = computeWindow(rows.filter((game) => game.isHome === true), line, side, 'home', 'Home');
  const away = computeWindow(rows.filter((game) => game.isHome === false), line, side, 'away', 'Away');
  const h2h = headToHead(rows, group.opponent, line, side);
  const splits = [home, away, h2h || computeWindow([], line, side, 'h2h', 'H2H')];

  return (
    <div className="player-split-grid">
      {splits.map((split) => {
        const rate = split.hitRate;
        const tone = rate === null ? 'none' : rate >= 60 ? 'pos' : rate < 45 ? 'neg' : 'mid';
        return (
          <article key={split.id} className="player-split-card" data-tone={tone}>
            <div className="player-split-topline">
              <span>{split.label}</span>
              <span className="num">{split.games ? `${split.hits}/${split.games}` : 'No sample'}</span>
            </div>
            <strong className="num">{rate === null ? '—' : `${rate}%`}</strong>
            <div className="player-split-meta">
              <span>{split.average === null ? 'Average unavailable' : `Avg ${split.average}`}</span>
              {split.id === 'h2h' && group.opponent ? <span>vs {group.opponent}</span> : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="player-app-shell mx-auto w-full max-w-[var(--maxw)] px-4 pt-5 pb-20 md:px-8">
      <Link
        href="/board"
        className="player-back-link inline-flex min-h-10 items-center gap-2 text-[length:var(--fs-sm)] text-[var(--text-2)] transition-colors duration-200 ease-[var(--ease-out)] hover:text-[var(--text)]"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Back to board
      </Link>
      {children}
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <CardPanel className="mt-4 grid justify-items-center gap-3 py-16 text-center">
      <h1 className="text-[length:var(--fs-md)] normal-case">{title}</h1>
      <p className="max-w-[48ch] text-[length:var(--fs-sm)] text-[var(--text-3)]">{body}</p>
      <Button asChild variant="ghost" size="sm">
        <Link href="/board">Open the board</Link>
      </Button>
    </CardPanel>
  );
}

```

---

## FILE: apps/oblige-web/components/prop-explorer.tsx

```tsx
'use client';

import * as React from 'react';
import { ChevronDown, Minus, Plus, RotateCcw, Star } from 'lucide-react';
import type { GameLogRow, PropGroup, PropRow } from '@/lib/types';
import {
  applyFilters,
  buildWindows,
  computeWindow,
  distinct,
  EMPTY_FILTERS,
  filtersActive,
  headToHead,
  playable,
  sampleFor,
  sortRecentFirst,
  streakOf,
  type SampleFilters,
  type SampleId,
  type Side,
  type Window,
} from '@/lib/analytics';
import { cn, odds, shortDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

/* --------------------------------------------------------------- controls */

function Stepper({
  value,
  step,
  onChange,
  posted,
}: {
  value: number;
  step: number;
  onChange: (value: number) => void;
  posted: number;
}) {
  const moved = Math.round((value - posted) * 100) / 100;
  return (
    <div className="flex items-center overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-[var(--surface-2)]">
      <button
        type="button"
        onClick={() => onChange(Math.max(0, Math.round((value - step) * 100) / 100))}
        aria-label={`Lower the line to ${Math.max(0, value - step)}`}
        className="grid size-12 place-items-center text-[var(--text-2)] transition-colors duration-200 hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
      >
        <Minus className="size-4" strokeWidth={2.4} aria-hidden="true" />
      </button>
      <output
        aria-live="polite"
        className={cn(
          'num min-w-[86px] border-x border-[var(--line)] px-2 py-3 text-center',
          'text-[length:var(--fs-md)] font-bold',
          moved !== 0 && 'text-[var(--warn)]',
        )}
      >
        {value}
      </output>
      <button
        type="button"
        onClick={() => onChange(Math.round((value + step) * 100) / 100)}
        aria-label={`Raise the line to ${value + step}`}
        className="grid size-12 place-items-center text-[var(--text-2)] transition-colors duration-200 hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
      >
        <Plus className="size-4" strokeWidth={2.4} aria-hidden="true" />
      </button>
    </div>
  );
}

function SidePicker({ side, onChange }: { side: Side; onChange: (side: Side) => void }) {
  return (
    <div
      role="group"
      aria-label="Side"
      className="flex overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-[var(--surface-2)]"
    >
      {(['OVER', 'UNDER'] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={side === option}
          onClick={() => onChange(option)}
          className={cn(
            'min-h-12 px-4 text-[length:var(--fs-sm)] font-bold tracking-wide',
            'transition-[color,background-color,box-shadow] duration-200 ease-[var(--ease-out)]',
            'first:border-r first:border-[var(--line)]',
            side !== option && 'text-[var(--text-3)] hover:text-[var(--text)]',
            side === option &&
              option === 'OVER' &&
              'bg-[color-mix(in_srgb,var(--pos)_14%,transparent)] text-[var(--pos)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--pos)_55%,transparent)]',
            side === option &&
              option === 'UNDER' &&
              'bg-[color-mix(in_srgb,var(--neg)_14%,transparent)] text-[var(--neg)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--neg)_55%,transparent)]',
          )}
        >
          {option === 'OVER' ? 'O' : 'U'}
          <span className="ml-1.5 hidden sm:inline">{option === 'OVER' ? 'Over' : 'Under'}</span>
        </button>
      ))}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const id = React.useId();
  return (
    <div className="grid min-w-0 gap-1.5">
      <span id={id} className="text-[length:var(--fs-micro)] text-[var(--text-3)]">
        {label}
      </span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-labelledby={id} className="min-h-11">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/* ------------------------------------------------------------ sample strip */

function SampleChip({
  window,
  active,
  onSelect,
  suffix,
}: {
  window: Window;
  active: boolean;
  onSelect: () => void;
  suffix?: string;
}) {
  const rate = window.hitRate;
  const tone = rate === null ? 'none' : rate >= 60 ? 'pos' : rate < 45 ? 'neg' : 'mid';
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        'grid min-w-0 flex-1 gap-1 rounded-[var(--radius-sm)] border px-3 py-2.5 text-left',
        'transition-[border-color,background-color,transform] duration-200 ease-[var(--ease-out)]',
        'active:scale-[.98]',
        active
          ? 'border-[var(--line-strong)] bg-[var(--surface-3)] shadow-[var(--shadow-1)]'
          : 'border-transparent bg-transparent hover:bg-[var(--surface-2)]',
      )}
    >
      <span className="text-[length:var(--fs-xs)] font-bold tracking-wide text-[var(--text)]">
        {window.label}
      </span>
      <span
        className={cn(
          'num text-[length:var(--fs-xs)] font-semibold',
          tone === 'pos' && 'text-[var(--pos)]',
          tone === 'neg' && 'text-[var(--neg)]',
          tone === 'mid' && 'text-[var(--warn)]',
          tone === 'none' && 'text-[var(--text-3)]',
        )}
      >
        {rate === null ? 'No games' : `HR ${rate}%`}
      </span>
      <span className="num truncate text-[length:var(--fs-micro)] text-[var(--text-3)]">
        {window.average === null ? '—' : `${suffix ? `${suffix} ` : ''}Avg ${window.average}`}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ chart */

function ValueChart({
  games,
  line,
  side,
}: {
  games: GameLogRow[];
  line: number;
  side: Side;
}) {
  const [grown, setGrown] = React.useState(false);
  React.useEffect(() => {
    setGrown(false);
    const timer = window.setTimeout(() => setGrown(true), 40);
    return () => window.clearTimeout(timer);
  }, [games, line, side]);

  // Oldest on the left, so the run reads left to right like a timeline.
  const shown = [...games].reverse();
  const values = shown.map((game) => Number(game.value)).filter(Number.isFinite);
  if (!shown.length || !values.length) {
    return (
      <p className="py-14 text-center text-[length:var(--fs-sm)] text-[var(--text-3)]">
        No games match these filters.
      </p>
    );
  }

  const max = Math.max(...values, line) * 1.22;
  const height = 210;

  return (
    <div className="min-w-0">
      <div className="relative min-w-0 pt-7">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 z-10 h-0 border-t-2 border-dashed border-[var(--text-3)] opacity-70"
          style={{ bottom: (line / max) * height + 24 }}
        />
        <div
          className="grid min-w-0 grid-flow-col items-end gap-1 sm:gap-1.5"
          style={{ height, gridAutoColumns: 'minmax(0,1fr)' }}
        >
          {shown.map((game, index) => {
            const value = Number(game.value);
            const push = value === line;
            const hit = !push && (side === 'UNDER' ? value < line : value > line);
            const barHeight = Math.max(6, (value / max) * height);
            return (
              <div key={game.gameId || `${game.date}-${index}`} className="grid h-full min-w-0 content-end">
                <span
                  className={cn(
                    'num mb-1 truncate text-center text-[10px] font-bold sm:text-[length:var(--fs-micro)]',
                    push
                      ? 'text-[var(--text-3)]'
                      : hit
                        ? 'text-[var(--pos)]'
                        : 'text-[var(--neg)]',
                    'transition-opacity duration-300 ease-[var(--ease-out)]',
                    grown ? 'opacity-100' : 'opacity-0',
                  )}
                  style={{ transitionDelay: `${160 + index * 34}ms` }}
                >
                  {value}
                </span>
                <span
                  title={`${game.isHome === false ? '@ ' : ''}${game.opponent || '—'} · ${shortDate(game.date)} · ${value}`}
                  className={cn(
                    'block origin-bottom rounded-t-[5px]',
                    'transition-transform duration-[480ms] ease-[var(--ease-spring)]',
                    push
                      ? 'bg-[var(--surface-3)]'
                      : hit
                        ? 'bg-[linear-gradient(180deg,color-mix(in_srgb,var(--pos)_92%,white),var(--pos))]'
                        : 'bg-[linear-gradient(180deg,color-mix(in_srgb,var(--neg)_78%,white),color-mix(in_srgb,var(--neg)_82%,var(--surface-3)))]',
                  )}
                  style={{
                    height: barHeight,
                    transform: grown ? 'scaleY(1)' : 'scaleY(0)',
                    transitionDelay: `${index * 34}ms`,
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div
        className="mt-2 grid min-w-0 grid-flow-col gap-1 sm:gap-1.5"
        style={{ gridAutoColumns: 'minmax(0,1fr)' }}
      >
        {shown.map((game, index) => (
          <span
            key={game.gameId || `x-${index}`}
            className="min-w-0 overflow-hidden text-center text-[9px] font-medium whitespace-nowrap text-[var(--text-3)] sm:text-[length:var(--fs-micro)]"
          >
            {game.isHome === false ? '@' : ''}
            {game.opponent || '—'}
          </span>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- explorer */

export type ExplorerState = { line: number; side: Side; book: string | null };

/**
 * The working surface for one prop: move the line, switch side, pick a book,
 * narrow the sample, and watch every number and every bar move with it.
 *
 * Everything here is recomputed from the game log the research route returned,
 * on the reader's own machine — so the stepper and the filters are instant and
 * cost the rate-limited research route nothing.
 */
export function PropExplorer({
  group,
  games,
  loading,
  unavailableReason,
  state,
  onState,
  favourite,
  onFavourite,
}: {
  group: PropGroup;
  games: GameLogRow[];
  loading?: boolean;
  unavailableReason?: string | null;
  state: ExplorerState;
  onState: (next: ExplorerState) => void;
  favourite: boolean;
  onFavourite: () => void;
}) {
  const [filters, setFilters] = React.useState<SampleFilters>(EMPTY_FILTERS);
  const [sample, setSample] = React.useState<SampleId>('l10');

  // A different prop is a different sample; start it clean.
  React.useEffect(() => {
    setFilters(EMPTY_FILTERS);
    setSample('l10');
  }, [group.key]);

  const played = React.useMemo(() => sortRecentFirst(playable(games)), [games]);
  const filtered = React.useMemo(() => applyFilters(played, filters), [played, filters]);
  const opponentCode = group.opponent || null;

  const windows = React.useMemo(
    () => buildWindows(filtered, state.line, state.side),
    [filtered, state.line, state.side],
  );
  const h2h = React.useMemo(
    () => headToHead(played, opponentCode, state.line, state.side),
    [played, opponentCode, state.line, state.side],
  );
  const streak = React.useMemo(
    () => streakOf(filtered, state.line, state.side),
    [filtered, state.line, state.side],
  );

  const chartGames = React.useMemo(
    () => (sample === 'h2h' ? sampleFor(played, 'h2h', opponentCode) : sampleFor(filtered, sample, opponentCode)),
    [played, filtered, sample, opponentCode],
  );
  const chartWindow = React.useMemo(
    () => computeWindow(chartGames, state.line, state.side, 'chart', 'Shown', undefined),
    [chartGames, state.line, state.side],
  );

  /* Filter choices come from the sample itself, so a dropdown never offers an
     opponent or a season this player has no games against. */
  const opponents = React.useMemo(
    () => distinct(played.map((game) => game.opponent)).sort(),
    [played],
  );
  const seasons = React.useMemo(
    () => distinct(played.map((game) => (game.season == null ? null : String(game.season)))).sort().reverse(),
    [played],
  );

  const books = React.useMemo(() => {
    const seen = new Map<string, { key: string; name: string; over: PropRow | null; under: PropRow | null }>();
    for (const quote of group.quotes) {
      const name = String(quote.sportsbook || quote.sportsbookKey || '').trim();
      if (!name) continue;
      const key = (quote.sportsbookKey || name).toLowerCase();
      if (!seen.has(key)) seen.set(key, { key, name, over: null, under: null });
      const row = seen.get(key)!;
      const price = Number(quote.price);
      if (!Number.isFinite(price)) continue;
      if (String(quote.side || '').toUpperCase() === 'OVER' && (!row.over || price > Number(row.over.price))) row.over = quote;
      if (String(quote.side || '').toUpperCase() === 'UNDER' && (!row.under || price > Number(row.under.price))) row.under = quote;
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [group.quotes]);

  const activeBook = books.find((book) => book.key === state.book) || books[0] || null;
  const lineStep = group.line < 12 ? 0.5 : group.line < 60 ? 0.5 : 0.5;
  const moved = Math.round((state.line - group.line) * 100) / 100;

  return (
    <div className="grid gap-5">
      {/* line, side, book, favourite */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <Stepper
          value={state.line}
          step={lineStep}
          posted={group.line}
          onChange={(line) => onState({ ...state, line })}
        />
        <SidePicker side={state.side} onChange={(side) => onState({ ...state, side })} />

        {books.length > 0 && (
          <div className="grid min-w-0 gap-1.5">
            <Select
              value={activeBook?.key ?? ''}
              onValueChange={(book) => onState({ ...state, book })}
            >
              <SelectTrigger aria-label="Sportsbook" className="min-h-12 min-w-[190px]">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="truncate">{activeBook?.name}</span>
                  <span className="num flex shrink-0 gap-2 text-[length:var(--fs-xs)]">
                    <span className="text-[var(--pos)]">O {odds(activeBook?.over?.price)}</span>
                    <span className="text-[var(--neg)]">U {odds(activeBook?.under?.price)}</span>
                  </span>
                </span>
              </SelectTrigger>
              <SelectContent>
                {books.map((book) => (
                  <SelectItem key={book.key} value={book.key}>
                    {book.name} · O {odds(book.over?.price)} / U {odds(book.under?.price)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <button
          type="button"
          aria-pressed={favourite}
          onClick={onFavourite}
          aria-label={favourite ? `Unfollow ${group.player}` : `Follow ${group.player}`}
          className={cn(
            'grid size-12 place-items-center rounded-[var(--radius)] border',
            'transition-[color,border-color,background-color,transform] duration-200 ease-[var(--ease-out)] active:scale-[.94]',
            favourite
              ? 'border-[color-mix(in_srgb,var(--warn)_55%,transparent)] bg-[color-mix(in_srgb,var(--warn)_14%,transparent)] text-[var(--warn)]'
              : 'border-[var(--line)] bg-[var(--surface-2)] text-[var(--text-3)] hover:border-[var(--line-strong)] hover:text-[var(--text)]',
          )}
        >
          <Star className="size-5" fill={favourite ? 'currentColor' : 'none'} aria-hidden="true" />
        </button>
      </div>

      {moved !== 0 && (
        <p className="-mt-2 flex flex-wrap items-center gap-2 text-[length:var(--fs-xs)] text-[var(--warn)]">
          Reading against {state.line}, not the posted {group.line}.
          <button
            type="button"
            onClick={() => onState({ ...state, line: group.line })}
            className="font-semibold underline underline-offset-4"
          >
            Back to the posted line
          </button>
        </p>
      )}

      {/* sample filters */}
      <div className="grid gap-3">
        <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
          <FilterSelect
            label="Opponent"
            value={filters.opponent}
            onChange={(opponent) => setFilters((prev) => ({ ...prev, opponent }))}
            options={[
              { value: 'all', label: 'All' },
              ...opponents.map((code) => ({ value: code, label: code })),
            ]}
          />
          <FilterSelect
            label="Season"
            value={filters.season}
            onChange={(season) => setFilters((prev) => ({ ...prev, season }))}
            options={[
              { value: 'all', label: 'All' },
              ...seasons.map((season) => ({ value: season, label: season })),
            ]}
          />
          <FilterSelect
            label="Home / Away"
            value={filters.venue}
            onChange={(venue) => setFilters((prev) => ({ ...prev, venue: venue as SampleFilters['venue'] }))}
            options={[
              { value: 'all', label: 'All' },
              { value: 'home', label: 'Home' },
              { value: 'away', label: 'Away' },
            ]}
          />
          <Button
            variant="ghost"
            size="md"
            disabled={!filtersActive(filters)}
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="col-span-2 sm:col-span-1"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            Reset
          </Button>
        </div>
        {filtersActive(filters) && (
          <p className="text-[length:var(--fs-xs)] text-[var(--text-3)]">
            {filtered.length} of {played.length} games match.
          </p>
        )}
      </div>

      {/* windows */}
      {loading ? (
        <Skeleton className="h-[86px] rounded-[var(--radius)]" />
      ) : (
        <div className="rail gap-1 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--surface-2)] p-1.5">
          {windows.map((window) => (
            <SampleChip
              key={window.id}
              window={window}
              active={sample === window.id}
              onSelect={() => setSample(window.id as SampleId)}
            />
          ))}
          {h2h && (
            <SampleChip
              window={{ ...h2h, label: `vs ${opponentCode}` }}
              active={sample === 'h2h'}
              onSelect={() => setSample('h2h')}
              suffix={`${h2h.games}G`}
            />
          )}
        </div>
      )}

      {/* chart */}
      {loading ? (
        <Skeleton className="h-[260px] rounded-[var(--radius)]" />
      ) : unavailableReason ? (
        <div className="grid justify-items-center gap-2 rounded-[var(--radius)] border border-dashed border-[var(--line-strong)] px-6 py-14 text-center">
          <p className="text-[length:var(--fs-sm)] font-semibold">No game history for this market</p>
          <p className="max-w-[54ch] text-[length:var(--fs-sm)] leading-relaxed text-[var(--text-3)]">
            {unavailableReason}
          </p>
        </div>
      ) : (
        <>
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="text-[length:var(--fs-sm)] font-semibold normal-case">
              {chartGames.length} game{chartGames.length === 1 ? '' : 's'} shown
            </h3>
            {/* separate spans rather than one long string, so a narrow panel
                wraps the summary instead of clipping the end of it */}
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-[length:var(--fs-xs)] text-[var(--text-3)]">
              {chartWindow.hitRate === null ? (
                <span>No sample</span>
              ) : (
                <>
                  <span className="num">
                    {chartWindow.hits}/{chartWindow.games}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="num">{chartWindow.hitRate}%</span>
                  <span aria-hidden="true">·</span>
                  <span className="num">avg {chartWindow.average}</span>
                </>
              )}
              {streak && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="num">
                    {streak.count} straight {streak.over ? 'over' : 'under'}
                  </span>
                </>
              )}
            </div>
          </div>
          <ValueChart games={chartGames} line={state.line} side={state.side} />
        </>
      )}
    </div>
  );
}

```

---

## FILE: apps/oblige-web/components/research.tsx

```tsx
'use client';

import * as React from 'react';
import { Check, Minus, X } from 'lucide-react';
import type { GameLogRow, ResearchResponse, Side } from '@/lib/types';
import { splitOf, streakOf, windowOf } from '@/lib/api';
import { cn, pctValue, shortDate, signed } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardPanel } from '@/components/ui/card';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';

/* ------------------------------------------------------------- stat strip */

type Stat = { key: string; value: string; sub: string; tone?: 'pos' | 'neg' };

/**
 * L5 / L10 / L15 / H2H / streak / average / difference — the seven numbers a
 * prop is actually judged on. Every one comes from the research payload, and a
 * window the provider could not fill shows an em dash rather than a zero,
 * because "no sample" and "never hit" are not the same answer.
 */
export function StatStrip({
  research,
  line,
  loading,
}: {
  research: ResearchResponse | null;
  line: number;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="mt-4 grid grid-cols-4 gap-2 md:grid-cols-7">
        {Array.from({ length: 7 }).map((_, index) => (
          <Skeleton key={index} className="h-20 rounded-[var(--radius)]" />
        ))}
      </div>
    );
  }

  const last5 = windowOf(research, 'last5', 'l5', 'lastFive');
  const last10 = windowOf(research, 'last10', 'l10', 'lastTen');
  const season = windowOf(research, 'season', 'last15', 'l15');
  const h2h = research?.h2h ?? null;
  const streak = streakOf(research);
  const average = season?.average ?? last10?.average ?? null;
  const diff = research?.diff ?? (average === null ? null : average - line);

  const rateStat = (key: string, w: typeof last5, fallbackSub: string): Stat => {
    const rate = pctValue(w?.hitRate ?? null);
    const hits = w?.hits ?? null;
    const sample = w?.sampleSize ?? w?.games ?? null;
    return {
      key,
      value: rate === null ? '—' : `${rate}%`,
      sub: hits !== null && sample !== null ? `${hits}/${sample}` : fallbackSub,
      tone: rate === null ? undefined : rate >= 60 ? 'pos' : rate < 45 ? 'neg' : undefined,
    };
  };

  const stats: Stat[] = [
    rateStat('L5', last5, 'no sample'),
    rateStat('L10', last10, 'no sample'),
    rateStat('Season', season, 'no sample'),
    rateStat('H2H', h2h, 'vs opponent'),
    {
      key: 'Streak',
      value: streak ? String(streak.count) : '—',
      sub: streak ? (streak.over ? 'straight over' : 'straight under') : 'no streak',
      tone: streak ? (streak.over ? 'pos' : 'neg') : undefined,
    },
    {
      key: 'Avg',
      value: average === null ? '—' : Number(average).toFixed(1),
      sub: 'per game',
    },
    {
      key: 'Diff',
      value: diff === null ? '—' : signed(diff),
      sub: 'avg vs line',
      tone: diff === null ? undefined : diff > 0 ? 'pos' : 'neg',
    },
  ];

  return (
    <div className="mt-4 grid grid-cols-4 gap-2 md:grid-cols-7">
      {stats.map((stat) => (
        <Card key={stat.key} className="grid justify-items-center gap-1 p-3 text-center">
          <span className="text-[length:var(--fs-micro)] uppercase tracking-[.1em] text-[var(--text-3)]">
            {stat.key}
          </span>
          <span
            className={cn(
              'num text-[length:var(--fs-lg)] font-bold tracking-tight',
              stat.tone === 'pos' && 'text-[var(--pos)]',
              stat.tone === 'neg' && 'text-[var(--neg)]',
            )}
          >
            {stat.value}
          </span>
          <span className="text-[length:var(--fs-micro)] text-[var(--text-3)]">{stat.sub}</span>
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ chart */

/**
 * Every game in the sample as a bar, with the current line drawn across them.
 * The line sits in the chart's own right gutter rather than over the data, and
 * a game the player missed is hatched rather than dropped, because a 7-for-10
 * built on three missed games is not a 70% hit rate.
 */
export function PropChart({
  games,
  line,
  side,
  market,
  loading,
}: {
  games: GameLogRow[];
  line: number;
  side: Side;
  market: string;
  loading?: boolean;
}) {
  const [grown, setGrown] = React.useState(false);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setGrown(true), 80);
    return () => window.clearTimeout(timer);
  }, [games]);

  if (loading) {
    return (
      <CardPanel className="mt-4">
        <CardHeader>
          <CardTitle>Recent games</CardTitle>
        </CardHeader>
        <Skeleton className="h-[230px]" />
      </CardPanel>
    );
  }

  const shown = games.slice(0, 15).reverse();
  if (!shown.length) {
    return (
      <CardPanel className="mt-4">
        <CardHeader>
          <CardTitle>Recent games</CardTitle>
        </CardHeader>
        <p className="py-10 text-center text-[length:var(--fs-sm)] text-[var(--text-3)]">
          No verified game log is available for this player and market yet.
        </p>
      </CardPanel>
    );
  }

  const values = shown.map((game) => Number(game.value)).filter(Number.isFinite);
  const max = Math.max(...values, line) * 1.18 || 1;
  const height = 200;

  return (
    <CardPanel className="mt-4">
      <CardHeader>
        <CardTitle>
          Last {shown.length} · {market}
        </CardTitle>
        <div className="flex flex-wrap gap-4 text-[length:var(--fs-micro)] text-[var(--text-3)]">
          <span>
            <i className="mr-1.5 inline-block size-2.5 rounded-[3px] bg-[var(--pos)] align-[-1px]" />
            {side === 'OVER' ? 'Over' : 'Under'} hit
          </span>
          <span>
            <i className="mr-1.5 inline-block size-2.5 rounded-[3px] bg-[color-mix(in_srgb,var(--neg)_70%,var(--surface-3))] align-[-1px]" />
            Missed
          </span>
          <span>
            <i className="mr-1.5 mt-[5px] inline-block h-0 w-2.5 border-t-2 border-dashed border-[var(--warn)] align-[-1px]" />
            Line
          </span>
        </div>
      </CardHeader>

      <div className="relative min-w-0 pr-[46px] pt-6">
        <div
          className="pointer-events-none absolute right-[46px] left-0 z-10 h-0 border-t-2 border-dashed border-[var(--warn)]"
          style={{ bottom: (line / max) * height + 26 }}
        >
          <span className="num absolute top-[-10px] left-full ml-1.5 whitespace-nowrap rounded border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-[var(--surface-2)] px-1.5 py-1 text-[length:var(--fs-micro)] font-bold text-[var(--warn)]">
            {line}
          </span>
        </div>

        <div
          className="grid min-w-0 grid-flow-col items-end gap-1"
          style={{ height, gridAutoColumns: 'minmax(0,1fr)' }}
        >
          {shown.map((game, index) => {
            const value = Number(game.value);
            const dnp = !Number.isFinite(value);
            const result = dnp ? 'dnp' : game.hit === true ? 'hit' : game.hit === false ? 'miss' : 'push';
            const barHeight = dnp ? 40 : Math.max(4, (value / max) * height);
            const edge = index < 2 ? 'start' : index > shown.length - 3 ? 'end' : 'mid';
            return (
              <button
                key={game.gameId || `${game.date}-${index}`}
                type="button"
                className="group relative grid h-full min-w-0 content-end bg-transparent p-0"
                aria-label={`${game.opponent || 'Game'} ${shortDate(game.date)}: ${
                  dnp ? 'did not play' : `${value}, ${result}`
                }`}
              >
                <span
                  className={cn(
                    'pointer-events-none absolute bottom-[calc(100%+8px)] z-20 whitespace-nowrap rounded-[var(--radius-sm)]',
                    'border border-[var(--line-strong)] bg-[var(--surface-3)] px-3 py-2',
                    'text-[length:var(--fs-micro)] text-[var(--text)] shadow-[var(--shadow-2)]',
                    'opacity-0 transition-opacity duration-200 ease-[var(--ease-out)]',
                    'group-hover:opacity-100 group-focus-visible:opacity-100',
                    edge === 'start' && 'left-0',
                    edge === 'end' && 'right-0',
                    edge === 'mid' && 'left-1/2 -translate-x-1/2',
                  )}
                >
                  {game.opponent || '—'} · <b className="num">{dnp ? 'DNP' : value}</b>
                  <span className="ml-1 text-[var(--text-3)]">{shortDate(game.date)}</span>
                </span>
                <span
                  className={cn(
                    'block origin-bottom rounded-t transition-transform duration-[480ms] ease-[var(--ease-spring)]',
                    result === 'hit' && 'bg-[var(--pos)]',
                    result === 'miss' && 'bg-[color-mix(in_srgb,var(--neg)_70%,var(--surface-3))]',
                    result === 'push' && 'bg-[var(--surface-3)]',
                    result === 'dnp' &&
                      'border border-dashed border-b-0 border-[var(--line-strong)] bg-[repeating-linear-gradient(45deg,var(--surface-3)_0_4px,transparent_4px_8px)]',
                  )}
                  style={{
                    height: barHeight,
                    transform: grown ? 'scaleY(1)' : 'scaleY(0)',
                    transitionDelay: `${index * 36}ms`,
                  }}
                />
              </button>
            );
          })}
        </div>

        <div
          className="mt-2 grid min-w-0 grid-flow-col gap-1 pr-[46px]"
          style={{ gridAutoColumns: 'minmax(0,1fr)' }}
        >
          {shown.map((game, index) => (
            <span
              key={game.gameId || `x-${index}`}
              className="min-w-0 overflow-hidden whitespace-nowrap pt-1.5 text-center text-[9px] font-medium text-[var(--text-3)] sm:text-[length:var(--fs-micro)]"
            >
              {game.isHome === false ? '@' : ''}
              {game.opponent || '—'}
            </span>
          ))}
        </div>
      </div>
    </CardPanel>
  );
}

/* --------------------------------------------------------------- game log */

export function GameLog({
  games,
  line,
  market,
  loading,
}: {
  games: GameLogRow[];
  line: number;
  market: string;
  loading?: boolean;
}) {
  return (
    <CardPanel className="mt-4">
      <CardHeader>
        <CardTitle>Game log</CardTitle>
        <span className="text-[length:var(--fs-xs)] text-[var(--text-3)]">Most recent first</span>
      </CardHeader>
      {loading ? (
        <div className="grid gap-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-11" />
          ))}
        </div>
      ) : !games.length ? (
        <p className="py-8 text-center text-[length:var(--fs-sm)] text-[var(--text-3)]">
          No games to show yet.
        </p>
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Opp</Th>
                <Th className="text-right">{market}</Th>
                <Th className="text-right">vs line</Th>
                <Th>Result</Th>
              </tr>
            </thead>
            <tbody>
              {games.map((game, index) => {
                const value = Number(game.value);
                const dnp = !Number.isFinite(value);
                const result = dnp ? 'dnp' : game.hit === true ? 'hit' : game.hit === false ? 'miss' : 'push';
                const delta = dnp ? null : value - line;
                return (
                  <Tr key={game.gameId || `${game.date}-${index}`}>
                    <Td>{shortDate(game.date)}</Td>
                    <Td>
                      {game.isHome === false ? '@ ' : ''}
                      {game.opponent || '—'}
                    </Td>
                    <Td
                      className={cn(
                        'num text-right font-semibold',
                        result === 'hit' && 'text-[var(--pos)]',
                        result === 'miss' && 'text-[var(--neg)]',
                      )}
                    >
                      {dnp ? '—' : value}
                    </Td>
                    <Td className="num text-right">{delta === null ? '—' : signed(delta)}</Td>
                    <Td>
                      <ResultBadge result={result} />
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </CardPanel>
  );
}

function ResultBadge({ result }: { result: 'hit' | 'miss' | 'push' | 'dnp' }) {
  const map = {
    hit: { icon: Check, label: 'Hit', className: 'text-[var(--pos)] bg-[color-mix(in_srgb,var(--pos)_16%,transparent)]' },
    miss: { icon: X, label: 'Miss', className: 'text-[var(--neg)] bg-[color-mix(in_srgb,var(--neg)_16%,transparent)]' },
    push: { icon: Minus, label: 'Push', className: 'text-[var(--text-3)] bg-[var(--surface-3)]' },
    dnp: { icon: Minus, label: 'DNP', className: 'text-[var(--text-3)] bg-[var(--surface-3)]' },
  } as const;
  const { icon: Icon, label, className } = map[result];
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5',
        'text-[length:var(--fs-micro)] font-bold tracking-wide',
        className,
      )}
    >
      <Icon className="size-3 shrink-0" strokeWidth={3} aria-hidden="true" />
      {label}
    </span>
  );
}

/* ----------------------------------------------------------------- splits */

export function Splits({ research }: { research: ResearchResponse | null }) {
  const rows = [
    { key: 'Home', window: splitOf(research, 'home') },
    { key: 'Away', window: splitOf(research, 'away') },
    { key: 'Head to head', window: research?.h2h ?? null },
  ];
  const any = rows.some((row) => pctValue(row.window?.hitRate ?? null) !== null);
  if (!any) return null;

  return (
    <CardPanel className="mt-4">
      <CardHeader>
        <CardTitle>Splits</CardTitle>
      </CardHeader>
      <div className="grid gap-2 sm:grid-cols-3">
        {rows.map((row) => {
          const rate = pctValue(row.window?.hitRate ?? null);
          const sample = row.window?.sampleSize ?? row.window?.games ?? null;
          return (
            <div
              key={row.key}
              className="grid justify-items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)] p-3 text-center"
            >
              <span className="text-[length:var(--fs-micro)] text-[var(--text-3)]">{row.key}</span>
              <span
                className={cn(
                  'num text-[length:var(--fs-md)] font-bold',
                  rate === null
                    ? 'text-[var(--text-3)]'
                    : rate >= 60
                      ? 'text-[var(--pos)]'
                      : rate < 45
                        ? 'text-[var(--neg)]'
                        : 'text-[var(--text)]',
                )}
              >
                {rate === null ? '—' : `${rate}%`}
              </span>
              <span className="text-[length:var(--fs-micro)] text-[var(--text-3)]">
                {sample === null ? 'no sample' : `${sample} games`}
              </span>
            </div>
          );
        })}
      </div>
    </CardPanel>
  );
}

```

---

## FILE: apps/oblige-web/components/sign-in.tsx

```tsx
'use client';

import * as React from 'react';
import { ArrowRight, CheckCircle2, Lock, ShieldCheck, Sparkles } from 'lucide-react';
import { ApiError, fetchAccount, postAccount } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { CardPanel } from '@/components/ui/card';

type Mode = 'login' | 'register' | 'verify';

const TRUST_POINTS = [
  'Live multi-book pricing in one board',
  'Verified game history and hit-rate context',
  'Saved research stays attached to your account',
];

/**
 * Human-first account entry. The presentation is intentionally richer than a
 * generic centered form, but every action still talks to the existing Oblige
 * auth routes. Google is only rendered when the server reports that OAuth is
 * configured, so the UI never advertises a dead sign-in path.
 */
export function SignInPanel({
  onSignedIn,
}: {
  onSignedIn: (account: { id: string; email?: string }) => void;
}) {
  const [mode, setMode] = React.useState<Mode>('login');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [code, setCode] = React.useState('');
  const [remember, setRemember] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [error, setError] = React.useState('');
  const [googleAvailable, setGoogleAvailable] = React.useState(false);

  React.useEffect(() => {
    const controller = new AbortController();
    fetch('/api/account/google/status', {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => setGoogleAvailable(body?.available === true))
      .catch(() => setGoogleAvailable(false));
    return () => controller.abort();
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const payload =
        mode === 'verify' ? { email, code } : { email, password, rememberMe: remember };
      const body = await postAccount(mode, payload);

      if (mode === 'register' && !body?.authenticated) {
        setMode('verify');
        setMessage(body?.message || 'Enter the verification code we emailed you.');
        return;
      }
      if (mode === 'verify') {
        setMode('login');
        setPassword('');
        setMessage(body?.message || 'Email verified. Sign in to continue.');
        return;
      }
      const account = await fetchAccount();
      if (account) onSignedIn(account);
      else setError('Signed in, but the session could not be read. Try again.');
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'The account service could not be reached. Try again shortly.',
      );
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === 'login'
      ? 'Welcome back'
      : mode === 'register'
        ? 'Create your account'
        : 'Verify your email';

  const subtitle =
    mode === 'login'
      ? 'Sign in to open your live prop workspace.'
      : mode === 'register'
        ? 'One account for your board, research and saved props.'
        : 'Use the short code we sent to finish setting up your account.';

  return (
    <div className="auth-shell mx-auto grid max-w-[980px] overflow-hidden rounded-[28px] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-2)] md:grid-cols-[minmax(0,.9fr)_minmax(380px,1.1fr)]">
      <aside className="auth-story relative hidden overflow-hidden border-r border-[var(--line)] p-8 md:flex md:flex-col md:justify-between">
        <div className="auth-story__glow" aria-hidden="true" />
        <div className="relative z-10">
          <span className="auth-story__eyebrow inline-flex items-center gap-2">
            <Sparkles className="size-4" aria-hidden="true" />
            ObligeProps workspace
          </span>
          <h2 className="mt-5 max-w-[12ch] text-[length:var(--fs-xl)] font-extrabold leading-[1.02] tracking-[-.05em] text-[var(--text)]">
            Research the number, not the noise.
          </h2>
          <p className="mt-4 max-w-[42ch] text-[length:var(--fs-sm)] leading-6 text-[var(--text-2)]">
            Your account opens the same live board and player history used across ObligeProps, with the interface kept focused on the decision in front of you.
          </p>
        </div>

        <div className="relative z-10 mt-10 grid gap-3">
          {TRUST_POINTS.map((point) => (
            <div key={point} className="auth-trust-row flex items-center gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-full border border-[var(--line)] bg-[var(--surface-2)] text-[var(--accent)]">
                <CheckCircle2 className="size-4" aria-hidden="true" />
              </span>
              <span className="text-[length:var(--fs-sm)] text-[var(--text-2)]">{point}</span>
            </div>
          ))}
        </div>
      </aside>

      <CardPanel className="auth-card border-0 bg-transparent p-6 shadow-none sm:p-8 md:rounded-none md:p-10">
        <div className="mb-7 grid gap-3">
          <span className="auth-lock grid size-11 place-items-center rounded-[14px] border border-[color-mix(in_srgb,var(--accent)_28%,transparent)] bg-[var(--accent-soft)] text-[var(--accent)]">
            <Lock className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-[length:var(--fs-lg)] font-extrabold tracking-[-.035em] normal-case">{title}</h1>
            <p className="mt-1.5 text-[length:var(--fs-sm)] leading-relaxed text-[var(--text-2)]">
              {subtitle}
            </p>
          </div>
        </div>

        {googleAvailable && mode !== 'verify' && (
          <>
            <a
              href="/api/account/google/start"
              className="auth-google flex min-h-11 w-full items-center justify-center gap-3 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--surface-2)] px-4 text-[length:var(--fs-sm)] font-semibold text-[var(--text)] transition-[border-color,background-color,transform] duration-200 hover:border-[var(--line-strong)] hover:bg-[var(--surface-3)] active:scale-[.99]"
            >
              <span className="grid size-6 place-items-center rounded-full bg-white text-[12px] font-black text-[#111]" aria-hidden="true">
                G
              </span>
              Continue with Google
            </a>
            <div className="auth-divider my-5 flex items-center gap-3 text-[length:var(--fs-micro)] uppercase tracking-[.16em] text-[var(--text-3)]">
              <span className="h-px flex-1 bg-[var(--line)]" />
              or use email
              <span className="h-px flex-1 bg-[var(--line)]" />
            </div>
          </>
        )}

        <form onSubmit={submit} noValidate>
          <Field label="Email" htmlFor="account-email" className="mb-5">
            <Input
              id="account-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              required
            />
          </Field>

          {mode === 'verify' ? (
            <Field
              label="Verification code"
              htmlFor="account-code"
              hint="Check the inbox for the address above."
              className="mb-5"
            >
              <Input
                id="account-code"
                inputMode="numeric"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoComplete="one-time-code"
                placeholder="6-digit code"
                required
              />
            </Field>
          ) : (
            <Field label="Password" htmlFor="account-password" className="mb-5">
              <Input
                id="account-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder="Your password"
                required
              />
            </Field>
          )}

          {mode !== 'verify' && (
            <label className="mb-5 flex items-center gap-2.5 text-[length:var(--fs-sm)] text-[var(--text-2)]">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                className="size-4 accent-[var(--accent)]"
              />
              Keep me signed in
            </label>
          )}

          {error && (
            <p
              role="alert"
              className="mb-4 rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--neg)_40%,transparent)] bg-[color-mix(in_srgb,var(--neg)_10%,transparent)] p-3 text-[length:var(--fs-sm)] text-[var(--neg)]"
            >
              {error}
            </p>
          )}
          {message && !error && (
            <p
              role="status"
              className="mb-4 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)] p-3 text-[length:var(--fs-sm)] text-[var(--text-2)]"
            >
              {message}
            </p>
          )}

          <Button type="submit" block disabled={busy} className="auth-submit min-h-11">
            <span>
              {busy
                ? 'Working…'
                : mode === 'login'
                  ? 'Sign in'
                  : mode === 'register'
                    ? 'Create account'
                    : 'Verify email'}
            </span>
            {!busy && <ArrowRight className="size-4" aria-hidden="true" />}
          </Button>
        </form>

        <p className="mt-5 text-center text-[length:var(--fs-sm)] text-[var(--text-3)]">
          {mode === 'login' ? (
            <>
              New to ObligeProps?{' '}
              <button
                type="button"
                className="font-semibold text-[var(--accent)] underline-offset-4 hover:underline"
                onClick={() => {
                  setMode('register');
                  setError('');
                  setMessage('');
                }}
              >
                Create an account
              </button>
            </>
          ) : (
            <button
              type="button"
              className="font-semibold text-[var(--accent)] underline-offset-4 hover:underline"
              onClick={() => {
                setMode('login');
                setError('');
                setMessage('');
              }}
            >
              Back to sign in
            </button>
          )}
        </p>

        <p className="mt-5 flex items-center justify-center gap-2 text-center text-[length:var(--fs-micro)] text-[var(--text-3)]">
          <ShieldCheck className="size-3.5" aria-hidden="true" />
          Secure session · password managers and paste supported
        </p>
      </CardPanel>
    </div>
  );
}

```

---

## FILE: apps/oblige-web/components/theme.tsx

```tsx
'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export const DIRECTIONS = [
  { id: 'a', label: 'Midnight Terminal' },
  { id: 'b', label: 'Broadcast' },
  { id: 'c', label: 'Daylight Ledger' },
] as const;

export type DirectionId = (typeof DIRECTIONS)[number]['id'];

const STORAGE_KEY = 'oblige-direction';
const DirectionContext = React.createContext<{
  direction: DirectionId;
  setDirection: (id: DirectionId) => void;
}>({ direction: 'a', setDirection: () => {} });

export function useDirection() {
  return React.useContext(DirectionContext);
}

export function DirectionProvider({ children }: { children: React.ReactNode }) {
  const [direction, setDirectionState] = React.useState<DirectionId>('a');

  React.useEffect(() => {
    // Storage can throw in a private window or when site data is blocked, and
    // a remembered theme is a convenience, never something to fail a render on.
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && DIRECTIONS.some((d) => d.id === saved)) setDirectionState(saved as DirectionId);
    } catch {
      /* keep the default */
    }
  }, []);

  React.useEffect(() => {
    document.documentElement.dataset.direction = direction;
  }, [direction]);

  const setDirection = React.useCallback((id: DirectionId) => {
    setDirectionState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* the theme still applies for this visit */
    }
  }, []);

  const value = React.useMemo(() => ({ direction, setDirection }), [direction, setDirection]);
  return <DirectionContext.Provider value={value}>{children}</DirectionContext.Provider>;
}

export function DirectionSwitcher({ className }: { className?: string }) {
  const { direction, setDirection } = useDirection();
  return (
    <div
      role="group"
      aria-label="Visual direction"
      className={cn(
        // The labels are long enough to outgrow a narrow phone, so the group
        // scrolls inside itself rather than widening the page.
        'flex max-w-full gap-0.5 overflow-x-auto rounded-full border border-[var(--line)]',
        'bg-[var(--surface-2)] p-[3px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {DIRECTIONS.map((option) => {
        const active = option.id === direction;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            onClick={() => setDirection(option.id)}
            className={cn(
              'min-h-9 flex-none whitespace-nowrap rounded-full px-3 text-[length:var(--fs-xs)] font-semibold',
              'transition-colors duration-200 ease-[var(--ease-out)]',
              active
                ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                : 'text-[var(--text-2)] hover:text-[var(--text)]',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

```

---

## FILE: apps/oblige-web/components/ui/badge.tsx

```tsx
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full font-semibold tracking-wide whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-2)]',
        live:
          'text-[var(--pos)] border border-[color-mix(in_srgb,var(--pos)_38%,transparent)] ' +
          'bg-[color-mix(in_srgb,var(--pos)_12%,transparent)]',
        pos: 'text-[var(--pos)] bg-[color-mix(in_srgb,var(--pos)_16%,transparent)]',
        neg: 'text-[var(--neg)] bg-[color-mix(in_srgb,var(--neg)_16%,transparent)]',
        muted: 'text-[var(--text-3)] bg-[var(--surface-3)]',
      },
      size: {
        sm: 'h-6 px-2.5 text-[length:var(--fs-micro)]',
        md: 'h-7 px-3 text-[length:var(--fs-xs)]',
      },
    },
    defaultVariants: { variant: 'default', size: 'sm' },
  },
);

export function Badge({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

/** A small pulsing dot, used to mark a live market. */
export function Dot({ className, pulse }: { className?: string; pulse?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn('size-1.5 shrink-0 rounded-full bg-current', pulse && 'animate-pulse', className)}
    />
  );
}

```

---

## FILE: apps/oblige-web/components/ui/button.tsx

```tsx
'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  // 44px minimum height everywhere: these are the same controls on a phone.
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold ' +
    'transition-[transform,background-color,border-color,box-shadow,color] duration-200 ' +
    'ease-[var(--ease-out)] active:scale-[.97] touch-manipulation ' +
    'disabled:pointer-events-none disabled:opacity-50 ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ' +
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-[var(--accent)] text-[var(--accent-ink)] shadow-[var(--shadow-glow)] hover:brightness-110',
        ghost:
          'border border-[var(--line-strong)] text-[var(--text-2)] ' +
          'hover:border-[var(--text-3)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]',
        quiet: 'text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]',
        danger:
          'border border-[color-mix(in_srgb,var(--neg)_50%,transparent)] text-[var(--neg)] ' +
          'hover:bg-[color-mix(in_srgb,var(--neg)_12%,transparent)]',
      },
      size: {
        sm: 'min-h-9 px-3 text-[length:var(--fs-xs)] rounded-[var(--radius-sm)]',
        md: 'min-h-11 px-5 text-[length:var(--fs-sm)] rounded-[var(--radius)]',
        lg: 'min-h-12 px-6 text-[length:var(--fs-base)] rounded-[var(--radius)]',
        icon: 'size-11 rounded-[var(--radius-sm)]',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', block: false },
  },
);

export type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, block, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, block }), className)} {...props} />;
}

export { buttonVariants };

```

---

## FILE: apps/oblige-web/components/ui/card.tsx

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'bg-[var(--surface)] border border-[var(--line)] rounded-[var(--radius)] shadow-[var(--shadow-1)]',
        'transition-[transform,border-color,box-shadow,background-color] duration-300 ease-[var(--ease-out)]',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-wrap items-center justify-between gap-3 mb-5', className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return <h2 className={cn('text-[length:var(--fs-md)] tracking-tight normal-case', className)} {...props} />;
}

export function CardPanel({ className, ...props }: React.ComponentProps<'div'>) {
  return <Card className={cn('p-5 min-w-0', className)} {...props} />;
}

```

---

## FILE: apps/oblige-web/components/ui/input.tsx

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

/** 16px text on purpose: anything smaller makes iOS zoom the page on focus. */
export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'min-h-11 w-full min-w-0 rounded-[var(--radius)] px-3',
        'bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text)]',
        'text-base sm:text-[length:var(--fs-sm)] placeholder:text-[var(--text-3)]',
        'outline-none transition-[border-color,box-shadow] duration-200 ease-[var(--ease-out)]',
        'focus:border-[var(--accent)] focus:shadow-[var(--shadow-glow)]',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'min-h-28 w-full min-w-0 resize-y rounded-[var(--radius)] p-3',
        'bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text)]',
        'text-base sm:text-[length:var(--fs-sm)] leading-relaxed placeholder:text-[var(--text-3)]',
        'outline-none transition-[border-color,box-shadow] duration-200 ease-[var(--ease-out)]',
        'focus:border-[var(--accent)] focus:shadow-[var(--shadow-glow)]',
        className,
      )}
      {...props}
    />
  );
}

/** Labels are always visible — a placeholder disappears the moment you type. */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor: string;
  children: React.ReactNode;
  className?: string;
}) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  return (
    <div className={cn('grid gap-2', className)}>
      <label htmlFor={htmlFor} className="text-[length:var(--fs-sm)] font-semibold">
        {label}
      </label>
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
            id: htmlFor,
            'aria-describedby': [hintId, errorId].filter(Boolean).join(' ') || undefined,
            'aria-invalid': error ? true : undefined,
          })
        : children}
      {hint && !error && (
        <span id={hintId} className="text-[length:var(--fs-xs)] text-[var(--text-3)]">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} role="alert" className="text-[length:var(--fs-xs)] text-[var(--neg)]">
          {error}
        </span>
      )}
    </div>
  );
}

```

---

## FILE: apps/oblige-web/components/ui/select.tsx

```tsx
'use client';

import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        'flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-[var(--radius)] px-3',
        'bg-[var(--surface-2)] border border-[var(--line)] text-[length:var(--fs-sm)] font-semibold text-[var(--text)]',
        'outline-none transition-[border-color,box-shadow] duration-200 ease-[var(--ease-out)]',
        'focus:border-[var(--accent)] focus:shadow-[var(--shadow-glow)] data-[placeholder]:text-[var(--text-3)]',
        className,
      )}
      {...props}
    >
      <span className="truncate">{children}</span>
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 shrink-0 text-[var(--text-3)]" aria-hidden="true" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position="popper"
        sideOffset={6}
        className={cn(
          'z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden',
          'rounded-[var(--radius)] border border-[var(--line-strong)] bg-[var(--surface-2)]',
          'shadow-[var(--shadow-2)]',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        'relative flex min-h-10 cursor-pointer select-none items-center gap-2 rounded-[var(--radius-sm)] px-2.5',
        'text-[length:var(--fs-sm)] text-[var(--text-2)] outline-none',
        'data-[highlighted]:bg-[var(--surface-3)] data-[highlighted]:text-[var(--text)]',
        'data-[state=checked]:text-[var(--accent)] data-[state=checked]:font-semibold',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemIndicator asChild>
        <Check className="size-3.5" aria-hidden="true" />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

```

---

## FILE: apps/oblige-web/components/ui/skeleton.tsx

```tsx
import { cn } from '@/lib/utils';

/** Shown while data loads, sized to the thing it stands in for so the layout
 *  does not jump when the real content arrives. */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'rounded-[var(--radius-sm)] bg-[var(--surface-2)]',
        'bg-[linear-gradient(90deg,var(--surface-2)_0%,var(--surface-3)_40%,var(--surface-2)_80%)]',
        'bg-[length:220%_100%] animate-[shimmer_1.4s_linear_infinite]',
        className,
      )}
      {...props}
    />
  );
}

```

---

## FILE: apps/oblige-web/components/ui/table.tsx

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

/** The wrapper scrolls, not the page — a wide table never becomes the
 *  document's own horizontal overflow. */
export function TableWrap({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('min-w-0 overflow-x-auto [overscroll-behavior-x:contain]', className)}
      {...props}
    />
  );
}

export function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <table
      className={cn('w-full min-w-[420px] border-collapse text-[length:var(--fs-sm)]', className)}
      {...props}
    />
  );
}

export function Th({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'whitespace-nowrap border-b border-[var(--line)] p-3 text-left',
        'text-[length:var(--fs-micro)] font-semibold uppercase tracking-[.1em] text-[var(--text-3)]',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      className={cn('whitespace-nowrap border-b border-[var(--line)] p-3 text-[var(--text-2)]', className)}
      {...props}
    />
  );
}

export function Tr({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      className={cn(
        'transition-colors duration-200 ease-[var(--ease-out)] hover:bg-[var(--surface-2)]',
        '[&:last-child>td]:border-b-0',
        className,
      )}
      {...props}
    />
  );
}

```

---

## FILE: apps/oblige-web/components/ui/tabs.tsx

```tsx
'use client';

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('rail', className)} {...props} />;
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'flex-none min-h-11 rounded-full border border-[var(--line)] bg-[var(--surface)] px-5',
        'text-[length:var(--fs-xs)] font-semibold tracking-wide text-[var(--text-2)]',
        'transition-[color,background-color,border-color,transform] duration-200 ease-[var(--ease-out)]',
        'hover:text-[var(--text)] hover:border-[var(--line-strong)] active:scale-[.97]',
        'data-[state=active]:bg-[var(--accent)] data-[state=active]:text-[var(--accent-ink)]',
        'data-[state=active]:border-transparent',
        className,
      )}
      {...props}
    />
  );
}

export const TabsContent = TabsPrimitive.Content;

```

---
