import * as React from 'react';
import { cn } from '@/lib/utils';

/** The wrapper scrolls, not the page — a wide table never becomes the
 *  document's own horizontal overflow. */
export function TableWrap({ className, style, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className="w-full max-w-full min-w-0 overflow-hidden [contain:inline-size]">
      <div
        className={cn('w-full max-w-full min-w-0 overflow-x-auto [overscroll-behavior-x:contain]', className)}
        style={style}
        {...props}
      />
    </div>
  );
}

export function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <table
      className={cn('w-full min-w-[420px] border-collapse text-[length:var(--fs-sm)]', className)}
      {...props}
    />
  );
}

export function Th({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'whitespace-nowrap border-b border-[var(--line)] p-3 text-left',
        'text-[length:var(--fs-micro)] font-semibold uppercase tracking-[.1em] text-[var(--text-3)]',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      className={cn('whitespace-nowrap border-b border-[var(--line)] p-3 text-[var(--text-2)]', className)}
      {...props}
    />
  );
}

export function Tr({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      className={cn(
        'transition-colors duration-200 ease-[var(--ease-out)] hover:bg-[var(--surface-2)]',
        '[&:last-child>td]:border-b-0',
        className,
      )}
      {...props}
    />
  );
}
