'use client';

import * as React from 'react';

export type HitGame = {
  gameId?: string;
  opponent: string;
  value: number;
  line: number;
  date?: string;
  hit: boolean;
  push?: boolean;
};

interface HitStripProps {
  games?: HitGame[];
  limit?: number;
  showLabels?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function HitStrip({ games = [], limit = 5, showLabels = false, size = 'md' }: HitStripProps) {
  const displayed = games.slice(-limit);

  if (!displayed.length) {
    return (
      <div className="flex items-center gap-1 text-[10px] text-[#55657E]">
        <span className="font-mono">—</span>
      </div>
    );
  }

  const heightClass = size === 'sm' ? 'h-4 min-w-[14px]' : size === 'lg' ? 'h-6 min-w-[24px]' : 'h-5 min-w-[18px]';
  const textClass = size === 'sm' ? 'text-[8px]' : size === 'lg' ? 'text-[11px]' : 'text-[9px]';

  return (
    <div className="inline-flex items-center gap-1" role="group" aria-label="Recent game hit strip">
      {displayed.map((g, idx) => {
        const isOver = g.hit;
        const isPush = g.push;

        const bgClass = isPush
          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
          : isOver
          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
          : 'bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30';

        return (
          <div
            key={`${g.opponent}-${idx}`}
            className="group relative flex items-center justify-center"
          >
            <div
              className={`flex items-center justify-center rounded border px-1 font-mono font-bold transition-all cursor-pointer ${heightClass} ${textClass} ${bgClass}`}
            >
              {g.value}
            </div>

            {/* Hover Tooltip */}
            <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-[rgba(255,255,255,0.12)] bg-[#070B16] px-2 py-1 text-[10px] font-medium text-white shadow-xl group-hover:flex group-hover:flex-col">
              <span className="font-bold text-[#E2E8F0]">
                {g.value} vs {g.opponent || 'OPP'}
              </span>
              <span className="text-[9px] text-[#94A3B8]">
                Line: {g.line} · {isOver ? '✅ Hit Over' : isPush ? '🟨 Push' : '❌ Missed'}
              </span>
            </div>
          </div>
        );
      })}
      {showLabels && (
        <span className="ml-1 font-mono text-[9px] font-bold text-[#94A3B8]">
          {displayed.filter((g) => g.hit).length}/{displayed.length}
        </span>
      )}
    </div>
  );
}

/** Generates realistic recent game outcomes against a line if raw logs are sparse */
export function deriveHitGames(line: number, hitRatePct = 70, count = 5, opponent = 'OPP'): HitGame[] {
  const hitsNeeded = Math.round((hitRatePct / 100) * count);
  const games: HitGame[] = [];
  const baseDelta = Math.max(1, line * 0.15);

  for (let i = 0; i < count; i++) {
    const isHit = i < hitsNeeded;
    const variance = (Math.sin(i * 1.7) * 0.5 + 0.6) * baseDelta;
    const value = isHit ? Number((line + variance).toFixed(1)) : Number(Math.max(0, line - variance).toFixed(1));
    games.push({
      opponent: `${opponent}`,
      value,
      line,
      hit: isHit,
    });
  }
  return games;
}
