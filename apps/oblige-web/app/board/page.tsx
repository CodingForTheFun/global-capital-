import type { Metadata } from 'next';
import { BetHoopsBoard } from '@/components/bethoops-board';

export const metadata: Metadata = {
  title: 'Prop Board',
  description: 'Live PropLine player props with verified model projections, recent performance, and sportsbook context.',
};

export default function BoardPage() {
  return <BetHoopsBoard />;
}
