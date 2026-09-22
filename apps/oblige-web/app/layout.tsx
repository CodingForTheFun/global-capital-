import type { Metadata, Viewport } from 'next';
import './globals.css';
import { CommandSearchController } from '@/components/command-search';
import { DirectionProvider } from '@/components/theme';
import { MobileNav, SiteFooter, SiteHeader } from '@/components/site-chrome';
import { AppInstall } from '@/components/app-install';

export const metadata: Metadata = {
  title: { default: 'Oblige Props', template: '%s · Oblige Props' },
  description: 'Player prop research with the line history attached — how a number opened, where it moved, which book is off consensus, and what the player actually did.',
  applicationName: 'Oblige Props',
  metadataBase: new URL('https://www.obligeprops.com'),
  manifest: '/app.webmanifest',
  appleWebApp: { capable: true, title: 'Oblige Props', statusBarStyle: 'black-translucent' },
  icons: { apple: [{ url: '/app-icons/180.png', sizes: '180x180', type: 'image/png' }] },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#060812' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-direction="a" suppressHydrationWarning>
      <body>
        <a href="#main" className="fixed top-[-60px] left-4 z-[200] rounded-[var(--radius)] bg-[var(--accent-fill)] px-4 py-3 font-semibold text-[var(--accent-ink)] transition-[top] duration-200 focus:top-4">Skip to content</a>
        <DirectionProvider>
          <CommandSearchController />
          <SiteHeader />
          <main id="main">{children}</main>
          <AppInstall />
          <SiteFooter />
          <MobileNav />
        </DirectionProvider>
      </body>
    </html>
  );
}
