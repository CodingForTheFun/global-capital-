'use client';

import * as React from 'react';
import { ArrowRight, CheckCircle2, Lock, ShieldCheck, Sparkles } from 'lucide-react';
import { ApiError, fetchAccount, postAccount } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { CardPanel } from '@/components/ui/card';
import { PasswordResetPanel } from '@/components/password-reset';

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
  const [recovering, setRecovering] = React.useState(false);

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

  if (recovering) {
    const returnToSignIn = (resetEmail: string, completed = false) => {
      setEmail(resetEmail);
      setPassword('');
      setCode('');
      setMode('login');
      setError('');
      setMessage(completed ? 'Password updated. Sign in with your new password.' : '');
      setRecovering(false);
    };
    return <PasswordResetPanel initialEmail={email} onBack={(value) => returnToSignIn(value)} onComplete={(value) => returnToSignIn(value, true)} />;
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

          {mode === 'login' && (
            <button type="button" disabled={busy} onClick={() => { setPassword(''); setRecovering(true); }}
              className="mb-4 inline-flex min-h-11 items-center font-semibold text-[length:var(--fs-sm)] text-[var(--accent)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)] disabled:opacity-50">
              Forgot password?
            </button>
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
