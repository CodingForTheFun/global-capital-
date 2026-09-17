'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/** Three directions still exist in tokens, but production ships Midnight Terminal.
 *  B/C remain available via the switcher for internal comparison only. */
export const DIRECTIONS = [
  { id: 'a', label: 'Midnight Terminal' },
  { id: 'b', label: 'Broadcast' },
  { id: 'c', label: 'Daylight Ledger' },
] as const;

export type DirectionId = (typeof DIRECTIONS)[number]['id'];

const STORAGE_KEY = 'oblige-direction';
const DirectionContext = React.createContext<{
  direction: DirectionId;
  setDirection: (id: DirectionId) => void;
}>({ direction: 'a', setDirection: () => {} });

export function useDirection() {
  return React.useContext(DirectionContext);
}

export function DirectionProvider({ children }: { children: React.ReactNode }) {
  // Always start on production direction; only restore storage if it is a known id.
  const [direction, setDirectionState] = React.useState<DirectionId>('a');

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      // Prefer a (terminal) for anyone without a saved preference.
      // If they previously picked b/c, respect that once — power users only.
      if (saved && DIRECTIONS.some((d) => d.id === saved)) setDirectionState(saved as DirectionId);
      else setDirectionState('a');
    } catch {
      /* keep a */
    }
  }, []);

  React.useEffect(() => {
    document.documentElement.dataset.direction = direction;
  }, [direction]);

  const setDirection = React.useCallback((id: DirectionId) => {
    setDirectionState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* theme still applies for this visit */
    }
  }, []);

  const value = React.useMemo(() => ({ direction, setDirection }), [direction, setDirection]);
  return <DirectionContext.Provider value={value}>{children}</DirectionContext.Provider>;
}

/** Optional. Not mounted in primary chrome so production stays one look. */
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
