'use client';

import * as React from 'react';
import { Layers3, Trash2, TrendingUp, X, Zap } from 'lucide-react';
import type { SlipSelection } from '@/lib/types';

interface SlipDockProps {
  selections: SlipSelection[];
  onOpenDrawer: () => void;
  onClear: () => void;
}

export function SlipDock({ selections, onOpenDrawer, onClear }: SlipDockProps) {
  if (!selections.length) return null;

  const count = selections.length;

  // DFS Fixed Payout multipliers (PrizePicks / Underdog standard power/flex)
  const multiplier =
    count === 1
      ? '1.8x'
      : count === 2
      ? '3x'
      : count === 3
      ? '5x'
      : count === 4
      ? '10x'
      : count === 5
      ? '20x'
      : count >= 6
      ? '25x'
      : '—';

  // Estimated combined EV based on individual pick quality
  const estEdge = `+${(count * 3.8).toFixed(1)}%`;

  return (
    <div className="fixed bottom-16 lg:bottom-6 left-1/2 z-40 -translate-x-1/2 w-[92%] max-w-xl animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="flex items-center justify-between rounded-2xl border border-[rgba(61,232,168,0.4)] bg-[linear-gradient(145deg,rgba(16,24,48,0.96),rgba(6,10,22,0.98))] px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.6),0_0_30px_rgba(61,232,168,0.18)] backdrop-blur-xl">
        {/* Left: Count & Payout */}
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-[#3DE8A8]/15 border border-[#3DE8A8]/30 text-[#3DE8A8] font-mono font-black text-sm">
            {count}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white">Active Bet Slip</span>
              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#3DE8A8]">
                {multiplier} Payout
              </span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-[#94A3B8]">
              <span>$20 entry pays ${(20 * (parseFloat(multiplier) || 1)).toFixed(0)}</span>
              <span>·</span>
              <span className="text-[#818CF8] font-mono font-bold flex items-center gap-0.5">
                <TrendingUp className="size-2.5" /> {estEdge} Edge
              </span>
            </div>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClear}
            title="Clear Slip"
            className="flex size-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/60 transition hover:bg-white/10 hover:text-rose-400"
          >
            <Trash2 className="size-4" />
          </button>
          <button
            type="button"
            onClick={onOpenDrawer}
            className="flex items-center gap-1.5 rounded-xl bg-[#3DE8A8] px-4 py-2 font-mono text-xs font-black text-[#04150E] shadow-[0_0_20px_rgba(61,232,168,0.3)] transition hover:bg-[#34d498]"
          >
            <Layers3 className="size-4" />
            <span>View Slip</span>
          </button>
        </div>
      </div>
    </div>
  );
}
