import type { Metadata } from 'next';
import { ScoresWorkspace } from '@/components/scoreboard';

export const metadata: Metadata = {
  title: 'Scores',
  description: 'Live, scheduled and completed NFL, NBA, EPL, NHL and MLB scores with automatic fallback coverage.',
};

export default function ScoresPage() {
  return <ScoresWorkspace />;
}
