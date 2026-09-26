'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, LayoutGrid, Menu, Newspaper, RadioTower, Search, User, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useScrollThreshold } from '@/hooks/use-scroll-threshold';

const NAV = [
  { href: '/board', label: 'Props' },
  { href: '/moves', label: 'Market' },
  { href: '/scores', label: 'Scores' },
  { href: '/news', label: 'News' },
];

/**
 * Core destinations in the phone dock. Research has no tab: it is always about
 * one prop, so it opens from a prop card rather than as an empty page.
 * Home is the logo.
 */
const MOBILE_NAV = [
  { href: '/board', label: 'Props', icon: LayoutGrid },
  { href: '/moves', label: 'Market', icon: Activity },
  { href: '/scores', label: 'Scores', icon: RadioTower },
  { href: '/news', label: 'News', icon: Newspaper },
  { href: '/account', label: 'Profile', icon: User },
];

const MOBILE_MENU = [
  { href: '/board', label: 'Props' },
  { href: '/moves', label: 'Market' },
  { href: '/scores', label: 'Scores' },
  { href: '/news', label: 'News' },
  { href: '/research', label: 'Search players' },
  { href: '/account', label: 'Account / Profile' },
];

function Wordmark({ footer = false }: { footer?: boolean }) {
  return (
    <span
      className={cn(
        'op-wordmark font-display',
        footer ? 'text-[length:var(--fs-md)]' : 'text-[length:var(--fs-md)] max-[519px]:text-[length:var(--fs-base)]',
      )}
    >
      Oblige<span className="op-wordmark__accent">Props</span>
    </span>
  );
}

