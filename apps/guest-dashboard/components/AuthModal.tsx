'use client';

export default function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-[#0b111d] p-6 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-6 flex items-start justify-between gap-4">
          <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-400">ObligePay Edge</p><h2 className="mt-2 text-2xl font-bold">Create a free account</h2><p className="mt-2 text-sm leading-6 text-slate-400">Unlock the full prop board, advanced filters, unlimited research questions, and saved cards.</p></div>
          <button onClick={onClose} className="rounded-xl border border-slate-800 px-3 py-2 text-slate-400 transition hover:bg-slate-900 hover:text-white" aria-label="Close">×</button>
        </div>
        <button onClick={() => { window.location.href = '/api/auth/signin/google'; }} className="w-full rounded-xl border border-slate-700 bg-white px-4 py-3 font-semibold text-slate-900 transition hover:bg-slate-100">Continue with Google</button>
        <div className="my-4 flex items-center gap-3 text-xs text-slate-600"><span className="h-px flex-1 bg-slate-800"/><span>OR</span><span className="h-px flex-1 bg-slate-800"/></div>
        <form className="space-y-3" onSubmit={(e) => e.preventDefault()}>
          <input type="email" required placeholder="Email address" className="w-full rounded-xl border border-slate-800 bg-[#06090e] px-4 py-3 text-sm outline-none transition focus:border-blue-500"/>
          <button className="w-full rounded-xl bg-blue-600 px-4 py-3 font-bold text-white transition hover:bg-blue-500">Create Free Account</button>
        </form>
        <p className="mt-4 text-center text-xs text-slate-500">No credit card required.</p>
      </div>
    </div>
  );
}
