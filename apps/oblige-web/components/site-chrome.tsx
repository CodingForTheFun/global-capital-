'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Home, LayoutGrid, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const NAV = [
  { href: '/board', label: 'Prop Board' },
  { href: '/research', label: 'Research' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/account', label: 'Support' },
];

const MOBILE_NAV = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/board', label: 'Board', icon: LayoutGrid },
  { href: '/research', label: 'Research', icon: BarChart3 },
  { href: '/account', label: 'Account', icon: User },
];

export function SiteHeader() {
  const [stuck, setStuck] = React.useState(false);
  const pathname = usePathname();

  React.useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      // Read layout inside the frame, never in the scroll handler itself.
      requestAnimationFrame(() => {
        setStuck(window.scrollY > 24);
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      data-stuck={stuck}
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
        <Link href="/" className="flex flex-none items-center gap-3">
          <span
            aria-hidden="true"
            className={cn(
              'grid size-8 place-items-center rounded-[var(--radius-sm)] max-[519px]:size-7',
              'bg-[linear-gradient(140deg,var(--accent),color-mix(in_srgb,var(--accent)_45%,var(--info)))]',
              'font-display text-sm font-extrabold text-[var(--accent-ink)] shadow-[var(--shadow-glow)]',
            )}
          >
            OP
          </span>
          <span
            className="font-display text-[length:var(--fs-md)] max-[519px]:text-[length:var(--fs-base)]"
            style={{
              fontWeight: 'var(--display-weight)' as unknown as number,
              letterSpacing: 'var(--display-tracking)',
              textTransform: 'var(--display-case)' as 'none',
            }}
          >
            Oblige Props
          </span>
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

        <div className="ml-auto flex items-center gap-2">
          <Button asChild size="sm" variant="ghost" className="max-[519px]:hidden">
            <Link href="/account">Account</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/board">Open board</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

/** Bottom bar on phones. Five items is the ceiling; this carries four. */
export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Sections"
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
            <span className="font-display text-[length:var(--fs-md)]">Oblige Props</span>
            <p className="mt-4 max-w-[36ch] text-[length:var(--fs-sm)] leading-relaxed text-[var(--text-3)]">
              Player prop research with the line history attached. obligeprops.com
            </p>
          </div>
          <FooterColumn
            title="Product"
            links={[
              { href: '/board', label: 'Prop board' },
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
 *  the existing service. They must be plain anchors: a next/link would be
 *  prefetched as an app route and 404 before the rewrite ever runs. */
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
