'use client';

import * as React from 'react';
import { ArrowLeft, ArrowRight, KeyRound, Mail, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { CardPanel } from '@/components/ui/card';
import {
  completePasswordReset,
  PasswordResetError,
  requestPasswordReset,
  RESET_COOLDOWN_SECONDS,
  validateResetInput,
} from '@/lib/password-reset.mjs';

export function PasswordResetPanel({ initialEmail = '', onBack, onComplete }: {
  initialEmail?: string;
  onBack: (email: string) => void;
  onComplete: (email: string) => void;
}) {
  const [step, setStep] = React.useState<'request' | 'reset'>('request');
  const [email, setEmail] = React.useState(initialEmail);
  const [code, setCode] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [cooldownUntil, setCooldownUntil] = React.useState(0);
  const [secondsLeft, setSecondsLeft] = React.useState(0);
  const active = React.useRef<AbortController | null>(null);
  const heading = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => () => { active.current?.abort(); }, []);
  React.useEffect(() => { heading.current?.focus(); }, [step]);
  React.useEffect(() => {
    if (!cooldownUntil) return;
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  function cooldown() {
    setSecondsLeft(RESET_COOLDOWN_SECONDS);
    setCooldownUntil(Date.now() + RESET_COOLDOWN_SECONDS * 1_000);
  }

  async function run(completing: boolean) {
    // The ref also blocks two submissions before React applies disabled state.
    if (active.current || (!completing && Date.now() < cooldownUntil)) return;
    const invalid = validateResetInput({ email, code, password, confirmPassword }, completing);
    setError(invalid || '');
    setMessage('');
    if (invalid) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    try {
      if (completing) {
        const result = await completePasswordReset({ email, code, password, confirmPassword }, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (result.code !== 'AUTH_PASSWORD_RESET') {
          throw new PasswordResetError('The password update could not be confirmed. Try signing in before retrying.', 'INVALID_RESPONSE');
        }
        setCode('');
        setPassword('');
        setConfirmPassword('');
        // Never sign in from a recovery response. Existing account sign-in owns
        // session issuance; the reset endpoint revokes old session versions.
        onComplete(email.trim());
      } else {
        const result = await requestPasswordReset(email, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setEmail(email.trim());
        setCode('');
        setStep('reset');
        setMessage(result.message);
        cooldown();
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof PasswordResetError ? cause.message : 'Password recovery could not be completed. Please try again.');
      if (cause instanceof PasswordResetError && cause.code === 'RATE_LIMITED') cooldown();
    } finally {
      if (active.current === controller) active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function editEmail() {
    setStep('request');
    setCode('');
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setError('');
    setMessage('');
  }

  return (
    <CardPanel className="auth-card mx-auto w-full max-w-[480px] rounded-[28px] p-6 shadow-[var(--shadow-2)] sm:p-8">
      <button type="button" disabled={busy} onClick={() => onBack(email.trim())}
        className="mb-6 inline-flex min-h-11 items-center gap-2 text-[length:var(--fs-sm)] font-semibold text-[var(--text-2)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)] disabled:opacity-50">
        <ArrowLeft className="size-4" aria-hidden="true" /> Back to sign in
      </button>
      <span className="mb-4 grid size-11 place-items-center rounded-[14px] border border-[var(--line)] bg-[var(--accent-soft)] text-[var(--accent)]">
        {step === 'request' ? <Mail className="size-5" aria-hidden="true" /> : <KeyRound className="size-5" aria-hidden="true" />}
      </span>
      <h1 ref={heading} tabIndex={-1} className="text-[length:var(--fs-lg)] font-extrabold tracking-[-.035em] normal-case focus:outline-none">
        {step === 'request' ? 'Reset your password' : 'Choose a new password'}
      </h1>
      <p className="mb-6 mt-2 text-[length:var(--fs-sm)] leading-relaxed text-[var(--text-2)]">
        {step === 'request' ? 'Enter your account email. We’ll send a six-digit code to help you get back in.' : 'Use the latest code from your reset email. Codes expire after 10 minutes.'}
      </p>

      {error && <p role="alert" className="mb-4 rounded-[var(--radius-sm)] border border-[var(--neg)] bg-[var(--surface-2)] p-3 text-[length:var(--fs-sm)] text-[var(--neg)]">{error}</p>}
      {message && !error && <p role="status" className="mb-4 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)] p-3 text-[length:var(--fs-sm)] text-[var(--text-2)]">{message}</p>}

      <form noValidate aria-busy={busy} onSubmit={(event) => { event.preventDefault(); void run(step === 'reset'); }}>
        <fieldset disabled={busy} className="m-0 min-w-0 border-0 p-0">
          <Field label="Account email" htmlFor="reset-email" className="mb-5">
            <Input id="reset-email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
              value={email} readOnly={step === 'reset'} required placeholder="you@example.com"
              onChange={(event) => setEmail(event.target.value)} />
          </Field>
          {step === 'reset' && <>
            <Field label="Reset code" htmlFor="reset-code" hint="Use the latest six-digit code, not a registration code." className="mb-5">
              <Input id="reset-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={12}
                value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000" required />
            </Field>
            <Field label="New password" htmlFor="reset-password" hint="10–200 characters. Avoid common passwords and your email address." className="mb-5">
              <Input id="reset-password" name="new-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password"
                minLength={10} maxLength={200} value={password} onChange={(event) => setPassword(event.target.value)} required />
            </Field>
            <Field label="Confirm new password" htmlFor="reset-confirm-password" className="mb-2">
              <Input id="reset-confirm-password" name="confirm-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password"
                minLength={10} maxLength={200} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
            </Field>
            <button type="button" aria-pressed={showPassword} aria-controls="reset-password reset-confirm-password" onClick={() => setShowPassword(!showPassword)}
              className="mb-4 min-h-11 text-[length:var(--fs-sm)] font-semibold text-[var(--accent)] underline-offset-4 hover:underline">
              {showPassword ? 'Hide passwords' : 'Show passwords'}
            </button>
          </>}
          <Button type="submit" block disabled={busy || (step === 'request' && secondsLeft > 0)} className="auth-submit min-h-11">
            {busy ? 'Working…' : step === 'reset' ? 'Update password' : secondsLeft > 0 ? `Try again in ${secondsLeft}s` : 'Send reset code'}
            {!busy && <ArrowRight className="size-4" aria-hidden="true" />}
          </Button>
        </fieldset>
      </form>

      <div className="mt-4 grid gap-1 text-center text-[length:var(--fs-sm)]">
        {step === 'reset' ? <>
          <button type="button" disabled={busy || secondsLeft > 0} onClick={() => { void run(false); }}
            className="min-h-11 font-semibold text-[var(--accent)] underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-[var(--text-3)]">
            {secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : 'Resend reset code'}
          </button>
          <button type="button" disabled={busy} onClick={editEmail} className="min-h-11 text-[var(--text-2)] underline-offset-4 hover:underline">Use a different email</button>
        </> : <button type="button" disabled={busy} className="min-h-11 font-semibold text-[var(--accent)] underline-offset-4 hover:underline"
          onClick={() => {
            const invalid = validateResetInput({ email });
            setError(invalid || '');
            if (!invalid) { setEmail(email.trim()); setStep('reset'); setMessage(''); }
          }}>Already have a reset code?</button>}
      </div>
      <p className="mt-5 flex items-start justify-center gap-2 text-center text-[length:var(--fs-micro)] leading-relaxed text-[var(--text-3)]">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        After a successful reset, sign in again on your devices. Your account and saved research stay the same.
      </p>
    </CardPanel>
  );
}