export function SiteHeader() {
  const stuck = useScrollThreshold(24);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const pathname = usePathname();
  const board = pathname.startsWith('/board');
  const menuRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  React.useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  return (
    <header
      data-stuck={stuck}
      data-board={board ? 'true' : 'false'}
      className={cn(
        'sticky top-0 z-30 border-b border-[var(--line)]',
        'bg-[color-mix(in_srgb,var(--bg)_86%,transparent)] backdrop-blur-xl',
        'transition-[background-color,box-shadow] duration-300 ease-[var(--ease-out)]',
        'data-[stuck=true]:bg-[color-mix(in_srgb,var(--bg)_96%,transparent)] data-[stuck=true]:shadow-[0_10px_30px_-18px_rgb(0_0_0/.8)]',
      )}
    >
      <div className="mx-auto flex h-[var(--header-h)] w-full max-w-[var(--maxw)] items-center gap-6 px-4 md:px-8">
        <Link href="/" className="flex flex-none items-center gap-2.5" aria-label="Oblige Props home">
          <span aria-hidden="true" className="op-mark">OP</span>
          <Wordmark />
        </Link>

        <nav
          aria-label="Primary"
          className="ml-2 hidden items-center gap-0.5 rounded-[11px] border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_70%,transparent)] p-[3px] lg:flex"
        >
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'rounded-[8px] px-3 py-1.5 text-[length:var(--fs-xs)] font-semibold',
                  'transition-colors duration-200 ease-[var(--ease-out)]',
                  active
                    ? 'bg-[var(--accent-soft)] text-[var(--text)]'
                    : 'text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="relative ml-auto flex items-center gap-2" ref={menuRef}>
          <Link
            href="/research"
            aria-label="Search players"
            aria-current={pathname === '/research' ? 'page' : undefined}
            className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] px-2.5 text-[length:var(--fs-xs)] font-semibold text-[var(--text-2)] transition-colors hover:text-[var(--text)] lg:min-w-[200px]"
          >
            <Search className="size-4" aria-hidden="true" />
            <span className="hidden lg:inline">Search any player</span>
          </Link>
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-[9px] border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] text-[var(--text-2)] lg:hidden"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-site-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X className="size-4" aria-hidden="true" /> : <Menu className="size-4" aria-hidden="true" />}
          </button>

          {menuOpen && (
            <div
              id="mobile-site-menu"
              className="absolute right-0 top-[calc(100%+8px)] z-50 grid min-w-[210px] overflow-hidden rounded-[12px] border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg-deep)_97%,transparent)] p-1.5 shadow-2xl backdrop-blur-xl lg:hidden"
            >
              {MOBILE_MENU.map((item, index) => (
                <Link
                  key={`${item.href}-${item.label}-${index}`}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-[8px] px-3 py-2.5 text-[12px] font-semibold text-[var(--text-2)] transition-colors hover:bg-[color-mix(in_srgb,var(--text)_7%,transparent)] hover:text-[var(--text)]"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          )}

          <Button asChild size="sm" variant="ghost" className="hidden lg:inline-flex">
            <Link href="/account" aria-current={pathname.startsWith('/account') ? 'page' : undefined}>
              <User className="size-4" aria-hidden="true" />
              Account
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

/** Bottom bar on phones. On the prop board it gets out of the way while the
 *  customer scrolls down and returns immediately when they reverse direction. */
export function MobileNav() {
  const pathname = usePathname();
  const board = pathname.startsWith('/board');
  const [hidden, setHidden] = React.useState(false);
  const lastY = React.useRef(0);
  const frame = React.useRef<number | null>(null);
  const touchY = React.useRef<number | null>(null);

  React.useEffect(() => {
    setHidden(false);
    lastY.current = Math.max(0, window.scrollY || 0);
    if (!board) return;

    const updateFromY = (value: number) => {
      const y = Math.max(0, value || 0);
      const previous = lastY.current;

      if (y <= 8) setHidden(false);
      else if (y > previous + 6) setHidden(true);
      else if (y < previous - 2) setHidden(false);

      lastY.current = y;
    };

    const onScroll = () => {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        updateFromY(window.scrollY);
      });
    };

    const onTouchStart = (event: TouchEvent) => {
      touchY.current = event.touches[0]?.clientY ?? null;
    };

    const onTouchMove = (event: TouchEvent) => {
      const nextY = event.touches[0]?.clientY;
      const previousY = touchY.current;
      if (nextY == null || previousY == null) return;

      const delta = nextY - previousY;
      if (Math.abs(delta) < 6) return;

      if (delta < 0 && window.scrollY > 8) setHidden(true);
      else if (delta > 0) setHidden(false);

      touchY.current = nextY;
    };

    const onPageShow = () => {
      setHidden(false);
      lastY.current = Math.max(0, window.scrollY || 0);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('pageshow', onPageShow, { passive: true });

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('pageshow', onPageShow);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      touchY.current = null;
    };
  }, [board]);

  return (
    <nav
      aria-label="Sections"
      data-board={board ? 'true' : 'false'}
      data-scroll-hidden={board && hidden ? 'true' : 'false'}
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 gap-0.5 overflow-x-hidden px-1.5 pt-1.5 lg:hidden',
        'border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--bg-deep)_94%,transparent)] backdrop-blur-xl',
        'pb-[max(6px,env(safe-area-inset-bottom))]',
        'transition-[transform,opacity] duration-200 ease-[var(--ease-out)] motion-reduce:transition-none',
      )}
      style={{
        gridTemplateColumns: `repeat(${MOBILE_NAV.length}, minmax(0, 1fr))`,
        gridTemplateRows: '1fr',
        transform:
          board && hidden
            ? 'translate3d(0, calc(100% + 24px + env(safe-area-inset-bottom)), 0)'
            : 'translate3d(0, 0, 0)',
        opacity: board && hidden ? 0 : 1,
        pointerEvents: board && hidden ? 'none' : 'auto',
      }}
    >
      {MOBILE_NAV.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'grid min-h-[50px] min-w-0 content-center justify-items-center gap-1 overflow-hidden rounded-[12px]',
              'text-[9px] min-[390px]:text-[10px] font-semibold tracking-wide touch-manipulation',
              'transition-colors duration-200 ease-[var(--ease-out)]',
              active ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--text-3)] hover:text-[var(--text-2)]',
            )}
          >
            <item.icon className="size-[19px] shrink-0" aria-hidden="true" />
            <span className="max-w-full truncate px-0.5">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function SiteFooter() {
  return (
    // On phones the dock is the navigation, so only the legal line and links
    // stay: the responsible-play notice appears nowhere else.
    <footer className="border-t border-[var(--line)] bg-[var(--bg-deep)] py-6 md:py-12">
      <div className="mx-auto w-full max-w-[var(--maxw)] px-4 md:px-8">
        <div className="hidden gap-8 [&>*]:min-w-0 md:grid md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
          <div>
            <Wordmark footer />
            <p className="mt-4 max-w-[36ch] text-[length:var(--fs-sm)] leading-relaxed text-[var(--text-3)]">
              Player prop research with the line history attached. obligeprops.com
            </p>
          </div>
          <FooterColumn
            title="Product"
            links={[
              { href: '/board', label: 'Props' },
              { href: '/moves', label: 'Market' },
              { href: '/scores', label: 'Scores' },
              { href: '/news', label: 'News' },
              { href: '/#pricing', label: 'Pricing' },
            ]}
          />
          <FooterColumn
            title="Company"
            links={[
              { href: '/account', label: 'Support' },
              { href: '/account', label: 'Account' },
            ]}
          />
          <FooterColumn title="Legal" links={LEGAL_LINKS} />
        </div>
        <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-2 text-[length:var(--fs-xs)] md:hidden">
          {LEGAL_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="text-[var(--text-2)] hover:text-[var(--text)]">
              {link.label}
            </a>
          ))}
        </nav>
        <div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-[var(--line)] pt-4 text-[length:var(--fs-xs)] text-[var(--text-3)] md:mt-10 md:gap-4 md:pt-6">
          <span>© {new Date().getFullYear()} Oblige Props. Research only — not betting advice.</span>
          <span>21+ · If gambling stops being fun, call 1-800-GAMBLER.</span>
        </div>
      </div>
    </footer>
  );
}

const LEGAL_LINKS = [
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/responsible-play', label: 'Responsible play' },
];

const NOT_MIGRATED = new Set(LEGAL_LINKS.map((link) => link.href));

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string }[];
}) {
  return (
    <div>
      <h4 className="mb-4 text-[length:var(--fs-xs)] font-semibold uppercase tracking-[.14em] text-[var(--text-3)]">
        {title}
      </h4>
      <ul className="grid list-none gap-3 p-0">
        {links.map((link) => {
          const className =
            'text-[length:var(--fs-sm)] text-[var(--text-2)] transition-colors duration-200 ease-[var(--ease-out)] hover:text-[var(--text)]';
          return (
            <li key={`${link.href}-${link.label}`}>
              {NOT_MIGRATED.has(link.href) ? (
                <a href={link.href} className={className}>
                  {link.label}
                </a>
              ) : (
                <Link href={link.href} className={className}>
                  {link.label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
