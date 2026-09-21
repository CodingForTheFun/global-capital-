'use client';
import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, BarChart3, ChevronDown, Star } from 'lucide-react';
import { DfsVariantIcon } from '@/components/dfs-variant-icon';
import { PlayerHeadshot } from '@/components/player-headshot';
import { booksFor, chooseOffer, type WorkspacePlayer, type WorkspaceMarket, type WorkspaceOffer } from '@/lib/workspace';
import { marketFamily, marketName, marketOptionName, offerPrice, offerVariantLabel, periodName, sportName } from '@/lib/market-display';
import { shortTime } from '@/lib/utils';
import type { Side } from '@/lib/types';
import s from './premium-player-research.module.css';

export type PremiumPlayerResearchProps = {
  analysisSections?: React.ReactNode;
  player: WorkspacePlayer; market: WorkspaceMarket; selected: WorkspaceOffer;
  side: Side; favourite: boolean; canFollow: boolean;
  onCategory(key: string): void; onBook(key: string): void;
  onOffer(offer: WorkspaceOffer): void; onFavourite(): void;
  research: React.ReactNode; model: React.ReactNode; gameLog?: React.ReactNode; quoteHistory?: React.ReactNode; historyRetry?: React.ReactNode;
  /** Undefined uses the canonical selected book; null retains legacy best prices. */
  bookSelection?: string | null; allowBestPrices?: boolean; onLine?(line: number): void;
  team?: string | null; matchupLabel?: string; supporting?: React.ReactNode;
  routeKind?: 'canonical' | 'legacy-board-premium-v2';
};

