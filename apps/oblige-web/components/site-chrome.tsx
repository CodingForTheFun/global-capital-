'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Home, LayoutGrid, Menu, User, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const NAV = [
  { href: '/board', label: 'Props' },
  { href: '/research', label: 'Research' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/account', label: 'Account' },
];

const MOBILE_NAV = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/board', label: 'Props', icon: LayoutGrid },
  { href: '/research', label: 'Research', icon: BarChart3 },
  { href: '/account', label: 'Profile', icon: User },
];

const MOBILE_MENU = [
  { href: '/account', label: 'Account / Profile' },
  { href: '/research', label: 'Research' },
  { href: '/#pricing', label: 'Pricing' },
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
  const [stuck, setStuck] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const pathname = usePathname();
  const board = pathname.startsWith('/board');
  const menuRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        setStuck(window.scrollY > 24);
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

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
        'sticky top-0 z-30 border-b border-transparent',
        'bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] backdrop-blur-xl',
        'transition-[border-color,background-color] duration-300 ease-[var(--ease-out)]',
        'data-[stuck=true]:border-[var(--line)] data-[stuck=true]:bg-[color-mix(in_srgb,var(--bg)_94%,transparent)]',
      )}
    >
      <div
        className={cn(
          'mx-auto flex w-full max-w-[var(--maxw)] items-center gap-6 px-4 md:px-8',
          'h-16 transition-[height] duration-300 ease-[var(--ease-out)]',
          stuck && 'h-14',
        )}
      >
        <Link href="/" className="flex flex-none items-center gap-3" aria-label="Oblige Props home">
          <span aria-hidden="true" className="op-mark">OP</span>
          <Wordmark />
        </Link>

        <nav aria-label="Primary" className="ml-4 hidden gap-5 lg:flex">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group relative py-2 text-[length:var(--fs-sm)] font-medium',
                  'transition-colors duration-200 ease-[var(--ease-out)]',
                  active ? 'text-[var(--text)]' : 'text-[var(--text-2)] hover:text-[var(--text)]',
                )}
              >
                {item.label}
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute inset-x-0 bottom-0 h-0.5 origin-left rounded-sm bg-[var(--accent)]',
                    'transition-transform duration-300 ease-[var(--ease-out)]',
                    active ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100',
                  )}
                />
              </Link>
            );
          })}
        </nav>

        <div className="relative ml-auto flex items-center gap-2" ref={menuRef}>
          {board && (
            <button
              type="button"
              className="board-mobile-menu-trigger hidden size-8 items-center justify-center rounded-[8px] border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] text-[var(--text-2)] max-[767px]:inline-flex"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              aria-controls="board-mobile-menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <X className="size-4" aria-hidden="true" /> : <Menu className="size-4" aria-hidden="true" />}
            </button>
          )}

          {board && menuOpen && (
            <div
              id="board-mobile-menu"
              className="board-mobile-menu absolute right-0 top-[calc(100%+8px)] z-50 hidden min-w-[190px] overflow-hidden rounded-[12px] border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg-deep)_97%,transparent)] p-1.5 shadow-2xl backdrop-blur-xl max-[767px]:grid"
            >
              {MOBILE_MENU.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-[8px] px-3 py-2.5 text-[12px] font-semibold text-[var(--text-2)] transition-colors hover:bg-[color-mix(in_srgb,var(--text)_7%,transparent)] hover:text-[var(--text)]"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          )}

          <Button
            asChild
            size="sm"
            variant="ghost"
            className={cn('max-[519px]:hidden', board && 'max-[767px]:hidden')}
          >
            <Link href="/account">Account</Link>
          </Button>
          <Button asChild size="sm" className={cn(board && 'max-[767px]:hidden')}>
            <Link href="/board">Open Props</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

/** Bottom bar on phones. Keep only routes that are already real and protected. */
export function MobileNav() {
  const pathname = usePathname();
  const board = pathname.startsWith('/board');
  return (
    <nav
      aria-label="Sections"
      data-board={board ? 'true' : 'false'}
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 lg:hidden',
        'border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--bg-deep)_94%,transparent)] backdrop-blur-xl',
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      {MOBILE_NAV.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'grid min-h-14 content-center justify-items-center gap-[3px]',
              'text-[10px] font-semibold tracking-wide',
              'transition-colors duration-200 ease-[var(--ease-out)]',
              active ? 'text-[var(--accent)]' : 'text-[var(--text-3)]',
            )}
          >
            <item.icon className="size-5" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--line)] bg-[var(--bg-deep)] py-12">
      <div className="mx-auto w-full max-w-[var(--maxw)] px-4 md:px-8">
        <div className="grid gap-8 [&>*]:min-w-0 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
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
              { href: '/research', label: 'Player research' },
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
          <FooterColumn
            title="Legal"
            links={[
              { href: '/terms', label: 'Terms' },
              { href: '/privacy', label: 'Privacy' },
              { href: '/responsible-play', label: 'Responsible play' },
            ]}
          />
        </div>
        <div className="mt-10 flex flex-wrap justify-between gap-4 border-t border-[var(--line)] pt-6 text-[length:var(--fs-xs)] text-[var(--text-3)]">
          <span>© {new Date().getFullYear()} Oblige Props. Research only — not betting advice.</span>
          <span>21+ · If gambling stops being fun, call 1-800-GAMBLER.</span>
        </div>
      </div>
    </footer>
  );
}

/** Routes this app has not taken over yet — the Next config rewrites them to
 * the existing service. They must be plain anchors: a next/link would be
 * prefetched as an app route and 404 before the rewrite ever runs. */
const NOT_MIGRATED = new Set(['/terms', '/privacy', '/responsible-play']);

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
