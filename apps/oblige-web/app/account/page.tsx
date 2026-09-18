import type { Metadata } from 'next';
import { AccountView } from '@/components/account-view';

export const metadata: Metadata = {
  title: 'Account & support',
  description: 'Your Oblige Props account, plus answers to the questions we get most.',
};

export default function AccountPage() {
  return <AccountView />;
}
