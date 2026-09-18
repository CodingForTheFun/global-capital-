import type { Metadata } from 'next';
import { TerminalBoard } from '@/components/terminal-board';

export const metadata: Metadata = {
  title: 'Research Terminal',
  description: 'Live PropLine player props with multi-book pricing, verified hit-rate windows, model context, and streaming market updates.',
};

export default function BoardPage() {
  return <TerminalBoard />;
}
