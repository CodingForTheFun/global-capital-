import { cn } from '@/lib/utils';

/** Shown while data loads, sized to the thing it stands in for so the layout
 *  does not jump when the real content arrives. */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'rounded-[var(--radius-sm)] bg-[var(--surface-2)]',
        'bg-[linear-gradient(90deg,var(--surface-2)_0%,var(--surface-3)_40%,var(--surface-2)_80%)]',
        'bg-[length:220%_100%] animate-[shimmer_1.4s_linear_infinite]',
        className,
      )}
      {...props}
    />
  );
}
