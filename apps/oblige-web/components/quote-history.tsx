'use client';

import * as React from 'react';
import { fetchQuoteHistory, historyTarget, type QuoteHistoryPoint } from '@/lib/market-reference';
import { isDfs, quotePriceLabel } from '@/lib/prop-signals';
import type { PropGroup, Side } from '@/lib/types';
import styles from './premium-player-research.module.css';

export function QuoteHistory({ group, side, book }: { group: PropGroup; side: Side; book?: string | null }) {
  const quote = group.quotes.find(row => String(row.side).toUpperCase() === side && (!book || row.sportsbookKey === book));
  const target = historyTarget(group, quote);
  const key = JSON.stringify([target, group.line]);
  const [open, setOpen] = React.useState(false), [retry, setRetry] = React.useState(0);
  const [state, setState] = React.useState<{ key: string; points: QuoteHistoryPoint[]; error: string; loading: boolean }>({ key: '', points: [], error: '', loading: false });
  React.useEffect(() => {
    if (!open || !target || !quote) return;
    const controller = new AbortController();
    setState({ key, points: [], error: '', loading: true });
    void fetchQuoteHistory(group, quote, controller.signal).then(points => {
      if (!controller.signal.aborted) setState({ key, points, error: '', loading: false });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ key, points: [], error: error instanceof Error ? error.message : 'Line history could not load.', loading: false });
    });
    return () => controller.abort();
    // The selection includes provider event/outcome IDs, book, side and current line.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key, retry]);
  const active = state.key === key ? state : null;
  return <details className={styles.gameLog} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Line history</summary>
    <div className={styles.historyBody}>
      {!target ? <p>No verified outcome identifier is available for this quote.</p> : !active || active.loading ? <p>Loading recorded changes…</p> : active.error ? <><p role="alert">{active.error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Retry line history</button></> : !active.points.length ? <p>PropLine has no recorded changes for this exact outcome.</p> : <><p>PropLine · {quote?.sportsbook || target.book} · {target.side}</p><table><thead><tr><th>Recorded</th><th>Line</th><th>Odds/product</th></tr></thead><tbody>{active.points.slice(0, 20).map((point, index) => <tr key={`${point.at}:${point.line}:${index}`}><td>{new Date(point.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td><td>{point.line}</td><td>{isDfs(quote) ? 'Entry payout' : quotePriceLabel({ ...quote, price: point.price ?? undefined })}</td></tr>)}</tbody></table></>}
    </div>
  </details>;
}
