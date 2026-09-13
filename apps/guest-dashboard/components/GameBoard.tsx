"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ChevronDown,
  LoaderCircle,
  RefreshCw,
  Search,
  Ticket,
  Trash2,
  Star,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { decimalOdds, displayPrice } from "@/lib/sports-workspace";

type Outcome = { name: string; price: number; point: number | null };
type Market = { marketKey: string; updatedAt: string | null; outcomes: Outcome[] };
type Book = { sportsbookKey: string; name: string; markets: Market[] };
type Game = {
  id: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  status: string;
  books: Book[];
};
type Selection = Outcome & {
  id: string;
  gameId: string;
  book: string;
  bookKey: string;
  market: string;
  matchup: string;
  capturedAt: string;
};
type Board = {
  available: boolean;
  games: Game[];
  fetchedAt?: string;
  message?: string;
  stale?: boolean;
  warning?: string;
  coverage?: { note?: string };
};
const surface = "rounded-2xl border border-slate-800 bg-[#111726]";
const field =
  "w-full rounded-xl border border-slate-700 bg-[#090d16] px-3 py-3 text-sm text-slate-100 outline-none focus:border-emerald-500";
const labels: Record<string, string> = {
  h2h: "Moneyline",
  spreads: "Spread",
  totals: "Total",
};
export default function GameBoard({
  sport,
  accountId,
  liveOnly = false,
}: {
  sport: string;
  accountId: string;
  liveOnly?: boolean;
}) {
  const [board, setBoard] = useState<Board | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [revision, setRevision] = useState(0),
    [search, setSearch] = useState(""),
    [book, setBook] = useState("all"),
    [selected, setSelected] = useState<Selection[]>([]);
  const [oddsFormat, setOddsFormat] = useState<"american" | "decimal">("american");
  const [favoriteGames, setFavoriteGames] = useState<string[]>([]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  useEffect(() => {
    try { if (localStorage.getItem("oblige-odds-format") === "decimal") setOddsFormat("decimal"); } catch {}
  }, []);
  useEffect(() => {
    setFavoritesOnly(false);
    try {
      const stored = JSON.parse(sessionStorage.getItem(`oblige-game-favorites:${accountId}`) || "[]");
      setFavoriteGames(Array.isArray(stored) ? stored.filter((x): x is string => typeof x === "string").slice(0,200) : []);
    } catch { setFavoriteGames([]); }
  }, [accountId]);
  const showPrice = (price: number) => oddsFormat === "decimal" ? decimalOdds(price)?.toFixed(2) ?? "Unavailable" : displayPrice(price);
  function favorite(id: string) {
    const next = favoriteGames.includes(id) ? favoriteGames.filter(x => x !== id) : [...favoriteGames, id].slice(-200);
    setFavoriteGames(next);
    try { sessionStorage.setItem(`oblige-game-favorites:${accountId}`, JSON.stringify(next)); } catch {}
  }
  const [amount, setAmount] = useState("10"),
    [mode, setMode] = useState<"single" | "parlay">("single");
  useEffect(() => {
    let active = true;
    const c = new AbortController();
    setLoading(true);
    setBoard(null);
    setError("");
    setBook("all");
    const timer = setTimeout(() => c.abort(), 25000);
    fetch(`/api/apex/game-markets?sport=${encodeURIComponent(sport)}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: c.signal,
    })
      .then(async (r) => {
        if (!r.ok)
          throw Error(
            r.status === 401
              ? "Your session expired. Log in again."
              : "Game odds could not load.",
          );
        return r.json();
      })
      .then((data) => {
        if (active) setBoard(data);
      })
      .catch((e) => {
        if (active)
          setError(
            c.signal.aborted
              ? "Game odds request timed out. Try again."
              : e.message,
          );
      })
      .finally(() => {
        clearTimeout(timer);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      c.abort();
      clearTimeout(timer);
    };
  }, [sport, revision]);
  useEffect(() => {
    setSelected([]);
  }, [accountId]);
  const books = useMemo(
    () => [
      ...new Map(
        (board?.games || []).flatMap((g) =>
          g.books.map((b) => [b.sportsbookKey, b.name] as const),
        ),
      ).entries(),
    ],
    [board],
  );
  const games = (board?.games || []).filter(
    (g) =>
      (!search ||
        `${g.homeTeam} ${g.awayTeam}`
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (!liveOnly || g.status === "LIVE") &&
      (!favoritesOnly || favoriteGames.includes(g.id)) &&
      (book === "all" || g.books.some((b) => b.sportsbookKey === book)),
  );
  function exportGameQuotes() {
    const cells: (string | number | null)[][] = [["Event", "Scheduled start", "Book", "Market", "Selection", "Line", "American odds", "Book updated at"]];
    for (const game of games) for (const source of game.books) {
      if (book !== "all" && source.sportsbookKey !== book) continue;
      for (const market of source.markets) for (const outcome of market.outcomes)
        cells.push([`${game.awayTeam} @ ${game.homeTeam}`, game.startTime, source.name, labels[market.marketKey] || market.marketKey, outcome.name, outcome.point, outcome.price, market.updatedAt]);
    }
    const csv = cells.map(row => row.map(value => {
      let text = value === null ? "" : String(value);
      if (typeof value === "string" && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`;
    }).join(",")).join("\r\n");
    const href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = href; link.download = `obligepay-${sport.toLowerCase()}-game-quotes.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  function toggle(game: Game, b: Book, m: Market, o: Outcome) {
    const id = JSON.stringify([game.id, b.sportsbookKey, m.marketKey, o.name, o.point]);
    setSelected((rows) =>
      rows.some((r) => r.id === id)
        ? rows.filter((r) => r.id !== id)
        : [
            ...rows.filter(
              (r) => !(r.gameId === game.id && r.market === m.marketKey),
            ),
            {
              ...o,
              id,
              gameId: game.id,
              book: b.name,
              bookKey: b.sportsbookKey,
              market: m.marketKey,
              matchup: `${game.awayTeam} @ ${game.homeTeam}`,
              capturedAt: new Date().toISOString(),
            },
          ].slice(-20),
    );
  }
  const stake = amount.trim() ? Number(amount) : NaN;
  const correlated =
    new Set(selected.map((s) => s.gameId)).size !== selected.length;
  const mixedBooks = new Set(selected.map((s) => s.bookKey)).size > 1;
  const parlayUnavailable = mode === "parlay" && (correlated || mixedBooks);
  const multiplier =
    mode === "single"
      ? selected.reduce((sum, s) => sum + (decimalOdds(s.price) || 0), 0)
      : selected.reduce((p, s) => p * (decimalOdds(s.price) || 0), 1);
  const total =
    !selected.length ||
    parlayUnavailable ||
    !Number.isFinite(stake) ||
    stake <= 0 ||
    stake > 1000000
      ? null
      : stake * multiplier;
  const outlay = Number.isFinite(stake)
    ? stake * (mode === "single" ? selected.length : 1)
    : null;
  return (
    <section
      aria-label="Game markets"
      className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_300px]"
    >
      <div className="min-w-0">
        <div className="mb-4 grid grid-cols-[minmax(0,1fr)_44px] gap-2 sm:grid-cols-[minmax(0,1fr)_170px_44px]">
          <label className="relative col-span-2 sm:col-span-1">
            <Search
              size={16}
              className="absolute left-3 top-3.5 text-slate-500"
            />
            <input
              aria-label="Search games"
              placeholder="Search games or teams…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`${field} pl-9`}
            />
          </label>
          <select
            aria-label="Game sportsbook"
            value={book}
            onChange={(e) => setBook(e.target.value)}
            className={field}
          >
            <option value="all">All returned books</option>
            {books.map(([k, n]) => (
              <option key={k} value={k}>
                {n}
              </option>
            ))}
          </select>
          <button
            aria-label="Refresh game odds"
            disabled={loading}
            onClick={() => setRevision((r) => r + 1)}
            className="grid place-items-center rounded-xl border border-slate-700 text-slate-300 disabled:opacity-40"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-[#0d1922] p-2">
          <div role="group" aria-label="Odds display format" className="flex rounded-lg border border-slate-700 p-1">
            {(["american", "decimal"] as const).map(format => <button key={format} type="button" aria-pressed={oddsFormat === format}
              onClick={() => { setOddsFormat(format); try { localStorage.setItem("oblige-odds-format", format); } catch {} }}
              className={`rounded-md px-3 py-2 text-xs font-semibold capitalize ${oddsFormat === format ? "bg-emerald-500/15 text-emerald-300" : "text-slate-400"}`}>{format}</button>)}
          </div>
          <button type="button" aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(value => !value)} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs ${favoritesOnly ? "border-emerald-500 text-emerald-300" : "border-slate-700 text-slate-300"}`}><Star size={14} aria-hidden="true"/>Favorites</button>
          <button type="button" onClick={exportGameQuotes} disabled={!games.length || loading} className="ml-auto inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2.5 text-xs text-slate-300 disabled:opacity-40"><Download size={14} aria-hidden="true"/>Export quotes</button>
        </div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">
            {sport} · {liveOnly ? "Confirmed live games" : "Game lines"}
          </h2>
          <span className="text-xs text-slate-500">
            {games.length} events · {books.length} books
          </span>
        </div>
        <p className="mb-4 text-xs leading-5 text-slate-500">
          Quotes are cached snapshots, not guaranteed execution prices. A
          scheduled start is not proof a game is live.
        </p>
        {board?.stale && (
          <p
            role="status"
            className="mb-3 rounded-xl border border-amber-500/30 p-3 text-sm text-amber-300"
          >
            {board.warning}
          </p>
        )}
        {loading ? (
          <div
            role="status"
            className={`${surface} flex items-center gap-3 p-8 text-slate-400`}
          >
            <LoaderCircle size={19} className="animate-spin" />
            Loading game odds…
          </div>
        ) : error || !board?.available ? (
          <div role="alert" className={`${surface} p-8 text-sm text-slate-400`}>
            {error || board?.message || "Game odds are unavailable."}
          </div>
        ) : !games.length ? (
          <div className={`${surface} p-10 text-center`}>
            <Activity className="mx-auto mb-3 text-slate-600" />
            <h3 className="font-semibold">
              {liveOnly
                ? "Live status is not verified by this feed"
                : "No game lines match"}
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              Try another sport or clear your filters. No sample games are
              substituted.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {games.map((game) => {
              const shown =
                book === "all"
                  ? game.books
                  : game.books.filter((b) => b.sportsbookKey === book);
              return (
                <article key={game.id} className={`${surface} overflow-hidden`}>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">
                      {game.status === "LIVE" ? "Confirmed live" : game.status === "SCHEDULED"
                        ? "Upcoming"
                        : "Status unconfirmed"}
                    </span>
                    <time
                      className="text-xs text-slate-500"
                      dateTime={game.startTime}
                    >
                      {new Date(game.startTime).toLocaleString([], {
                        weekday: "short",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <div className="flex items-start justify-between gap-3 p-4">
                    <div><p className="text-sm font-semibold">{game.awayTeam}</p>
                    <p className="mt-2 text-sm font-semibold">
                      <span className="mr-2 text-slate-600">@</span>
                      {game.homeTeam}
                    </p></div>
                    <button type="button" aria-label={`Favorite ${game.awayTeam} at ${game.homeTeam}`} aria-pressed={favoriteGames.includes(game.id)} onClick={() => favorite(game.id)} className="rounded-lg border border-slate-700 p-2.5 text-emerald-300 hover:border-emerald-500"><Star size={16} fill={favoriteGames.includes(game.id) ? "currentColor" : "none"}/></button>
                  </div>
                  {shown.map((b, i) => (
                    <details
                      key={b.sportsbookKey}
                      open={i === 0 || book !== "all"}
                      className="border-t border-slate-800"
                    >
                      <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-xs font-semibold text-slate-300">
                        {b.name}
                        <ChevronDown size={14} />
                      </summary>
                      <div className="grid grid-cols-3 gap-2 px-3 pb-4">
                        {["spreads", "h2h", "totals"].map((key) => {
                          const m = b.markets.find((x) => x.marketKey === key);
                          return (
                            <div key={key}>
                              <p className="mb-2 text-center text-[10px] uppercase tracking-wider text-slate-500">
                                {labels[key]}
                              </p>
                              <div className="space-y-1.5">
                                {m?.outcomes.map((o) => {
                                  const id = JSON.stringify([
                                      game.id,
                                      b.sportsbookKey,
                                      m.marketKey,
                                      o.name,
                                      o.point,
                                    ]),
                                    active = selected.some((x) => x.id === id);
                                  return (
                                    <button
                                      key={id}
                                      aria-label={`${game.awayTeam} ${b.name} ${labels[key]} ${o.name}`}
                                      aria-pressed={active}
                                      onClick={() => toggle(game, b, m, o)}
                                      className={`w-full rounded-lg border px-2 py-2.5 text-center transition ${active ? "border-emerald-500 bg-emerald-500/15 shadow-[0_0_18px_#10b98118]" : "border-slate-700 bg-[#0b111d] hover:border-emerald-500/60"}`}
                                    >
                                      <span className="block truncate text-[10px] text-slate-400">
                                        {o.name}
                                      </span>
                                      <b className="mt-1 block text-xs text-white">
                                        {key === "h2h"
                                          ? showPrice(o.price)
                                          : `${key === "totals" ? (o.name === "Over" ? "O" : "U") : o.point! >= 0 ? "+" : ""}${o.point}`}
                                      </b>
                                      {key !== "h2h" && (
                                        <span className="mt-0.5 block text-[11px] text-emerald-400">
                                          {showPrice(o.price)}
                                        </span>
                                      )}
                                    </button>
                                  );
                                }) || (
                                  <div className="rounded-lg border border-dashed border-slate-800 p-4 text-center text-[10px] text-slate-600">
                                    Unavailable
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <p className="px-4 pb-3 text-[10px] text-slate-500">
                        Quote time:{" "}
                        {b.markets[0]?.updatedAt
                          ? new Date(
                              b.markets[0].updatedAt!,
                            ).toLocaleTimeString()
                          : "Not supplied"}
                      </p>
                    </details>
                  ))}
                </article>
              );
            })}
          </div>
        )}
        <p className="mt-4 text-[11px] leading-5 text-slate-500">
          {board?.coverage?.note}
        </p>
      </div>
      <aside className="min-w-0">
        <div className={`${surface} sticky top-24 overflow-hidden`}>
          <h2 className="flex items-center gap-2 border-b border-slate-800 p-5 font-bold">
            <Ticket size={18} className="text-emerald-400" />
            Betslip{" "}
            <span className="ml-auto rounded bg-emerald-500/10 px-2 py-1 text-xs text-emerald-400">
              {selected.length}
            </span>
          </h2>
          <div className="p-4">
            <div className="mb-4 grid grid-cols-2 rounded-xl border border-slate-800 bg-[#090d16] p-1">
              {(["single", "parlay"] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => setMode(value)}
                  aria-pressed={mode === value}
                  className={`rounded-lg py-2 text-xs font-bold capitalize ${mode === value ? "bg-slate-800 text-white" : "text-slate-500"}`}
                >
                  {value}
                </button>
              ))}
            </div>
            {!selected.length ? (
              <div className="py-7 text-center">
                <Ticket size={32} className="mx-auto mb-3 text-slate-600" />
                <p className="text-sm font-semibold">
                  Your selections start here
                </p>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  Choose game odds to calculate potential returns.
                </p>
              </div>
            ) : (
              <div className="max-h-[45vh] space-y-3 overflow-y-auto">
                {selected.map((s) => (
                  <article
                    key={s.id}
                    className="rounded-xl border border-slate-800 bg-[#090d16] p-3"
                  >
                    <div className="flex justify-between gap-2">
                      <b className="text-xs">{s.name}</b>
                      <button
                        aria-label={`Remove game selection ${s.name}`}
                        onClick={() =>
                          setSelected((rows) =>
                            rows.filter((r) => r.id !== s.id),
                          )
                        }
                      >
                        <Trash2
                          size={14}
                          className="text-slate-500 hover:text-rose-400"
                        />
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] text-slate-500">
                      {s.matchup}
                    </p>
                    <div className="mt-2 flex justify-between text-xs">
                      <span className="text-slate-400">
                        {labels[s.market]} {s.point ?? ""}
                      </span>
                      <b className="text-emerald-400">
                        {showPrice(s.price)}
                      </b>
                    </div>
                    <p className="mt-2 text-[10px] text-slate-600">
                      {s.book} · selected quote snapshot
                    </p>
                  </article>
                ))}
              </div>
            )}
            <label className="mt-4 block text-xs text-slate-400">
              {mode === "single"
                ? "Reference stake per single"
                : "Reference parlay stake"}
              <input
                aria-label="Reference stake"
                type="number"
                min="0"
                max="1000000"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={`${field} mt-2`}
              />
            </label>
            {parlayUnavailable && (
              <p className="mt-3 text-xs leading-5 text-amber-300">
                A combined price needs a single book and independent games.
                Same-game or mixed-book payouts cannot be multiplied reliably.
              </p>
            )}
            <div className="my-4 flex justify-between text-xs text-slate-400">
              <span>Reference total</span>
              <span>
                {outlay !== null && outlay >= 0 ? outlay.toFixed(2) : "—"}
              </span>
            </div>
            <div className="mb-4 flex justify-between text-sm">
              <span>Illustrative return</span>
              <output
                data-testid="game-return"
                className="font-bold text-emerald-400"
              >
                {total === null ? "Unavailable" : total.toFixed(2)}
              </output>
            </div>
            <button
              disabled={!selected.length}
              onClick={() =>
                toast.info("No wager submitted", {
                  description:
                    "This is a quote calculator. ObligePay does not process bets, deposits, or withdrawals.",
                })
              }
              className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-bold text-[#06130f] hover:bg-emerald-400 disabled:opacity-40"
            >
              Review selections
            </button>
            <p className="mt-3 text-[10px] leading-5 text-slate-500">
              Calculator only. No money is deducted. Returns include the
              reference stake. Prices may change; no bet is placed here.
            </p>
          </div>
        </div>
      </aside>
    </section>
  );
}
