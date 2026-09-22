import type { Metadata } from 'next';
import { NewsScreen } from '@/components/news-screen';

export const metadata: Metadata = {
  title: 'News',
  description: 'Sports news, roster movement and injury updates alongside Oblige Props research.',
};

export default function NewsPage() {
  return <NewsScreen />;
}
