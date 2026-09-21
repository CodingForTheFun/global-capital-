import type { Metadata } from 'next';
import { ScoresScreen } from '@/components/scores-screen';

export const metadata: Metadata = {
  title: 'Scores',
  description: 'Live and recent NFL, NBA, EPL, NHL and MLB scores with automatic provider fallback.',
};

export default function ScoresPage() {
  return <ScoresScreen />;
}
