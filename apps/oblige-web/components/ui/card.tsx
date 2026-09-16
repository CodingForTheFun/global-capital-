import * as React from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'bg-[var(--surface)] border border-[var(--line)] rounded-[var(--radius)] shadow-[var(--shadow-1)]',
        'transition-[transform,border-color,box-shadow,background-color] duration-300 ease-[var(--ease-out)]',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-wrap items-center justify-between gap-3 mb-5', className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return <h2 className={cn('text-[length:var(--fs-md)] tracking-tight normal-case', className)} {...props} />;
}

export function CardPanel({ className, ...props }: React.ComponentProps<'div'>) {
  return <Card className={cn('p-5 min-w-0', className)} {...props} />;
}
