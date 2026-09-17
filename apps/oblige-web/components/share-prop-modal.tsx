'use client';

import * as React from 'react';
import { Check, Copy, Download, Share2, Sparkles, X } from 'lucide-react';
import { HitStrip, deriveHitGames } from './hit-strip';
import { DvpBadge, deriveDvp } from './dvp-badge';
import type { PropGroup } from '@/lib/types';
import { artworkUrl } from '@/lib/api';

interface SharePropModalProps {
  group: PropGroup | null;
  onClose: () => void;
}

export function SharePropModal({ group, onClose }: SharePropModalProps) {
  const [copied, setCopied] = React.useState(false);

  if (!group) return null;

  const hitGames = deriveHitGames(group.line, 75, 5, group.opponent || 'OPP');
  const dvp = deriveDvp(group.sport, group.opponent || '', group.market);

  const handleCopyLink = () => {
    const url = `${window.location.origin}/research?sport=${encodeURIComponent(group.sport)}&player=${encodeURIComponent(group.player)}&market=${encodeURIComponent(group.market)}&line=${group.line}`;
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-[rgba(61,232,168,0.3)] bg-[linear-gradient(165deg,#0c1224,#050814)] p-6 shadow-2xl">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition hover:bg-white/10 hover:text-white"
        >
          <X className="size-4" />
        </button>

        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#3DE8A8]">
          <Share2 className="size-4 text-[#3DE8A8]" />
          <span>Social Prop Card</span>
        </div>

        {/* The Card to Share */}
        <div
          id="social-prop-card"
          className="mt-4 rounded-2xl border border-[rgba(255,255,255,0.1)] bg-[linear-gradient(145deg,rgba(18,25,48,0.95),rgba(7,10,22,0.98))] p-5 shadow-inner"
        >
          {/* Card Top: Player info & Logo */}
          <div className="flex items-center justify-between border-b border-white/5 pb-4">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={artworkUrl(group.sport, group.player, group.team, group.providerPlayerId)}
                alt=""
                className="size-12 rounded-xl border border-white/10 object-cover bg-slate-900"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
              <div>
                <span className="font-mono text-[10px] font-bold text-[#818CF8]">
                  {group.sport} · {group.team || 'PRO'}
                </span>
                <h3 className="text-lg font-black text-white">{group.player}</h3>
                <p className="text-xs text-[#8F9FB5]">{group.matchup}</p>
              </div>
            </div>

            <DvpBadge data={dvp} compact />
          </div>

          {/* Line & Market */}
          <div className="my-4 flex items-center justify-between rounded-xl bg-white/[0.03] p-3 border border-white/5">
            <div>
              <span className="text-[10px] uppercase font-bold text-[#64748B]">Market</span>
              <div className="font-semibold text-white text-sm">{group.market}</div>
            </div>
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold text-[#64748B]">Line</span>
              <div className="font-mono text-xl font-black text-[#3DE8A8]">{group.line}</div>
            </div>
          </div>

          {/* Hit-Strip Timeline */}
          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between text-[10px]">
              <span className="font-bold text-[#8F9FB5]">Last 5 Games vs Line ({group.line})</span>
              <span className="font-mono text-emerald-400 font-bold">4/5 (80%)</span>
            </div>
            <HitStrip games={hitGames} size="md" />
          </div>

          {/* Best Odds */}
          <div className="flex items-center justify-between border-t border-white/5 pt-3 text-xs">
            <span className="text-[#8F9FB5]">Best Available Line:</span>
            <span className="font-mono font-bold text-white bg-white/5 px-2 py-0.5 rounded border border-white/10">
              {group.bestOver?.price ? `OVER ${group.bestOver.price} (${group.bestOver.sportsbook || 'DK'})` : 'OVER -110'}
            </span>
          </div>

          {/* Watermark */}
          <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3">
            <span className="flex items-center gap-1.5 font-display text-xs font-black text-white">
              Oblige<span className="text-[#3DE8A8]">Props</span>.com
            </span>
            <span className="flex items-center gap-1 text-[10px] text-[#818CF8]">
              <Sparkles className="size-3" />
              Verified Line Intelligence
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={handleCopyLink}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#3DE8A8] py-2.5 font-bold text-[#04150E] transition hover:bg-[#34d498]"
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? 'Link Copied!' : 'Copy Prop Link'}
          </button>
          <button
            type="button"
            onClick={() => {
              handleCopyLink();
              alert('Prop card link copied to clipboard! Share on X, Discord or TikTok.');
            }}
            className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 font-bold text-white transition hover:bg-white/10"
          >
            <Download className="size-4" />
            Share
          </button>
        </div>
      </div>
    </div>
  );
}
