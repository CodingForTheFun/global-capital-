import type { Metadata } from 'next';
import { MovesScreen } from '@/components/moves-screen';

export const metadata: Metadata = {
  title: 'Live Moves',
  description: 'Live player-prop line movement, steam and suspended markets across sportsbooks.',
};

export default function MovesPage() {
  return <MovesScreen />;
}
