'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';

type Health = { password?: { available: boolean }; google?: { available: boolean } };
// Only existing same-origin application destinations are allowed. No query
// string or user-controlled URL is accepted as a post-auth redirect.
const returnDestination = () => window.location.pathname.replace(/\/$/, '') === '/sportsbooks' ? '/sportsbooks' : '/apex';
export default function AuthModal({ open, onClose, initialMode = 'register' }: {
  open: boolean; onClose: () => void; initialMode?: 'register' | 'login';
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'register' | 'login' | 'verify'>(initialMode);
  const [health, setHealth] = useState<Health | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) { dialog.current?.close(); return; }
    setMode(initialMode); setMessage(''); setHealth(null);
    if (!dialog.current?.open) dialog.current?.showModal();
    const controller = new AbortController();
    fetch('/api/account/health', { cache: 'no-store', signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(data => { if (!controller.signal.aborted) setHealth(data); })
      .catch(() => { if (!controller.signal.aborted) setMessage('Account service is temporarily unavailable. Please try again.'); });
    return () => controller.abort();
  }, [open, initialMode]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      const send = async (action: string, body: Record<string, string>) => {
        const res = await fetch(`/api/account/${action}`, { method: 'POST', credentials: 'same-origin',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json();
        if (!res.ok || data.ok === false) throw new Error(data.message || 'Unable to complete this request.');
        return data;
      };
      const result = await send(mode, mode === 'verify' ? { email, code } : { email, password });
      if (mode === 'register' && !result.authenticated) {
        setMode('verify'); setMessage(result.message || 'Check your email for your verification code.');
      } else {
        if (mode === 'verify') await send('login', { email, password });
        window.location.assign(returnDestination());
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to connect. Please try again.'); }
    finally { setBusy(false); }
  }

  return <dialog ref={dialog} onCancel={e => { e.preventDefault(); onClose(); }} aria-labelledby="auth-title"
    className="m-auto w-[calc(100%_-_2rem)] max-w-md rounded-3xl border border-slate-700 bg-[#0b111d] p-6 text-slate-100 shadow-2xl backdrop:bg-black/75 backdrop:backdrop-blur-sm">
    <div className="flex items-start justify-between gap-3">
      <div><p className="text-xs font-bold tracking-[.2em] text-blue-400">OBLIGEPAY EDGE</p>
        <h2 id="auth-title" className="mt-2 text-2xl font-bold">{mode === 'login' ? 'Welcome back' : mode === 'verify' ? 'Verify your email' : 'Create a Free Account'}</h2></div>
      <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg border border-slate-700 px-3 py-1.5 hover:bg-slate-800">×</button>
    </div>
    <p className="my-4 text-sm leading-6 text-slate-400">Sign in to your research workspace. Features and availability depend on your access level and data coverage.</p>
    {mode !== 'verify' && <>
      <button type="button" disabled={!health?.google?.available || busy}
        onClick={() => window.location.assign(`/api/account/google/start?next=${encodeURIComponent(returnDestination())}`)}
        className="w-full rounded-xl bg-white px-4 py-3 font-semibold text-slate-950 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">Continue with Google</button>
      {health && !health.google?.available && <p className="mt-2 text-center text-xs text-slate-500">Google sign-in is not enabled yet. Use email below.</p>}
      <div className="my-4 flex items-center gap-3 text-xs text-slate-500"><span className="h-px flex-1 bg-slate-800"/>OR<span className="h-px flex-1 bg-slate-800"/></div>
    </>}
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-xs text-slate-400">Email address<input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} readOnly={mode === 'verify'} className="mt-1 w-full rounded-xl border border-slate-700 bg-[#06090e] p-3 text-sm text-white outline-none focus:border-blue-500"/></label>
      {mode === 'verify' ? <label className="block text-xs text-slate-400">Verification code<input required inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-[#06090e] p-3 text-white"/></label>
        : <label className="block text-xs text-slate-400">Password<input required type="password" aria-label="Password" aria-describedby={mode === 'register' ? 'password-hint' : undefined} minLength={mode === 'register' ? 12 : undefined} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-[#06090e] p-3 text-sm text-white outline-none focus:border-blue-500"/>{mode === 'register' && <span id="password-hint" className="mt-1 block text-slate-500">At least 12 characters.</span>}</label>}
      {message && <p role="status" className="rounded-xl border border-slate-700 p-3 text-sm leading-6 text-slate-300">{message}</p>}
      <button disabled={busy || !health || (mode === 'register' && !health.password?.available)} className="w-full rounded-xl bg-blue-600 px-4 py-3 font-bold transition hover:bg-blue-500 disabled:opacity-40">{busy ? 'Working…' : mode === 'login' ? 'Log In' : mode === 'verify' ? 'Verify and continue' : 'Create Free Account'}</button>
    </form>
    {mode !== 'verify' && <button type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setMessage(''); }} className="mt-4 w-full text-center text-sm text-blue-400 hover:text-blue-300">{mode === 'login' ? 'New here? Create a free account' : 'Already have an account? Log in'}</button>}
    <p className="mt-4 text-center text-xs text-slate-500">No payment details required to create an account.</p>
  </dialog>;
}
