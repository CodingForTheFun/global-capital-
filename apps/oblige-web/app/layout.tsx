import type { Metadata, Viewport } from 'next';
import './globals.css';
import './premium.css';
import './premium-surfaces.css';
import './player-shell.css';
import './reference-shell.css';
import './reference-filters.css';
import './mobile-density.css';
import './human-polish.css';
import './reference-acceptance.css';
import './reference-acceptance-desktop.css';
import './reference-mounted-board.css';
import './reference-player-sheet.css';
import { CommandSearchController } from '@/components/command-search';
import { DirectionProvider } from '@/components/theme';
import { MobileNav, SiteFooter, SiteHeader } from '@/components/site-chrome';

export const metadata: Metadata = {
  title: {
    default: 'Oblige Props',
    template: '%s · Oblige Props',
  },
  description:
    'Player prop research with the line history attached — how a number opened, where it moved, which book is off consensus, and what the player actually did.',
  applicationName: 'Oblige Props',
  metadataBase: new URL('https://www.obligeprops.com'),
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#050b13',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-direction="a" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&family=Archivo:wght@600;700;800;900&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&display=swap"
        />
      </head>
      <body>
        <a
          href="#main"
          className="fixed top-[-60px] left-4 z-[200] rounded-[var(--radius)] bg-[var(--accent)] px-4 py-3 font-semibold text-[var(--accent-ink)] transition-[top] duration-200 focus:top-4"
        >
          Skip to content
        </a>
        <DirectionProvider>
          <CommandSearchController />
          <SiteHeader />
          <main id="main" className="pb-14 lg:pb-0">
            {children}
          </main>
          <SiteFooter />
          <MobileNav />
        </DirectionProvider>
      </body>
    </html>
  );
}
