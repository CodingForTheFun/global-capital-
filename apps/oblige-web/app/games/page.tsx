import type { Metadata } from 'next';
import { GamesScreen } from '@/components/games-screen';

export const metadata: Metadata = {
  title: 'Games',
  description: 'Every game with scores, injuries, lineups, game lines, posted props and news.',
};

export default function GamesPage() {
  return <GamesScreen />;
}
