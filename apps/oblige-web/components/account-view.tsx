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
