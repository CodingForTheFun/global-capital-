'use client';

import * as React from 'react';
import Link from 'next/link';
import { Check, Flame, Lock, Sparkles, X, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ProPaywallModalProps {
  open: boolean;
  onClose: () => void;
  propName?: string;
}

export function ProPaywallModal({ open, onClose, propName }: ProPaywallModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="relative w-full max-w-lg overflow-hidden rounded-[28px] border border-[#3DE8A8]/40 bg-[linear-gradient(165deg,#0d152c,#050814)] p-7 shadow-[0_30px_90px_rgba(0,0,0,0.8),0_0_50px_rgba(61,232,168,0.15)]">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 flex size-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition hover:bg-white/10 hover:text-white"
        >
          <X className="size-4" />
        </button>

        {/* Header Pill */}
        <div className="inline-flex items-center gap-1.5 rounded-full border border-[#3DE8A8]/30 bg-[#3DE8A8]/10 px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-wider text-[#3DE8A8]">
          <Lock className="size-3 text-[#3DE8A8]" />
          <span>Season Pass Feature</span>
        </div>

        <h2 className="mt-3 text-2xl font-black text-white">
          Unlock Today&apos;s High-EV Market Edges
        </h2>
        <p className="mt-1.5 text-xs text-[#94A3B8]">
          {propName
            ? `Detailed +EV pricing and sharp consensus splits for ${propName} and 14+ other props are reserved for Pro members.`
            : 'Join thousands of sharp bettors finding line discrepancies, DFS slip value, and positive expected value daily.'}
        </p>

        {/* Feature List */}
        <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <ul className="grid gap-2.5 text-xs text-[#CBD5E1]">
            <li className="flex items-center gap-2">
              <Check className="size-4 text-[#3DE8A8] shrink-0" />
              <span>
                <strong>Unlimited +EV Scanner</strong> — instant alerts when books misprice a line
              </span>
            </li>
            <li className="flex items-center gap-2">
              <Check className="size-4 text-[#3DE8A8] shrink-0" />
              <span>
                <strong>PrizePicks &amp; Underdog Optimizer</strong> — pinpoint +EV fantasy lines vs sharp books
              </span>
            </li>
            <li className="flex items-center gap-2">
              <Check className="size-4 text-[#3DE8A8] shrink-0" />
              <span>
                <strong>Full 10-Game Hit Strips &amp; DvP Radars</strong> — defense vs position ratings on every card
              </span>
            </li>
            <li className="flex items-center gap-2">
              <Check className="size-4 text-[#3DE8A8] shrink-0" />
              <span>
                <strong>Live WebSocket Sub-Second Odds</strong> — beat the lines before sportsbooks adjust
              </span>
            </li>
          </ul>
        </div>

        {/* Pricing Tiers */}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3.5 text-center">
            <span className="text-[11px] font-bold text-[#94A3B8]">Monthly</span>
            <div className="mt-1 font-mono text-2xl font-black text-white">$29<span className="text-xs font-normal text-[#64748B]">/mo</span></div>
            <p className="mt-1 text-[10px] text-[#64748B]">Cancel anytime</p>
          </div>

          <div className="relative rounded-xl border border-[#3DE8A8]/60 bg-[#3DE8A8]/10 p-3.5 text-center shadow-lg">
            <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-[#3DE8A8] px-2 py-0.5 text-[9px] font-black uppercase text-[#04150E]">
              Save 43%
            </span>
            <span className="text-[11px] font-bold text-[#3DE8A8]">Annual Pass</span>
            <div className="mt-1 font-mono text-2xl font-black text-white">$199<span className="text-xs font-normal text-[#64748B]">/yr</span></div>
            <p className="mt-1 text-[10px] text-[#3DE8A8]">2 months free</p>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-6">
          <Button
            asChild
            className="h-12 w-full rounded-xl bg-[#3DE8A8] font-bold text-[#04150E] shadow-[0_0_30px_rgba(61,232,168,0.4)] hover:bg-[#34d498]"
          >
            <Link href="/account">
              Unlock All Edges Now ($29/mo)
            </Link>
          </Button>
          <p className="mt-2.5 text-center text-[10px] text-[#64748B]">
            Instant access · 7-day money-back guarantee · Secure checkout
          </p>
        </div>
      </div>
    </div>
  );
}
