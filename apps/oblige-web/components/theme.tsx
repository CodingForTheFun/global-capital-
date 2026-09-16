'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export const DIRECTIONS = [
  { id: 'a', label: 'Midnight Terminal' },
  { id: 'b', label: 'Broadcast' },
  { id: 'c', label: 'Daylight Ledger' },
] as const;

export type DirectionId = (typeof DIRECTIONS)[number]['id'];

function directionForPath(pathname: string): DirectionId {
  if (pathname.startsWith('/research')) return 'c';
  if (pathname.startsWith('/board')) return 'b';
  return 'a';
}

const DirectionContext = React.createContext<{
  direction: DirectionId;
  setDirection: (id: DirectionId) => void;
}>({ direction: 'a', setDirection: () => {} });

export function useDirection() {
  return React.useContext(DirectionContext);
}

export function DirectionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const automatic = directionForPath(pathname);
  const [direction, setDirectionState] = React.useState<DirectionId>(automatic);

  // The approved visual set uses one deliberate direction per primary surface:
  // Midnight Terminal for landing, Broadcast for the board, Daylight Ledger for
  // player research. A manual direction choice lasts for the current surface,
  // then navigation resets to the approved direction for the next surface.
  React.useEffect(() => {
    setDirectionState(automatic);
  }, [automatic]);

  React.useLayoutEffect(() => {
    document.documentElement.dataset.direction = direction;
  }, [direction]);

  const setDirection = React.useCallback((id: DirectionId) => {
    setDirectionState(id);
  }, []);

  const value = React.useMemo(() => ({ direction, setDirection }), [direction, setDirection]);
  return <DirectionContext.Provider value={value}>{children}</DirectionContext.Provider>;
}

export function DirectionSwitcher({ className }: { className?: string }) {
  const { direction, setDirection } = useDirection();
  return (
    <div
      role="group"
      aria-label="Visual direction"
      className={cn(
        'flex max-w-full gap-0.5 overflow-x-auto rounded-full border border-[var(--line)]',
        'bg-[var(--surface-2)] p-[3px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {DIRECTIONS.map((option) => {
        const active = option.id === direction;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            onClick={() => setDirection(option.id)}
            className={cn(
              'min-h-9 flex-none whitespace-nowrap rounded-full px-3 text-[length:var(--fs-xs)] font-semibold',
              'transition-colors duration-200 ease-[var(--ease-out)]',
              active
                ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                : 'text-[var(--text-2)] hover:text-[var(--text)]',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
