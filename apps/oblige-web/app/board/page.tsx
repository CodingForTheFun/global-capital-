import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BoardView } from '@/components/board-view';

export const metadata: Metadata = {
  title: 'Prop Board',
  description: 'Live player props from every sportsbook we track, with hit rates attached.',
};

export default function BoardPage() {
  return (
    <Suspense fallback={null}>
      <BoardView />
    </Suspense>
  );
}
