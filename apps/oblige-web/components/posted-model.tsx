'use client';

import * as React from 'react';
import { fetchPredictions, modelLabel, predictionKey, quoteEv, usablePrediction, type Prediction } from '@/lib/model-data';
import { isDfs } from '@/lib/prop-signals';
import { fetchMarketReferences, referenceKey, type MarketReference } from '@/lib/market-reference';
import type { PropGroup, Side } from '@/lib/types';
import styles from './workspace.module.css';

/** Read the existing model service for the selected, provider-posted quote. */
export function PostedModel({ group, side, book, researchLine }: { group: PropGroup; side: Side; book?: string | null; researchLine: number }) {
  const quote = group.quotes.find(row => String(row.side).toUpperCase() === side && (!book || row.sportsbookKey === book)) || null;
  const selected = { ...group, quotes: quote ? [quote] : [], bestOver: side === 'OVER' ? quote : null, bestUnder: side === 'UNDER' ? quote : null };
  const modelKey = predictionKey(selected);
  const marketKey = referenceKey(selected);
  const key = JSON.stringify([modelKey, marketKey]);
  const [state, setState] = React.useState<{ key: string; prediction?: Prediction; reference?: MarketReference; referenceLoading?: boolean }>({ key: '' });
  const [retry, setRetry] = React.useState(0);
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  React.useEffect(() => {
    if (!quote) return;
    const controller = new AbortController();
    setState({ key });
    void fetchPredictions([selected], controller.signal).then(async results => {
      if (controller.signal.aborted) return;
      const prediction = results[modelKey];
      const referenceLoading = !usablePrediction(prediction);
      setState({ key, prediction, referenceLoading });
      if (referenceLoading) {
        const references = await fetchMarketReferences([selected], controller.signal);
        if (!controller.signal.aborted) setState({ key, prediction, reference: references[marketKey], referenceLoading: false });
      }
    });
    return () => controller.abort();
    // The key contains the exact provider selection; adjusted research lines do not fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, retry]);
  const model = state.key === key ? state.prediction : undefined;
  const exact = Boolean(quote) && researchLine === group.line;
  const valid = exact && usablePrediction(model, now);
  const reference = state.key === key && exact && state.reference && state.reference.expiresAt > now ? state.reference : null;
  const hasReference = reference && (reference.projection !== null || reference.ev !== null);
  const ev = valid ? quoteEv(quote, model, now) : null;
  const reason = !exact ? 'Select a posted line and side to see its forecast.' : !model ? 'Loading the forecast for this quote…' : state.referenceLoading ? 'Checking the PropLine market reference…' : model.available && !valid ? 'This forecast has expired. Refresh to check for a current forecast.' : [model.message, state.reference?.reason].filter(Boolean).join(' ') || 'No verified projection is available for this exact selection.';
  return <section className={styles.panel} aria-label="Posted quote forecast"><h2>{valid ? modelLabel(model) : hasReference ? 'Market reference' : 'Model prediction'}</h2>
    {valid ? <><div className={styles.forecast}><span>Projection<strong>{model.projection!.toFixed(1)}</strong></span><span>Over<strong>{typeof model.probabilityOver === 'number' ? `${(model.probabilityOver * 100).toFixed(1)}%` : 'Unavailable'}</strong></span><span>Under<strong>{typeof model.probabilityUnder === 'number' ? `${(model.probabilityUnder * 100).toFixed(1)}%` : 'Unavailable'}</strong></span><span>Selected-quote EV<strong>{isDfs(quote) ? 'Entry payout' : ev === null ? 'No estimate' : `${ev > 0 ? '+' : ''}${ev.toFixed(1)}%`}</strong></span></div><p className={styles.muted}>{model.validation?.method === 'rolling-player-history' ? 'Adaptive estimate from verified game history, evaluated on earlier games.' : 'Validated on chronological held-out games.'} Version {model.modelVersion}. {isDfs(quote) ? 'DFS payouts depend on the complete entry.' : 'EV includes pushes at zero profit.'}</p></> : !hasReference ? <p className={styles.muted}>{reason}</p> : null}
    {!valid && hasReference && <><div className={styles.forecast}><span>Market-implied projection<strong>{reference.projection === null ? 'No estimate' : reference.projection.toFixed(1)}</strong></span><span>Selected-quote market EV<strong>{isDfs(quote) ? 'Entry payout' : reference.ev === null ? 'No estimate' : `${reference.ev > 0 ? '+' : ''}${reference.ev.toFixed(1)}%`}</strong></span></div><p className={styles.muted}>PropLine no-vig market reference{reference.booksContributing ? ` · ${reference.booksContributing} contributing books` : ''}. These values reflect sportsbook prices. They are separate from a model forecast.</p></>}
    {model && !state.referenceLoading && <button type="button" className={styles.button} onClick={() => setRetry(value => value + 1)}>Refresh forecast</button>}
  </section>;
}
