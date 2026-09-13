"use client";
import { FormEvent, useEffect, useRef, useState } from "react";
import { LoaderCircle, Minus, Plus, Sparkles, X } from "lucide-react";
import type { Quote } from "@/lib/sports-workspace";
type Game = {
  value: number;
  date?: string;
  opponent?: string;
  isHome?: boolean;
  minutes?: number;
};
type Window = { average: number; games: number; hitRate: number };
type Research = {
  available: boolean;
  message?: string;
  gameLog?: Game[];
  windows?: Record<string, Window>;
  matchup?: { opponent?: string };
  projectedStat?: {
    value: number;
    source: string;
    sampleSize: number;
    note: string;
  };
};
type Projection = { available: boolean; projection?: number; message?: string };
export default function PropInsight({
  quote,
  onClose,
}: {
  quote: Quote;
  onClose: () => void;
}) {
  const [line, setLine] = useState(quote.line),
    [side, setSide] = useState(quote.side),
    [research, setResearch] = useState<Research | null>(null);
  const [model, setModel] = useState<Projection | null>(null),
    [pending, setPending] = useState(""),
    [question, setQuestion] = useState(""),
    [answer, setAnswer] = useState(""),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    version = useRef(0);
  useEffect(() => {
    dialog.current?.showModal();
    return () => {
      version.current++;
    };
  }, []);
  useEffect(() => {
    const current = ++version.current,
      c = new AbortController();
    setResearch(null);
    setModel(null);
    setAnswer("");
    setError("");
    const params = new URLSearchParams({
      sport: quote.sport,
      playerName: quote.playerName,
      market: quote.market,
      marketId: quote.marketId,
      line: String(line),
      side,
      games: "25",
      team: quote.team,
      homeTeam: quote.homeTeam,
      awayTeam: quote.awayTeam,
    });
    const timer = setTimeout(() => c.abort(), 30000);
    fetch(`/api/apex/research?${params}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: c.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw Error("Historical data could not be loaded.");
        return r.json();
      })
      .then((j) => {
        if (current === version.current) setResearch(j);
      })
      .catch(() => {
        if (current === version.current)
          setResearch({
            available: false,
            message: "Game history is unavailable. Please try again later.",
          });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      version.current++;
      c.abort();
      clearTimeout(timer);
    };
  }, [quote, line, side]);
  function context() {
    return {
      sport: quote.sport,
      playerName: quote.playerName,
      market: quote.market,
      marketId: quote.marketId,
      line,
      team: quote.team,
      homeTeam: quote.homeTeam,
      awayTeam: quote.awayTeam,
      gameStartTime: quote.gameStartTime,
      opponent: research?.matchup?.opponent || "",
      gameLog: research?.gameLog || [],
      windows: research?.windows || {},
      // Adjusting a line invalidates the original price. Never reuse it at a new line.
      overPrice:
        line === quote.line && quote.side === "OVER" ? quote.price : null,
      underPrice:
        line === quote.line && quote.side === "UNDER" ? quote.price : null,
    };
  }
  async function run(kind: "ask" | "project", e?: FormEvent) {
    e?.preventDefault();
    if (pending || (!question.trim() && kind === "ask")) return;
    const current = version.current;
    setPending(kind);
    setError("");
    try {
      const r = await fetch(`/api/props/${kind}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          kind === "ask"
            ? { question: question.trim(), prop: context(), history: [] }
            : context(),
        ),
        signal: AbortSignal.timeout(kind === "ask" ? 50000 : 160000),
      });
      const j = await r.json();
      if (current !== version.current) return;
      if (!r.ok || !j.available)
        throw Error(j.message || "This feature is temporarily unavailable.");
      if (kind === "ask") setAnswer(j.answer);
      else setModel(j);
    } catch (e) {
      if (current === version.current)
        setError(
          e instanceof Error
            ? e.message
            : "The request could not be completed.",
        );
    } finally {
      setPending("");
    }
  }
  const projected = model?.available
    ? model.projection
    : research?.projectedStat?.value;
  const values = research?.gameLog?.slice(0, 5) || [],
    maximum = Math.max(line, ...values.map((g) => g.value), 1) * 1.15;
  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-label="Prop research and projected stat"
      className="m-auto max-h-[92dvh] w-[calc(100%_-_24px)] max-w-2xl overflow-auto rounded-3xl border border-slate-700 bg-[#0b111d] p-5 text-white backdrop:bg-black/80 sm:p-7"
    >
      <div className="flex justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">
            Auto Scout · Player research
          </p>
          <h2 className="mt-2 text-xl font-bold">{quote.playerName}</h2>
          <p className="mt-1 text-xs text-slate-500">
            {quote.market} · {quote.sportsbook}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close prop research"
          className="self-start rounded-lg border border-slate-700 p-2"
        >
          <X size={17} />
        </button>
      </div>
      <div className="my-5 grid grid-cols-2 gap-3">
        <section className="rounded-xl border border-slate-800 bg-[#090d16] p-4">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">
            Research line
          </p>
          <div className="mt-3 flex items-center justify-between">
            <button
              aria-label="Decrease research line"
              disabled={!!pending}
              onClick={() => setLine((v) => v - 0.5)}
              className="rounded-lg border border-slate-700 p-2"
            >
              <Minus size={14} />
            </button>
            <b className="text-2xl">{line}</b>
            <button
              aria-label="Increase research line"
              disabled={!!pending}
              onClick={() => setLine((v) => v + 0.5)}
              className="rounded-lg border border-slate-700 p-2"
            >
              <Plus size={14} />
            </button>
          </div>
        </section>
        <section className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4">
          <p className="text-[10px] uppercase tracking-wider text-emerald-300">
            Projected stat
          </p>
          <output
            data-testid="projected-stat"
            className="mt-2 block text-3xl font-bold tabular-nums"
          >
            {projected == null ? "—" : projected.toFixed(1)}
          </output>
          <p className="mt-2 text-[10px] leading-5 text-slate-400">
            {model?.available
              ? "AI model estimate"
              : research?.projectedStat
                ? `${research.projectedStat.sampleSize} games · recent-form estimate`
                : "Needs verified history"}
          </p>
        </section>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(["OVER", "UNDER"] as const).map((s) => (
          <button
            key={s}
            disabled={!!pending}
            aria-pressed={side === s}
            onClick={() => setSide(s)}
            className={`rounded-xl py-3 text-sm font-bold ${side === s ? "bg-emerald-500 text-[#06130f]" : "border border-slate-700 text-slate-400"}`}
          >
            {s}
          </button>
        ))}
      </div>
      {!research ? (
        <p
          role="status"
          className="my-7 flex items-center gap-2 text-sm text-slate-400"
        >
          <LoaderCircle size={16} className="animate-spin" />
          Loading verified game history…
        </p>
      ) : !research.available ? (
        <p className="my-7 text-sm text-slate-400">{research.message}</p>
      ) : (
        <>
          <div className="my-4 grid grid-cols-3 gap-2">
            {["l5", "l10", "l20"].map((k) => (
              <div key={k} className="rounded-xl border border-slate-800 p-3">
                <p className="text-xs uppercase text-slate-500">{k}</p>
                <b className="mt-2 block text-lg text-emerald-400">
                  {research.windows?.[k]?.hitRate == null
                    ? "—"
                    : `${Math.round(research.windows[k].hitRate)}%`}
                </b>
                <p className="mt-1 text-[10px] text-slate-500">
                  {research.windows?.[k]?.games ?? 0} games
                </p>
              </div>
            ))}
          </div>
          <svg
            viewBox="0 0 400 180"
            role="img"
            aria-label={`Recent results ${values.map((g) => g.value).join(", ")}, ${side} line ${line}`}
            className="w-full rounded-xl border border-slate-800 bg-[#090d16] p-2"
          >
            {values.map((g, i) => {
              const h = Math.max(1, (g.value / maximum) * 130),
                hit = side === "OVER" ? g.value > line : g.value < line;
              return (
                <g key={i}>
                  <rect
                    x={35 + i * 72}
                    y={150 - h}
                    width="42"
                    height={h}
                    rx="5"
                    fill={
                      g.value === line ? "#64748b" : hit ? "#10b981" : "#9f4657"
                    }
                  />
                  <text
                    x={56 + i * 72}
                    y={143 - h}
                    textAnchor="middle"
                    fill="#cbd5e1"
                    fontSize="11"
                  >
                    {g.value}
                  </text>
                </g>
              );
            })}
            <line
              x1="20"
              x2="390"
              y1={150 - (line / maximum) * 130}
              y2={150 - (line / maximum) * 130}
              stroke="#60a5fa"
              strokeDasharray="4 4"
            />
          </svg>
        </>
      )}
      <button
        disabled={
          !!pending || !research?.available || !research?.gameLog?.length
        }
        onClick={() => run("project")}
        className="my-4 flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/40 px-4 py-3 text-sm font-bold text-emerald-400 disabled:opacity-40"
      >
        <Sparkles size={16} />
        {pending === "project" ? "Generating…" : "Generate AI projection"}
      </button>
      <p className="mb-4 text-[10px] leading-5 text-slate-500">
        The recent-form estimate is a weighted historical baseline, not an AI
        forecast. AI generation is on demand and subject to your account
        allowance. Neither is a guaranteed outcome.
      </p>
      <form
        onSubmit={(e) => run("ask", e)}
        className="rounded-xl border border-slate-800 p-4"
      >
        <h3 className="text-sm font-bold">Ask about this prop</h3>
        <div className="mt-3 flex gap-2">
          <input
            aria-label="Ask prop question"
            value={question}
            maxLength={500}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What does the recent sample show?"
            className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-[#090d16] px-3 py-3 text-sm outline-none focus:border-emerald-500"
          />
          <button
            disabled={!!pending || !research || !question.trim()}
            className="rounded-xl bg-emerald-500 px-4 text-sm font-bold text-[#06130f] disabled:opacity-40"
          >
            {pending === "ask" ? "…" : "Ask"}
          </button>
        </div>
        {answer && (
          <p
            role="status"
            className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-300"
          >
            {answer}
          </p>
        )}
        <p className="mt-3 text-[10px] leading-5 text-slate-500">
          Answers use this card’s data. Not betting advice.
        </p>
      </form>
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-amber-500/20 p-3 text-sm text-amber-300"
        >
          {error}
        </p>
      )}
    </dialog>
  );
}
