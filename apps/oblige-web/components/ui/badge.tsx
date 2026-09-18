import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full font-semibold tracking-wide whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-2)]',
        live:
          'text-[var(--pos)] border border-[color-mix(in_srgb,var(--pos)_38%,transparent)] ' +
          'bg-[color-mix(in_srgb,var(--pos)_12%,transparent)]',
        pos: 'text-[var(--pos)] bg-[color-mix(in_srgb,var(--pos)_16%,transparent)]',
        neg: 'text-[var(--neg)] bg-[color-mix(in_srgb,var(--neg)_16%,transparent)]',
        muted: 'text-[var(--text-3)] bg-[var(--surface-3)]',
      },
      size: {
        sm: 'h-6 px-2.5 text-[length:var(--fs-micro)]',
        md: 'h-7 px-3 text-[length:var(--fs-xs)]',
      },
    },
    defaultVariants: { variant: 'default', size: 'sm' },
  },
);

export function Badge({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

/** A small pulsing dot, used to mark a live market. */
export function Dot({ className, pulse }: { className?: string; pulse?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn('size-1.5 shrink-0 rounded-full bg-current', pulse && 'animate-pulse', className)}
    />
  );
}
