"use client";
import { useEffect, useState } from "react";
type Offer = {
  id: string;
  playerName: string;
  market: string;
  line: number;
  originalLine: number;
  side: string;
  expiresAt: string;
};
export default function TacoBoard({ sport }: { sport: string }) {
  const [offers, setOffers] = useState<Offer[]>([]),
    [message, setMessage] = useState("Checking verified promotion metadata…");
  useEffect(() => {
    const c = new AbortController();
    setOffers([]);
    setMessage("Checking verified promotion metadata…");
    fetch(`/api/apex/taco-offers?sport=${encodeURIComponent(sport)}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: c.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((j) => {
        if (!c.signal.aborted) {
          setOffers(Array.isArray(j.offers) ? j.offers : []);
          setMessage(j.message || "Promotion data is unavailable.");
        }
      })
      .catch(() => {
        if (!c.signal.aborted)
          setMessage("Promotion data is temporarily unavailable.");
      });
    return () => c.abort();
  }, [sport]);
  return (
    <section className="rounded-2xl border border-amber-500/20 bg-[#111726] p-6">
      <p className="text-xs font-bold uppercase tracking-widest text-amber-400">
        PrizePicks promotions
      </p>
      <h2 className="mt-3 text-2xl font-bold">🌮 Taco Board</h2>
      <p role="status" className="mt-3 text-sm leading-6 text-slate-400">
        {message}
      </p>
      <div className="mt-5 space-y-3">
        {offers
          .filter((o) => Date.parse(o.expiresAt) > Date.now())
          .map((o) => (
            <article
              key={o.id}
              className="rounded-xl border border-amber-500/20 bg-[#090d16] p-4"
            >
              <b>{o.playerName}</b>
              <p className="mt-2 text-sm text-slate-400">
                {o.market} · {o.side}
              </p>
              <p className="mt-3 text-xl font-bold text-amber-300">
                <del className="mr-3 text-sm text-slate-500">
                  {o.originalLine}
                </del>
                {o.line}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Expires {new Date(o.expiresAt).toLocaleString()}
              </p>
            </article>
          ))}
      </div>
      <p className="mt-5 text-xs leading-6 text-slate-500">
        Tacos are discounted promotional lines, not ordinary PrizePicks props or
        Goblins. Only explicit, unexpired Taco metadata is shown. This section
        does not change the regular-line Auto Scout rules.
      </p>
      <a
        href="https://www.prizepicks.com/promos/taco-tuesday"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-block text-sm font-semibold text-amber-300 hover:text-amber-200"
      >
        Check official Taco availability ↗
      </a>
    </section>
  );
}
