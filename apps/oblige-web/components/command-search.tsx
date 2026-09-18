'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';

function focusBoardSearch() {
  const input = document.querySelector<HTMLInputElement>('main input[type="search"]');
  if (!input) return false;
  input.focus({ preventScroll: true });
  input.select();
  input.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  return true;
}

/**
 * cmdk-inspired global search affordance without another dependency. The
 * existing board search remains the single source of truth; Cmd/Ctrl+K simply
 * takes the user there and focuses it.
 */
export function CommandSearchController() {
  const pathname = usePathname();
  const router = useRouter();
  const pendingFocus = React.useRef(false);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();

      if (pathname === '/board' && focusBoardSearch()) return;
      pendingFocus.current = true;
      router.push('/board');
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pathname, router]);

  React.useEffect(() => {
    if (pathname !== '/board' || !pendingFocus.current) return;
    pendingFocus.current = false;
    const frame = requestAnimationFrame(() => {
      if (focusBoardSearch()) return;
      window.setTimeout(focusBoardSearch, 120);
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  return null;
}
