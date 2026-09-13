import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ObligePay Edge — Guest Prop Research',
  description: 'Interactive player prop research preview powered by ObligePay Edge.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head><link rel="stylesheet" href="/assets/prop-ml.css" /></head>
      <body>{children}</body>
    </html>
  );
}