/** Shared presentation only. Both URL formats keep their own verified data adapters. */
export function PremiumPlayerResearch({ player, market, selected, side, favourite, canFollow, onCategory, onBook, onOffer, onFavourite, research, model, gameLog, quoteHistory, bookSelection, allowBestPrices = false, onLine, team, matchupLabel, supporting, routeKind = 'canonical', analysisSections }: PremiumPlayerResearchProps) {
  const family = marketFamily(market);
  const families = [...new Map(player.markets.map(item => [marketFamily(item), item])).values()];
  const periods = player.markets.filter(item => marketFamily(item) === family);
  const currentBook = bookSelection === undefined ? selected.book : bookSelection;
  const bookOffers = market.offers.filter(offer => !currentBook || offer.book === currentBook);
  const numeric = bookOffers.length > 0 && bookOffers.every(offer => offer.line !== null && !!offer.side);
  const lines = [...new Set(bookOffers.filter(offer => offer.line !== null).map(offer => offer.line!))].sort((a, b) => a - b);
  const title = marketName(market);
  // The hero sportsbook selector is intentionally line-specific: only books
  // carrying the exact displayed prop/line are useful here. Books that carry
  // only a different line remain available in the comparison rail below.
  const applicableBooks = booksFor(market).filter(book => market.offers.some(offer =>
    offer.book === book.key && !offer.conflict &&
    (selected.line === null ? offer.line === null && offer.choice === selected.choice : offer.line === selected.line)
  ));
  const game = matchupLabel || [player.awayTeam, player.homeTeam].filter(Boolean).join(' @ ') || 'Matchup unavailable';
  function category(next: WorkspaceMarket) {
    const samePeriod = player.markets.find(item => marketFamily(item) === marketFamily(next) && item.period === market.period);
    onCategory((samePeriod || next).key);
  }
  return <div className={s.page} data-release="canonical-workspace-v1" data-design="premium-player-research-v1" data-research-route={routeKind}>
    <div className={s.breadcrumb}><Link href="/board"><ArrowLeft size={16} aria-hidden="true"/> Back to props</Link><span>Player research</span></div>
    {analysisSections&&<nav aria-label="Player analysis navigation" className="flex gap-2 overflow-x-auto py-3 text-xs"><a className="flex min-h-11 items-center rounded-md border border-slate-700 px-4" href="#analysis-chart">Performance</a><a className="flex min-h-11 items-center rounded-md border border-slate-700 px-4" href="#analysis-averages">Averages</a><a className="flex min-h-11 items-center rounded-md border border-slate-700 px-4" href="#analysis-defense">Matchup</a><a className="flex min-h-11 items-center rounded-md border border-slate-700 px-4" href="#analysis-log">Game log</a></nav>}
    <div className={s.layout}>
      <section className={s.primary} aria-label="Player research workspace">
        <div className={s.hero} data-research-hero>
          <div className={s.identity}>
            <span className={s.avatar}><PlayerHeadshot sport={player.sport} name={player.name} providerPlayerId={player.playerId} team={team}/></span>
            <div className={s.playerInfo}><h1>{player.name}</h1><p>{game}</p><div className={s.meta}><span className={s.league}>{sportName(player.sport)}</span><time>{shortTime(player.startsAt) || 'Time unavailable'}</time></div></div>
            <button type="button" className={s.follow} aria-label={favourite ? `Unfollow ${player.name}` : `Follow ${player.name}`} aria-pressed={favourite} disabled={!canFollow} onClick={onFavourite} title="Follow on this device"><Star size={20} fill={favourite ? 'currentColor' : 'none'}/></button>
          </div>
          <div className={s.marketBand}>
            <BarChart3 size={23} className={s.marketIcon} aria-hidden="true"/>
            <div className={s.marketInfo}><h2>{title}</h2><p><span>{selected.side === 'OVER' ? 'O' : selected.side === 'UNDER' ? 'U' : selected.choice} {selected.line ?? ''}</span><strong data-side={selected.side} data-variant={selected.dfsOddsType}><DfsVariantIcon variant={selected?.dfsOddsType}/>{offerPrice(selected)}</strong><span className={s.periodCaption}>{periodName(market.period)}</span></p></div>
            <label className={s.bookSelect}><span className={s.srOnly}>Sportsbook</span><select aria-label="Selected book" value={currentBook || ''} onChange={event => onBook(event.target.value)}>{allowBestPrices && <option value="">Best prices · all books</option>}{applicableBooks.map(book => <option key={book.key} value={book.key}>{book.name}</option>)}</select><ChevronDown size={15} aria-hidden="true"/></label>
          </div>
        </div>
        <div className={s.statControls}>
          <div className={s.statRail} role="group" aria-label="Stat categories">
            {families.map(item => <button key={marketFamily(item)} type="button" aria-pressed={marketFamily(item) === family} title={marketOptionName(item)} onClick={() => category(item)}>{marketName(item)}{offerVariantLabel(item.offers[0]) && <span className={s.variant} data-variant={item.offers[0]?.dfsOddsType}><DfsVariantIcon variant={item.offers[0]?.dfsOddsType}/>{offerVariantLabel(item.offers[0])}</span>}</button>)}
          </div>
          <label className={s.allStats}><span aria-hidden="true">All stats <ChevronDown size={13}/></span><select aria-label="Player stat category" value={market.key} onChange={event => onCategory(event.target.value)}>{player.markets.map(item => <option key={item.key} value={item.key}>{marketOptionName(item)}</option>)}</select></label>
        </div>
        <div className={s.periodControls}>
          <div className={s.periodRail} role="group" aria-label="Available game periods">{periods.map(item => <button key={item.key} type="button" aria-pressed={item.key === market.key} onClick={() => onCategory(item.key)}>{periodName(item.period)}</button>)}</div>
          <label className={s.lineSelect}><span>{numeric ? 'Posted line' : 'Outcome'}</span><select aria-label="Posted line or outcome" value={numeric ? String(selected.line) : selected.key} onChange={event => {
            if (numeric && onLine) { onLine(Number(event.target.value)); return; }
            const next = numeric ? chooseOffer(market, currentBook, Number(event.target.value), side) : bookOffers.find(offer => offer.key === event.target.value);
            if (next) onOffer(next);
          }}>{numeric ? lines.map(line => <option key={line} value={line}>{line}</option>) : bookOffers.map(offer => <option key={offer.key} value={offer.key}>{offer.choice}</option>)}</select></label>
        </div>
        <div className={s.research}>{research}</div>
        {supporting && <section className={s.books} style={{marginTop: 14}} aria-label="Supporting context">{supporting}</section>}
      </section>
      <aside className={s.sidebar} aria-label="Sportsbook comparison and model">
        <section className={s.books} aria-label="Sportsbook prices"><div className={s.sectionTitle}><h2>Sportsbook prices</h2><span>{booksFor(market).length} books</span></div>
          <div className={s.bookRail}>{booksFor(market).map(book => {
            const base = chooseOffer(market, book.key, selected.line, side);
            if (!base) return null;
            const exact = market.offers.filter(offer => offer.book === book.key && offer.line === base.line);
            const pair = (value: Side) => exact.find(offer => offer.side === value && !offer.conflict);
            return <article key={book.key} className={s.bookCard} data-active={book.key === currentBook}>
              <button type="button" className={s.bookName} onClick={() => onOffer(base)} aria-label={`Select ${book.name}`}><span className={s.bookMark} aria-hidden="true">{book.name.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase()}</span><strong>{book.name}</strong></button>
              <span className={s.bookLine}>{base.line === null ? base.choice : `Line ${base.line}`}{base.line !== selected.line && <small>Different line</small>}</span>
              {base.side ? <div className={s.bookSides}>{(['OVER', 'UNDER'] as const).map(value => {
                const quote = pair(value);
                return <button key={value} type="button" data-side={value} disabled={!quote} aria-label={`${book.name} ${value.toLowerCase()} ${base.line ?? ''} ${offerPrice(quote)}`} aria-pressed={!!quote && selected.key === quote.key} onClick={() => quote && onOffer(quote)}><span>{value === 'OVER' ? 'O' : 'U'}</span><strong><DfsVariantIcon variant={quote?.dfsOddsType}/>{offerPrice(quote)}</strong></button>;
              })}</div> : <button type="button" className={s.outcome} onClick={() => onOffer(base)}><DfsVariantIcon variant={base?.dfsOddsType}/>{offerPrice(base)}</button>}
            </article>;
          })}</div>
          {selected.lineGap != null && <p className={s.priceNote}>Line difference from standard: {selected.lineGap > 0 ? '+' : ''}{selected.lineGap}</p>}
          {selected.liquidity != null && <p className={s.priceNote}>Provider-reported liquidity: {selected.liquidity.toLocaleString()}{selected.liquidityUpdatedAt ? ` · seen ${shortTime(selected.liquidityUpdatedAt)}` : ''}</p>}
          <p className={s.priceNote}>Prices belong to the displayed posted line. DFS multipliers are not sportsbook odds.</p>
          <p className={s.priceNote}>{selected.updatedAt ? `Quote seen ${shortTime(selected.updatedAt)}` : 'Quote timestamp unavailable'}</p>
          <details className={s.allLines}><summary>All posted lines <span>{market.offers.length} quotes</span></summary><div className={s.quoteList}>{market.offers.map(offer => <button key={offer.key} type="button" aria-pressed={selected.key === offer.key} onClick={() => onOffer(offer)}><span>{offer.bookName}<small>{offer.choice} {offer.line ?? ''}</small></span><strong><DfsVariantIcon variant={offer?.dfsOddsType}/>{offerPrice(offer)}</strong></button>)}</div></details>
        </section>
        {quoteHistory}
        {gameLog && <details className={s.gameLog}><summary>Game-by-game results</summary>{gameLog}</details>}
      </aside>
    </div>
    {analysisSections}
    <section className={s.modelChoice} aria-label="Model choice pick">
      <div className={s.modelChoiceTitle}><span>MODEL CHOICE</span><h2>Model choice pick</h2><p>Exact to the selected player, stat, posted line and book.</p></div>
      <div className={s.modelChoiceBody}>{model}</div>
    </section>
  </div>;
}
