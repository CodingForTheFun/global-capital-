'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  // 44px minimum height everywhere: these are the same controls on a phone.
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold ' +
    'transition-[transform,background-color,border-color,box-shadow,color] duration-200 ' +
    'ease-[var(--ease-out)] active:scale-[.97] touch-manipulation ' +
    'disabled:pointer-events-none disabled:opacity-50 ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ' +
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-[var(--accent)] text-[var(--accent-ink)] shadow-[var(--shadow-glow)] hover:brightness-110',
        ghost:
          'border border-[var(--line-strong)] text-[var(--text-2)] ' +
          'hover:border-[var(--text-3)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]',
        quiet: 'text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]',
        danger:
          'border border-[color-mix(in_srgb,var(--neg)_50%,transparent)] text-[var(--neg)] ' +
          'hover:bg-[color-mix(in_srgb,var(--neg)_12%,transparent)]',
      },
      size: {
        sm: 'min-h-9 px-3 text-[length:var(--fs-xs)] rounded-[var(--radius-sm)]',
        md: 'min-h-11 px-5 text-[length:var(--fs-sm)] rounded-[var(--radius)]',
        lg: 'min-h-12 px-6 text-[length:var(--fs-base)] rounded-[var(--radius)]',
        icon: 'size-11 rounded-[var(--radius-sm)]',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', block: false },
  },
);

export type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, block, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, block }), className)} {...props} />;
}

export { buttonVariants };
