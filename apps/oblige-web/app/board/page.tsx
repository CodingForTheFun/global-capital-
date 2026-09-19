import type { Metadata } from 'next';
import { PremiumBoard } from '@/components/premium-board';

export const metadata: Metadata = {
  title: 'Prop Board',
  description: 'Live ObligeProps player props with compact filters, multi-book prices, projections, EV, hit rates, and direct player research.',
};

export default function BoardPage() {
  return <PremiumBoard />;
}
