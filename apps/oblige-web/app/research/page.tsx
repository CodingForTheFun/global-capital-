import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PlayerView } from '@/components/player-view';

export const metadata: Metadata = {
  title: 'Player research',
  description: 'Game-by-game history, splits and every book pricing one player prop.',
};

export default function ResearchPage() {
  // useSearchParams needs a Suspense boundary: the page is addressed entirely
  // through the URL so a pasted link opens the same prop.
  return (
    <Suspense fallback={null}>
      <PlayerView />
    </Suspense>
  );
}
