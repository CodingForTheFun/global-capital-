'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronRight, Radio } from 'lucide-react';
import type { PropGroup, PropRow } from '@/lib/types';
import { fetchBoard } from '@/lib/api';

const PREVIEW_SPORT = 'NFL';

function marketLabel(value: string) {
  return String(value || '')
    .replace(/^player_/i, '')
    .replace(/_/g, ' ')
    .replace(/\byds\b/gi, 'yards')
    .replace(/\brec\b/gi, 'receptions')
    .replace(/\bpts\b/gi, 'points')
    .replace(/\bast\b/gi, 'assists')
    .replace(/\breb\b/gi, 'rebounds')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function priceLabel(value: PropRow['price']) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return '—';
  return parsed > 0 ? `+${parsed}` : String(parsed);
}

function bookLabel(value: string | undefined) {
  const raw = String(value || '').trim().toLowerCase();
  const known: Record<string, string> = {
    draftkings: 'DraftKings',
    fanduel: 'FanDuel',
    betmgm: 'BetMGM',
    prizepicks: 'PrizePicks',
    underdog: 'Underdog',
    betrivers: 'BetRivers',
    pinnacle: 'Pinnacle',
    bovada: 'Bovada',
  };
  return known[raw] || (raw ? raw.replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Book');
}

function quoteFor(group: PropGroup) {
  return group.bestOver || group.bestUnder || group.quotes[0] || null;
}

function rowSide(group: PropGroup) {
  if (group.bestOver) return 'O';
  if (group.bestUnder) return 'U';
  return '';
}

function LiveRow({ group }: { group: PropGroup }) {
  const quote = quoteFor(group);
  return (
    <div className="landing-live-board__row">
      <div className="landing-live-board__player">
        <span className="landing-live-board__sport">{group.sport.slice(0, 4)}</span>
        <span className="landing-live-board__copy">
          <strong>{group.player}</strong>
          <small>{marketLabel(group.market)}</small>
        </span>
      </div>
      <div className="landing-live-board__market">
        <strong className="num">{rowSide(group)} {group.line}</strong>
        <small>{bookLabel(quote?.sportsbook || quote?.sportsbookKey)} · {priceLabel(quote?.price)}</small>
      </div>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="landing-live-board__loading" aria-label="Loading live props">
      {[0, 1, 2].map((row) => (
        <div key={row} className="landing-live-board__skeleton" aria-hidden="true">
          <i />
          <span><b /><b /></span>
          <em />
        </div>
      ))}
    </div>
  );
}

export function LandingBoardPreview() {
  const [groups, setGroups] = React.useState<PropGroup[] | null>(null);
  const [unavailable, setUnavailable] = React.useState(false);

  React.useEffect(() => {
    const controller = new AbortController();
    fetchBoard(PREVIEW_SPORT, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setGroups(result.groups.slice(0, 3));
        setUnavailable(result.groups.length === 0);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setGroups([]);
        setUnavailable(true);
      });
    return () => controller.abort();
  }, []);

  return (
    <section className="landing-live-board" aria-label="Oblige Props live board preview" data-home-preview-state={groups === null ? 'loading' : unavailable ? 'unavailable' : 'live'}>
      <div className="landing-live-board__top">
        <div>
          <span className="landing-live-board__status"><Radio className="size-3.5" aria-hidden="true" /> Live props</span>
          <p>Current lines when your board session is available.</p>
        </div>
        <Link href="/board" className="landing-live-board__see-all">
          See all <ChevronRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>

      <div className="landing-live-board__head" aria-hidden="true">
        <span>Player / market</span>
        <span>Line / book</span>
      </div>

      {groups === null ? (
        <LoadingRows />
      ) : groups.length ? (
        <div className="landing-live-board__rows">
          {groups.map((group) => <LiveRow key={group.key} group={group} />)}
        </div>
      ) : (
        <div className="landing-live-board__empty">
          <strong>Live board preview is ready when your session is.</strong>
          <span>Oblige Props never fills this space with made-up lines or percentages.</span>
        </div>
      )}

      <div className="landing-live-board__capabilities" aria-label="Research capabilities">
        <span>Line shop</span>
        <span>History</span>
        <span>Multi-book</span>
        <span>Model signals</span>
      </div>
    </section>
  );
}
