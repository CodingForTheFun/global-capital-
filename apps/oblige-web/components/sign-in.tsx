'use client';

import * as React from 'react';
import { Lock } from 'lucide-react';
import { ApiError, fetchAccount, postAccount } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { CardPanel } from '@/components/ui/card';

type Mode = 'login' | 'register' | 'verify';

/**
 * The board is behind an account, so this is the first thing a signed-out
 * visitor meets. It talks to the existing /api/account routes unchanged — the
 * register flow still hands off to a verification code, and a failed submit
 * keeps the error next to the form rather than replacing it.
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
    mode === 'login' ? 'Sign in to open the board' : mode === 'register' ? 'Create an account' : 'Verify your email';

  return (
    <CardPanel className="mx-auto max-w-[460px] p-6">
      <div className="mb-6 grid gap-3">
        <span className="grid size-10 place-items-center rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--accent)_26%,transparent)] bg-[var(--accent-soft)] text-[var(--accent)]">
          <Lock className="size-5" aria-hidden="true" />
        </span>
        <h1 className="text-[length:var(--fs-lg)] normal-case">{title}</h1>
        <p className="text-[length:var(--fs-sm)] leading-relaxed text-[var(--text-2)]">
          The board carries live prices from every book we track, so it sits behind an account.
        </p>
      </div>

      <form onSubmit={submit} noValidate>
        <Field label="Email" htmlFor="account-email" className="mb-5">
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
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
              inputMode="numeric"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="one-time-code"
              required
            />
          </Field>
        ) : (
          <Field label="Password" htmlFor="account-password" className="mb-5">
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              // A password manager must be able to fill this; never block paste.
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
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

        <Button type="submit" block disabled={busy}>
          {busy
            ? 'Working…'
            : mode === 'login'
              ? 'Sign in'
              : mode === 'register'
                ? 'Create account'
                : 'Verify email'}
        </Button>
      </form>

      <p className="mt-5 text-center text-[length:var(--fs-sm)] text-[var(--text-3)]">
        {mode === 'login' ? (
          <>
            No account yet?{' '}
            <button
              type="button"
              className="font-semibold text-[var(--accent)] underline-offset-4 hover:underline"
              onClick={() => {
                setMode('register');
                setError('');
                setMessage('');
              }}
            >
              Create one
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
    </CardPanel>
  );
}
